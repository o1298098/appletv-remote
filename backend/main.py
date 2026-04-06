from __future__ import annotations

import asyncio
import logging
import os
import random
import time
import uuid
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any

import pyatv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pyatv import exceptions as atv_exc
from pyatv.const import (
    FeatureName,
    FeatureState,
    InputAction,
    PairingRequirement,
    PowerState,
    Protocol,
)
from pyatv.interface import AppleTV, BaseConfig, PairingHandler, PushListener
from pyatv.storage.file_storage import FileStorage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("atv-web")


def _storage_path() -> Path:
    return Path(os.environ.get("PYATV_STORAGE", "pyatv.json"))


def _cors_origins() -> list[str]:
    raw = os.environ.get("ATV_CORS_ORIGINS", "*").strip()
    if raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]

ALLOWED_COMMANDS: set[str] = {
    "up",
    "down",
    "left",
    "right",
    "select",
    "menu",
    "home",
    "play_pause",
    "volume_up",
    "volume_down",
    "skip_forward",
    "skip_backward",
    "set_position",
    "power_toggle",
}

INPUT_COMMANDS = {"up", "down", "left", "right", "select", "menu", "home"}
ACTION_MAP = {
    "single": InputAction.SingleTap,
    "double": InputAction.DoubleTap,
    "hold": InputAction.Hold,
}

storage: FileStorage | None = None
_loop: asyncio.AbstractEventLoop | None = None
_clients: dict[str, AppleTV] = {}
_clients_meta: dict[str, AppleTV] = {}
_connect_mode: dict[str, str] = {}
_pairing_sessions: dict[str, tuple[PairingHandler, Protocol]] = {}
_lock = asyncio.Lock()
_playing_cache: dict[str, Any] = {}
_play_push_started: set[str] = set()
_playing_sse_queues: dict[str, list[asyncio.Queue[str]]] = {}
_cred_flags_cache: dict[str, tuple[float, tuple[bool, bool, bool]]] = {}
_CRED_FLAGS_TTL_SEC = 60.0


def get_loop() -> asyncio.AbstractEventLoop:
    if _loop is None:
        raise RuntimeError("事件循环未初始化")
    return _loop


def get_storage() -> FileStorage:
    if storage is None:
        raise RuntimeError("存储未初始化")
    return storage


def _service_has_credentials(conf: BaseConfig, protocol: Protocol) -> bool:
    svc = conf.get_service(protocol)
    return bool(svc and svc.credentials)


def _pairing_eligible_protocol(conf: BaseConfig) -> Protocol | None:
    def wants_pair(svc: Any) -> bool:
        if svc is None:
            return False
        return svc.pairing in (
            PairingRequirement.Mandatory,
            PairingRequirement.Optional,
        )

    order = (Protocol.Companion, Protocol.AirPlay, Protocol.MRP)
    for proto in order:
        svc = conf.get_service(proto)
        if wants_pair(svc) and not svc.credentials:
            return proto
    for proto in order:
        svc = conf.get_service(proto)
        if wants_pair(svc):
            return proto
    return None


def _invalidate_cred_flags_cache(identifier: str | None = None) -> None:
    if identifier is None:
        _cred_flags_cache.clear()
    else:
        _cred_flags_cache.pop(identifier, None)


async def _scan_cred_flags(identifier: str) -> tuple[bool, bool, bool] | None:
    loop = get_loop()
    st = get_storage()
    confs = await pyatv.scan(loop, identifier=identifier, timeout=8, storage=st)
    if not confs:
        return None
    c = confs[0]
    return (
        _service_has_credentials(c, Protocol.MRP),
        _service_has_credentials(c, Protocol.Companion),
        _service_has_credentials(c, Protocol.AirPlay),
    )


async def _scan_cred_flags_cached(identifier: str) -> tuple[bool, bool, bool] | None:
    now = time.monotonic()
    hit = _cred_flags_cache.get(identifier)
    if hit and now - hit[0] < _CRED_FLAGS_TTL_SEC:
        return hit[1]
    flags = await _scan_cred_flags(identifier)
    if flags is not None:
        _cred_flags_cache[identifier] = (now, flags)
    return flags


