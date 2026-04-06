from __future__ import annotations

import asyncio
import time
from typing import Any

from pyatv import exceptions as atv_exc
from pyatv.const import FeatureName, FeatureState
from pyatv.interface import AppleTV, PushListener

from atv_web import state
from atv_web.connection import (
    evict_stale_atv,
    get_or_connect_for_playing,
    scan_cred_flags_cached,
)
from atv_web.constants import SSE_STREAM_KEEPALIVE_SEC, SSE_STREAM_PUSH_WAIT_SEC
from atv_web.log import logger
from atv_web.schemas import PlayingAppOut, PlayingStateOut
from atv_web.util import enum_name, int_or_none


def playing_snapshot_from_playing(playing: Any) -> PlayingStateOut:
    return PlayingStateOut(
        supported=True,
        app=None,
        media_type=enum_name(playing.media_type),
        device_state=enum_name(playing.device_state),
        title=playing.title,
        artist=playing.artist,
        album=playing.album,
        genre=playing.genre,
        series_name=playing.series_name,
        season_number=playing.season_number,
        episode_number=playing.episode_number,
        position_sec=int_or_none(playing.position),
        total_time_sec=int_or_none(playing.total_time),
    )


def merge_playing_priority(
    polled: PlayingStateOut, cached: PlayingStateOut | None
) -> PlayingStateOut:
    if cached is None:
        return polled
    if not polled.supported:
        return cached if cached.supported else polled
    if not cached.supported:
        return polled

    def text_or(
        primary: str | None, secondary: str | None
    ) -> str | None:
        if primary and str(primary).strip():
            return primary
        if secondary and str(secondary).strip():
            return secondary
        return primary

    st_p = polled.device_state or ""
    st_c = cached.device_state or ""
    merged_state = st_p
    if st_p in ("Idle", "Stopped") and st_c in (
        "Playing",
        "Paused",
        "Loading",
        "Seeking",
    ):
        merged_state = st_c

    mt_p = polled.media_type or "Unknown"
    mt_c = cached.media_type or "Unknown"
    merged_type = mt_p if mt_p != "Unknown" else mt_c

    return PlayingStateOut(
        supported=True,
        detail=None,
        hint=None,
        app=polled.app or cached.app,
        media_type=merged_type,
        device_state=merged_state,
        title=text_or(polled.title, cached.title),
        artist=text_or(polled.artist, cached.artist),
        album=text_or(polled.album, cached.album),
        genre=text_or(polled.genre, cached.genre),
        series_name=text_or(polled.series_name, cached.series_name),
        season_number=polled.season_number
        if polled.season_number is not None
        else cached.season_number,
        episode_number=polled.episode_number
        if polled.episode_number is not None
        else cached.episode_number,
        position_sec=polled.position_sec
        if polled.position_sec is not None
        else cached.position_sec,
        total_time_sec=polled.total_time_sec
        if polled.total_time_sec is not None
        else cached.total_time_sec,
    )


def notify_playing_sse_subscribers(identifier: str, snap: PlayingStateOut) -> None:
    """将推送快照广播给该设备的所有 SSE 订阅者（在 asyncio 线程上执行）。"""
    line = snap.model_dump_json()

    def pump() -> None:
        for q in state._playing_sse_queues.get(identifier, []):
            try:
                q.put_nowait(line)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(line)
                except asyncio.QueueFull:
                    pass

    loop = state._loop
    if loop is None:
        return
    try:
        loop.call_soon_threadsafe(pump)
    except RuntimeError:
        pump()


def is_playing_payload_empty(p: PlayingStateOut) -> bool:
    if not p.supported:
        return True
    st = p.device_state or ""
    mt = p.media_type or ""
    return (
        st in ("Idle", "Stopped", "")
        and mt in ("Unknown", "")
        and not (p.title and str(p.title).strip())
        and p.position_sec is None
        and p.total_time_sec is None
    )


class PlayingPushListener(PushListener):
    def __init__(self, identifier: str) -> None:
        self.identifier = identifier

    def playstatus_update(self, updater: Any, playstatus: Any) -> None:
        try:
            snap = playing_snapshot_from_playing(playstatus)
            state._playing_cache[self.identifier] = snap
            notify_playing_sse_subscribers(self.identifier, snap)
        except Exception:
            logger.exception("处理 playstatus 推送失败: %s", self.identifier)

    def playstatus_error(self, updater: Any, exception: Exception) -> None:
        logger.warning("播放状态推送错误 [%s]: %s", self.identifier, exception)


async def ensure_playback_push(atv: AppleTV, identifier: str) -> None:
    if identifier in state._play_push_started:
        return
    try:
        pu_info = atv.features.get_feature(FeatureName.PushUpdates)
        if pu_info.state != FeatureState.Available:
            logger.info(
                "[%s] PushUpdates 不可用，将仅依赖 playing() 轮询",
                identifier,
            )
            return
        atv.push_updater.listener = PlayingPushListener(identifier)
        atv.push_updater.start()
        state._play_push_started.add(identifier)
        logger.info("[%s] 已订阅播放状态推送 (push_updater)", identifier)
    except Exception as e:
        logger.warning("[%s] 启动 push_updater 失败: %s", identifier, e)