def config_to_device(conf: BaseConfig) -> dict[str, Any]:
    addr = getattr(conf.address, "compressed", None) or str(conf.address)
    return {
        "identifier": conf.identifier,
        "name": conf.name,
        "address": addr,
        "ready": conf.ready,
        "mrp_credentials": _service_has_credentials(conf, Protocol.MRP),
        "companion_credentials": _service_has_credentials(conf, Protocol.Companion),
        "airplay_credentials": _service_has_credentials(conf, Protocol.AirPlay),
    }


async def _shutdown_atv(atv: AppleTV | None) -> None:
    if atv is None:
        return
    try:
        atv.push_updater.stop()
    except Exception:
        pass
    try:
        await asyncio.gather(*atv.close())
    except Exception:
        logger.exception("关闭 pyatv 连接时出错")


async def _close_atv(identifier: str) -> None:
    await _shutdown_atv(_clients.pop(identifier, None))
    if identifier not in _clients_meta:
        _play_push_started.discard(identifier)
        _playing_cache.pop(identifier, None)


async def _close_atv_meta(identifier: str) -> None:
    await _shutdown_atv(_clients_meta.pop(identifier, None))
    _play_push_started.discard(identifier)
    _playing_cache.pop(identifier, None)


async def close_all_clients() -> None:
    ids = set(_clients) | set(_clients_meta)
    for i in ids:
        await _shutdown_atv(_clients.pop(i, None))
        await _shutdown_atv(_clients_meta.pop(i, None))
    _play_push_started.clear()
    _playing_cache.clear()
    _connect_mode.clear()


async def get_or_connect(identifier: str) -> AppleTV:
    loop = get_loop()
    st = get_storage()
    async with _lock:
        existing = _clients.get(identifier)
        if existing is not None:
            return existing
        confs = await pyatv.scan(
            loop, identifier=identifier, timeout=10, storage=st
        )
        if not confs:
            raise HTTPException(
                status_code=404,
                detail="找不到该设备，请确认 Apple TV 在线并重新扫描。",
            )
        conf = deepcopy(confs[0])
        if _connect_mode.get(identifier) == "no_mrp":
            mrp = conf.get_service(Protocol.MRP)
            if mrp is not None:
                mrp.enabled = False
                logger.info("连接 %s：已跳过 MRP，改用 Companion 等协议遥控", identifier)
        try:
            atv = await pyatv.connect(conf, loop, storage=st)
        except atv_exc.AuthenticationError as e:
            raise HTTPException(
                status_code=401,
                detail="未配对或凭据无效，请完成 MRP/Companion 配对。",
            ) from e
        except (atv_exc.ConnectionFailedError, atv_exc.NoServiceError) as e:
            raise HTTPException(
                status_code=503,
                detail=f"无法连接设备: {e}",
            ) from e
        _clients[identifier] = atv
        return atv


async def get_or_connect_for_playing(identifier: str) -> AppleTV:
    loop = get_loop()
    st = get_storage()
    async with _lock:
        meta = _clients_meta.get(identifier)
        if meta is not None:
            return meta

        main = _clients.get(identifier)

        confs = await pyatv.scan(
            loop, identifier=identifier, timeout=10, storage=st
        )
        if not confs:
            raise HTTPException(
                status_code=404,
                detail="找不到该设备，请确认 Apple TV 在线并重新扫描。",
            )
        conf = deepcopy(confs[0])
        try:
            atv = await pyatv.connect(conf, loop, storage=st)
        except atv_exc.AuthenticationError as e:
            raise HTTPException(
                status_code=401,
                detail="未配对或凭据无效，请完成 MRP/Companion/AirPlay 配对。",
            ) from e
        except (atv_exc.ConnectionFailedError, atv_exc.NoServiceError) as e:
            if main is not None:
                logger.warning(
                    "无法为 %s 建立独立元数据连接（设备可能仅允许单连接），回退到遥控连接: %s",
                    identifier,
                    e,
                )
                return main
            raise HTTPException(
                status_code=503,
                detail=f"无法连接设备以读取播放状态: {e}",
            ) from e
        _clients_meta[identifier] = atv
        logger.info("已为 %s 建立元数据连接", identifier)
        return atv


async def _evict_stale_atv(identifier: str, atv: AppleTV) -> None:
    async with _lock:
        if _clients_meta.get(identifier) is atv:
            _clients_meta.pop(identifier, None)
        elif _clients.get(identifier) is atv:
            _clients.pop(identifier, None)
    _play_push_started.discard(identifier)
    _playing_cache.pop(identifier, None)
    await _shutdown_atv(atv)


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def invoke_remote(
    atv: AppleTV,
    command: str,
    action: str | None,
    position_sec: int | None = None,
) -> None:
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail="不支持的遥控指令")

    if command == "power_toggle":
        try:
            state = atv.power.power_state
        except atv_exc.NotSupportedError:
            await atv.power.turn_on()
            return
        if state == PowerState.On:
            await atv.power.turn_off()
        else:
            await atv.power.turn_on()
        return

    rc = atv.remote_control

    if command == "set_position":
        if position_sec is None:
            raise HTTPException(
                status_code=400,
                detail="set_position 需要整数 position_sec（秒）",
            )
        await rc.set_position(max(0, int(position_sec)))
        return

    method = getattr(rc, command, None)
    if method is None or not callable(method):
        raise HTTPException(status_code=400, detail="不支持的遥控指令")

    if command in INPUT_COMMANDS:
        ia = ACTION_MAP.get(action or "single", InputAction.SingleTap)
        await method(ia)
    elif command in ("skip_forward", "skip_backward"):
        await method(0.0)
    else:
        await method()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global storage, _loop
    _loop = asyncio.get_running_loop()
    path = _storage_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    storage = FileStorage(str(path), _loop)
    await storage.load()
    logger.info("已加载凭据存储: %s", path)
    yield
    await close_all_clients()
    for sid, (handler, _) in list(_pairing_sessions.items()):
        try:
            await handler.close()
        except Exception:
            logger.exception("关闭配对会话: %s", sid)
    _pairing_sessions.clear()


app = FastAPI(title="Apple TV Remote", lifespan=lifespan)

_origins = _cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanResponse(BaseModel):
    devices: list[dict[str, Any]]


class PairBeginBody(BaseModel):
    identifier: str


class PairBeginResponse(BaseModel):
    session_id: str
    device_provides_pin: bool
    protocol: str
    enter_on_tv_pin: str | None = None


class PairPinBody(BaseModel):
    session_id: str
    pin: str = Field(..., min_length=1, max_length=16)


class PairFinishBody(BaseModel):
    session_id: str


class RemoteBody(BaseModel):
    command: str
    action: str | None = None
    position_sec: int | None = None


class PlayingAppOut(BaseModel):
    name: str | None = None
    identifier: str


class PlayingStateOut(BaseModel):
    supported: bool = True
    detail: str | None = None
    app: PlayingAppOut | None = None
    media_type: str | None = None
    device_state: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    genre: str | None = None
    series_name: str | None = None
    season_number: int | None = None
    episode_number: int | None = None
    position_sec: int | None = None
    total_time_sec: int | None = None
    hint: str | None = None


def _enum_name(value: Any) -> str:
    name = getattr(value, "name", None)
    return str(name) if name is not None else str(value)


def _playing_snapshot_from_playing(playing: Any) -> PlayingStateOut:
    return PlayingStateOut(
        supported=True,
        app=None,
        media_type=_enum_name(playing.media_type),
        device_state=_enum_name(playing.device_state),
        title=playing.title,
        artist=playing.artist,
        album=playing.album,
        genre=playing.genre,
        series_name=playing.series_name,
        season_number=playing.season_number,
        episode_number=playing.episode_number,
        position_sec=_int_or_none(playing.position),
        total_time_sec=_int_or_none(playing.total_time),
    )