async def read_playing_state(atv: AppleTV) -> PlayingStateOut:
    md = atv.metadata
    app_out: PlayingAppOut | None = None
    try:
        app = md.app
        if app is not None:
            app_out = PlayingAppOut(name=app.name, identifier=app.identifier)
    except Exception:
        logger.debug("读取当前播放 App 信息失败", exc_info=True)

    try:
        playing = await md.playing()
    except atv_exc.NotSupportedError as e:
        return PlayingStateOut(supported=False, detail=str(e), app=app_out)
    except Exception as e:
        logger.warning("读取 playing() 失败: %s", e)
        return PlayingStateOut(supported=False, detail=str(e), app=app_out)

    snap = playing_snapshot_from_playing(playing)
    return snap.model_copy(update={"app": app_out})


async def build_merged_playing_from_atv(
    identifier: str, atv: AppleTV
) -> PlayingStateOut:
    """在已连接的 AppleTV 上读取 playing() 并与推送缓存合并（GET /playing 与 SSE 共用）。"""
    title_feat = atv.features.get_feature(FeatureName.Title)
    if title_feat.state == FeatureState.Unsupported:
        return PlayingStateOut(
            supported=False,
            detail=(
                "无法读取「正在播放」：当前连接不包含可用的 MRP 元数据通道。"
                "pyatv 文档说明 **Companion 与纯 AirPlay 不提供 playing() 数据**；"
                "tvOS 15+ 通常需在电视上完成 **AirPlay（含 HAP）配对**，"
                "以便经隧道使用 MRP。请在「配对」外于系统设置中确认 AirPlay 已信任本机，"
                "并重新扫描保存凭据。"
            ),
        )

    await ensure_playback_push(atv, identifier)
    await asyncio.sleep(0.25)
    polled = await read_playing_state(atv)
    cached = state._playing_cache.get(identifier)
    merged = merge_playing_priority(polled, cached)

    if is_playing_payload_empty(merged):
        hint: str | None = None
        creds = await scan_cred_flags_cached(identifier)
        mrp_c = creds[0] if creds else False
        comp_c = creds[1] if creds else False
        air_c = creds[2] if creds else False

        if comp_c and not air_c and not mrp_c:
            hint = (
                "扫描存储的凭据显示：只有 **Companion**，没有 **AirPlay** 或 **MRP**。"
                "Companion 只能发遥控键，**不能提供「正在播放」**（与是否在播无关）。"
                "请再点「配对」：系统会优先让你配对尚未保存的协议，"
                "按提示完成 **AirPlay** 后重新「扫描」，应看到 airplay_credentials 为 true。"
            )
        elif title_feat.state == FeatureState.Available:
            hint = (
                "已与媒体协议建立通信，但电视仍上报「空闲/无标题」。"
                "可尝试：重启 Apple TV；"
                "若曾用 pyatv/其他工具执行过远程播放 URL（play_url），"
                "tvOS 可能把元数据锁在 AirPlay 上直至重启。"
                "并请确认正在使用 App 内播放（非 HDMI 输入源）。"
            )
        elif title_feat.state == FeatureState.Unavailable:
            hint = (
                "元数据接口回报「暂不可用」。若你确认已在播放，"
                "多半是仍缺 **AirPlay/MRP** 凭据；请完成 AirPlay 配对并重新扫描。"
            )
        if hint:
            merged = merged.model_copy(update={"hint": hint})
    return merged


async def playing_sse_generator(identifier: str):
    """推送 + 定期 playing() 轮询；避免仅依赖 PushUpdates（很多环境下几乎不发进度）。"""
    q: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
    lst = state._playing_sse_queues.setdefault(identifier, [])
    lst.append(q)
    last_sent: str | None = None
    last_yield_mono = time.monotonic()

    def should_send(line: str) -> bool:
        nonlocal last_sent, last_yield_mono
        if line == last_sent:
            return False
        last_sent = line
        last_yield_mono = time.monotonic()
        return True

    async def poll_merged() -> PlayingStateOut | None:
        atv: AppleTV | None = None
        try:
            atv = await get_or_connect_for_playing(identifier)
            return await build_merged_playing_from_atv(identifier, atv)
        except atv_exc.BlockedStateError:
            if atv is not None:
                await evict_stale_atv(identifier, atv)
            return None
        except Exception as e:
            logger.warning("SSE stream 读取 playing 失败: %s", e)
            return PlayingStateOut(supported=False, detail=str(e))

    try:
        initial = await poll_merged()
        if initial is not None:
            line = initial.model_dump_json()
            if should_send(line):
                yield f"data: {line}\n\n"

        while True:
            try:
                payload = await asyncio.wait_for(
                    q.get(), timeout=SSE_STREAM_PUSH_WAIT_SEC
                )
                if should_send(payload):
                    yield f"data: {payload}\n\n"
            except asyncio.TimeoutError:
                polled = await poll_merged()
                if polled is not None:
                    pline = polled.model_dump_json()
                    if should_send(pline):
                        yield f"data: {pline}\n\n"

            if time.monotonic() - last_yield_mono >= SSE_STREAM_KEEPALIVE_SEC:
                yield ": keepalive\n\n"
                last_yield_mono = time.monotonic()
    finally:
        subs = state._playing_sse_queues.get(identifier)
        if subs:
            try:
                subs.remove(q)
            except ValueError:
                pass
            if not subs:
                state._playing_sse_queues.pop(identifier, None)