def _merge_playing_priority(
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


def _notify_playing_sse_subscribers(identifier: str, snap: PlayingStateOut) -> None:
    """将推送快照广播给该设备的所有 SSE 订阅者（在 asyncio 线程上执行）。"""
    line = snap.model_dump_json()

    def pump() -> None:
        for q in _playing_sse_queues.get(identifier, []):
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

    loop = _loop
    if loop is None:
        return
    try:
        loop.call_soon_thread_safe(pump)
    except RuntimeError:
        pump()


def _is_playing_payload_empty(p: PlayingStateOut) -> bool:
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


class _PlayingPushListener(PushListener):
    def __init__(self, identifier: str) -> None:
        self.identifier = identifier

    def playstatus_update(self, updater: Any, playstatus: Any) -> None:
        try:
            snap = _playing_snapshot_from_playing(playstatus)
            _playing_cache[self.identifier] = snap
            _notify_playing_sse_subscribers(self.identifier, snap)
        except Exception:
            logger.exception("处理 playstatus 推送失败: %s", self.identifier)

    def playstatus_error(self, updater: Any, exception: Exception) -> None:
        logger.warning("播放状态推送错误 [%s]: %s", self.identifier, exception)


async def _ensure_playback_push(atv: AppleTV, identifier: str) -> None:
    if identifier in _play_push_started:
        return
    try:
        pu_info = atv.features.get_feature(FeatureName.PushUpdates)
        if pu_info.state != FeatureState.Available:
            logger.info(
                "[%s] PushUpdates 不可用，将仅依赖 playing() 轮询",
                identifier,
            )
            return
        atv.push_updater.listener = _PlayingPushListener(identifier)
        atv.push_updater.start()
        _play_push_started.add(identifier)
        logger.info("[%s] 已订阅播放状态推送 (push_updater)", identifier)
    except Exception as e:
        logger.warning("[%s] 启动 push_updater 失败: %s", identifier, e)


async def _read_playing_state(atv: AppleTV) -> PlayingStateOut:
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

    snap = _playing_snapshot_from_playing(playing)
    return snap.model_copy(update={"app": app_out})


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/scan", response_model=ScanResponse)
async def scan_network(timeout: int = 8) -> ScanResponse:
    loop = get_loop()
    st = get_storage()
    timeout = max(3, min(timeout, 30))
    devices = await pyatv.scan(loop, timeout=timeout, storage=st)
    await st.save()
    _invalidate_cred_flags_cache()
    return ScanResponse(devices=[config_to_device(c) for c in devices])


@app.post("/api/pair/begin", response_model=PairBeginResponse)
async def pair_begin(body: PairBeginBody) -> PairBeginResponse:
    loop = get_loop()
    st = get_storage()
    confs = await pyatv.scan(
        loop, identifier=body.identifier, timeout=10, storage=st
    )
    if not confs:
        raise HTTPException(status_code=404, detail="未找到设备")
    conf = confs[0]
    proto = _pairing_eligible_protocol(conf)
    if proto is None:
        raise HTTPException(
            status_code=400,
            detail="没有可配对的协议（Companion / AirPlay / MRP），或各协议凭据已齐全。",
        )
    try:
        pairing = await pyatv.pair(conf, proto, loop, storage=st)
        await pairing.begin()
    except atv_exc.NoServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    enter_on_tv: str | None = None
    if pairing.device_provides_pin:
        pass
    else:
        pin_int = random.randint(1000, 9999)
        pairing.pin(pin_int)
        enter_on_tv = str(pin_int)

    sid = str(uuid.uuid4())
    _pairing_sessions[sid] = (pairing, proto)
    return PairBeginResponse(
        session_id=sid,
        device_provides_pin=pairing.device_provides_pin,
        protocol=proto.name,
        enter_on_tv_pin=enter_on_tv,
    )


@app.post("/api/pair/pin")
async def pair_pin(body: PairPinBody) -> dict[str, str]:
    entry = _pairing_sessions.get(body.session_id)
    if not entry:
        raise HTTPException(status_code=404, detail="配对会话不存在或已结束")
    pairing, _ = entry
    try:
        pin_val = int(body.pin.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="PIN 应为数字") from e
    pairing.pin(pin_val)
    return {"status": "ok"}


@app.post("/api/pair/finish")
async def pair_finish(body: PairFinishBody) -> dict[str, Any]:
    entry = _pairing_sessions.pop(body.session_id, None)
    if not entry:
        raise HTTPException(status_code=404, detail="配对会话不存在或已结束")
    pairing, _ = entry
    try:
        await pairing.finish()
        ok = pairing.has_paired
    finally:
        await pairing.close()
    if ok:
        await get_storage().save()
        _invalidate_cred_flags_cache()
    return {"paired": ok}


@app.post("/api/pair/cancel")
async def pair_cancel(body: PairFinishBody) -> dict[str, str]:
    entry = _pairing_sessions.pop(body.session_id, None)
    if entry:
        pairing, _ = entry
        await pairing.close()
    return {"status": "ok"}


@app.post("/api/devices/{identifier}/disconnect")
async def disconnect_device(identifier: str) -> dict[str, str]:
    await _close_atv(identifier)
    await _close_atv_meta(identifier)
    _connect_mode.pop(identifier, None)
    _invalidate_cred_flags_cache(identifier)
    return {"status": "ok"}


@app.post("/api/devices/{identifier}/remote")
async def send_remote(identifier: str, body: RemoteBody) -> dict[str, str]:
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            atv = await get_or_connect(identifier)
            await invoke_remote(
                atv,
                body.command,
                body.action,
                body.position_sec,
            )
            return {"status": "ok"}
        except HTTPException:
            raise
        except atv_exc.NotSupportedError as e:
            if attempt == 0 and _connect_mode.get(identifier) != "no_mrp":
                logger.warning(
                    "遥控接口未就绪 (%s)，将禁用 MRP 后重连并重试: %s",
                    body.command,
                    e,
                )
                _connect_mode[identifier] = "no_mrp"
                await _close_atv(identifier)
                continue
            raise HTTPException(
                status_code=400,
                detail=(
                    "无法通过当前连接发送遥控键。请在「配对」中完成 **Companion** 配对"
                    "（tvOS 15+ 上很常见）；若只配对了 AirPlay，通常无法控制方向键与确认。"
                ),
            ) from e
        except Exception as e:
            last_err = e
            logger.warning("遥控失败 (尝试 %s): %s", attempt + 1, e)
            await _close_atv(identifier)
    raise HTTPException(
        status_code=503,
        detail=f"发送指令失败: {last_err}",
    ) from last_err


async def _build_merged_playing_from_atv(
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

    await _ensure_playback_push(atv, identifier)
    await asyncio.sleep(0.25)
    polled = await _read_playing_state(atv)
    cached = _playing_cache.get(identifier)
    merged = _merge_playing_priority(polled, cached)

    if _is_playing_payload_empty(merged):
        hint: str | None = None
        creds = await _scan_cred_flags_cached(identifier)
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


@app.get(
    "/api/devices/{identifier}/playing",
    response_model=PlayingStateOut,
)
async def get_playing(identifier: str) -> PlayingStateOut:
    last_blocked: BaseException | None = None
    for attempt in range(3):
        atv: AppleTV | None = None
        try:
            atv = await get_or_connect_for_playing(identifier)
            return await _build_merged_playing_from_atv(identifier, atv)
        except atv_exc.BlockedStateError as e:
            last_blocked = e
            logger.warning(
                "播放状态连接已关闭或阻塞 (尝试 %s/3): %s",
                attempt + 1,
                e,
            )
            if atv is not None:
                await _evict_stale_atv(identifier, atv)
            continue
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("获取播放状态失败: %s", e)
            raise HTTPException(
                status_code=503,
                detail=f"无法读取播放状态: {e}",
            ) from e

    raise HTTPException(
        status_code=503,
        detail="播放状态连接多次失效，请点「断开」后重试。",
    ) from last_blocked


_SSE_STREAM_PUSH_WAIT_SEC = 2.5
_SSE_STREAM_KEEPALIVE_SEC = 25.0


async def _playing_sse_generator(identifier: str):
    """推送 + 定期 playing() 轮询；避免仅依赖 PushUpdates（很多环境下几乎不发进度）。"""
    q: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
    lst = _playing_sse_queues.setdefault(identifier, [])
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
            return await _build_merged_playing_from_atv(identifier, atv)
        except atv_exc.BlockedStateError:
            if atv is not None:
                await _evict_stale_atv(identifier, atv)
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
                    q.get(), timeout=_SSE_STREAM_PUSH_WAIT_SEC
                )
                if should_send(payload):
                    yield f"data: {payload}\n\n"
            except asyncio.TimeoutError:
                polled = await poll_merged()
                if polled is not None:
                    pline = polled.model_dump_json()
                    if should_send(pline):
                        yield f"data: {pline}\n\n"

            if time.monotonic() - last_yield_mono >= _SSE_STREAM_KEEPALIVE_SEC:
                yield ": keepalive\n\n"
                last_yield_mono = time.monotonic()
    finally:
        subs = _playing_sse_queues.get(identifier)
        if subs:
            try:
                subs.remove(q)
            except ValueError:
                pass
            if not subs:
                _playing_sse_queues.pop(identifier, None)


@app.get("/api/devices/{identifier}/playing/stream")
async def stream_playing(identifier: str) -> StreamingResponse:
    """SSE：pyatv 推送（若有）+ 约每 2.5s playing() 合并快照，与 GET /playing 一致。"""
    return StreamingResponse(
        _playing_sse_generator(identifier),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get(
    "/api/devices/{identifier}/playing/artwork",
    response_class=Response,
)
async def get_playing_artwork(
    identifier: str,
    w: int | None = Query(None, ge=32, le=2048),
    h: int | None = Query(None, ge=32, le=2048),
) -> Response:
    aw_w = w if w is not None else 480
    aw_h = h
    last_blocked: BaseException | None = None
    for attempt in range(3):
        atv: AppleTV | None = None
        try:
            atv = await get_or_connect_for_playing(identifier)
            info = await atv.metadata.artwork(width=aw_w, height=aw_h)
            if info is None or not info.bytes:
                raise HTTPException(
                    status_code=404,
                    detail="当前无可用封面图",
                )
            return Response(
                content=info.bytes,
                media_type=info.mimetype or "image/jpeg",
            )
        except HTTPException:
            raise
        except atv_exc.NotSupportedError as e:
            raise HTTPException(
                status_code=404,
                detail="当前连接不支持获取封面图",
            ) from e
        except atv_exc.BlockedStateError as e:
            last_blocked = e
            if atv is not None:
                await _evict_stale_atv(identifier, atv)
            continue
        except Exception as e:
            logger.warning("读取封面失败: %s", e)
            raise HTTPException(
                status_code=503,
                detail=f"读取封面失败: {e}",
            ) from e

    raise HTTPException(
        status_code=503,
        detail=f"封面请求连接失效: {last_blocked}",
    ) from last_blocked


def _configure_frontend(app: FastAPI) -> None:
    raw = os.environ.get("ATV_STATIC_DIR", "").strip()
    if raw:
        static_root = Path(raw).resolve()
    else:
        static_root = (Path(__file__).resolve().parent / "static").resolve()
    if not static_root.is_dir():
        logger.info("未找到前端静态目录 %s，仅提供 API", static_root)
        return
    index_html = static_root / "index.html"
    if not index_html.is_file():
        logger.warning("静态目录缺少 index.html: %s", static_root)
        return
    assets_dir = static_root / "assets"
    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="spa_assets",
        )

    @app.get("/favicon.svg", include_in_schema=False)
    async def spa_favicon() -> FileResponse:
        p = static_root / "favicon.svg"
        if p.is_file():
            return FileResponse(p)
        raise HTTPException(status_code=404)

    @app.get("/", include_in_schema=False)
    async def spa_index() -> FileResponse:
        return FileResponse(index_html)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api"):
            raise HTTPException(status_code=404)
        candidate = (static_root / full_path).resolve()
        try:
            candidate.relative_to(static_root)
        except ValueError:
            raise HTTPException(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_html)


_configure_frontend(app)
