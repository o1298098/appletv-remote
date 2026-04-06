from __future__ import annotations

import asyncio
import time
from typing import Any

from pyatv import exceptions as atv_exc
from pyatv.const import Protocol, TouchAction
from pyatv.interface import AppleTV
from pyatv.protocols.companion.api import HidCommand, MediaControlCommand

from atv_web.constants import (
    TOUCH_TAP_SWIPE_MS,
    VOLUME_REMOTE_DEADBAND_PCT,
    VOLUME_REMOTE_MAX_STEPS,
    VOLUME_REMOTE_PCT_PER_STEP,
    VOLUME_REMOTE_STEP_DELAY_S,
)
from atv_web.log import logger


def companion_api(atv: AppleTV) -> Any | None:
    """从已连接的 Companion 子协议取出 CompanionAPI（audio / touch 共享同一连接）。"""
    for relayer in (atv.audio, atv.touch):
        get_fn = getattr(relayer, "get", None)
        if not callable(get_fn):
            continue
        impl = get_fn(Protocol.Companion)
        if impl is None:
            continue
        api = getattr(impl, "api", None)
        if api is not None:
            return api
    return None


def companion_api_for_touch(atv: AppleTV) -> Any | None:
    """取出 Companion 的 CompanionAPI，用于与 pyatv 内置 touch.click 相同的 HID 序列。"""
    return companion_api(atv)


def facade_volume_best_effort(atv: AppleTV) -> float:
    """合并 MRP 主音量与多输出设备上的音量（Apple TV 可能把电视音量记在子设备上）。"""
    m = float(atv.audio.volume)
    try:
        for d in atv.audio.output_devices:
            m = max(m, float(d.volume))
    except Exception:
        pass
    return m


async def try_companion_get_volume_percent(atv: AppleTV) -> float | None:
    """Companion 主动查询当前音量；MRP 的 volume 在收到推送前常为 0。"""
    api = companion_api(atv)
    if api is None:
        return None
    try:
        resp = await api.mediacontrol_command(MediaControlCommand.GetVolume)
    except Exception as e:
        logger.debug("Companion GetVolume 失败: %s", e)
        return None
    c = resp.get("_c")
    if not isinstance(c, dict):
        return None
    raw = c.get("_vol")
    if raw is None:
        return None
    try:
        return round(float(raw) * 100.0, 2)
    except (TypeError, ValueError):
        return None


async def read_volume_percent_for_nudge(atv: AppleTV) -> float:
    """与 GET /volume 相同的读数逻辑，用于计算拖动目标与当前差；读不到绝对音量时用 50 作中性假设。"""
    v = 0.0
    not_supported = False
    try:
        v = facade_volume_best_effort(atv)
    except atv_exc.NotSupportedError:
        not_supported = True
    except Exception:
        v = 0.0

    if not_supported or v <= 0.0:
        cv = await try_companion_get_volume_percent(atv)
        if cv is not None:
            return cv

    if not_supported:
        return 50.0

    return float(v)


async def apply_target_volume_via_remote_keys(atv: AppleTV, target_pct: float) -> None:
    """
    用 remote_control 的音量键调节到目标附近。

    原先可用的「音量 +/-」走 POST /remote → remote_control.volume_up/down（HID），
    电视/CEC 只认这条；audio.set_volume / Companion SetVolume 在多数环境下不会动电视音量。
    """
    target_pct = max(0.0, min(100.0, float(target_pct)))
    current = await read_volume_percent_for_nudge(atv)
    current = max(0.0, min(100.0, float(current)))
    delta = target_pct - current
    if abs(delta) < VOLUME_REMOTE_DEADBAND_PCT:
        return

    steps = int(
        round(abs(delta) / VOLUME_REMOTE_PCT_PER_STEP),
    )
    steps = max(1, min(VOLUME_REMOTE_MAX_STEPS, steps))

    rc = atv.remote_control
    delay = VOLUME_REMOTE_STEP_DELAY_S

    if delta > 0:
        for _ in range(steps):
            await rc.volume_up()
            await asyncio.sleep(delay)
    else:
        for _ in range(steps):
            await rc.volume_down()
            await asyncio.sleep(delay)


async def touchpad_click_at_xy(atv: AppleTV, x: int, y: int) -> None:
    """pyatv CompanionAPI.click 固定角点 (1000,1000)；此处改为用户点击的 (x,y)。"""
    api = companion_api_for_touch(atv)
    if api is None:
        await atv.touch.swipe(x, y, x, y, TOUCH_TAP_SWIPE_MS)
        return
    await api.hid_command(True, HidCommand.Select)
    await asyncio.sleep(0.02)
    await api.hid_command(False, HidCommand.Select)
    await api.hid_event(x, y, TouchAction.Click)


async def companion_swipe_eased(
    api: Any,
    start_x: int,
    start_y: int,
    end_x: int,
    end_y: int,
    duration_ms: int,
) -> None:
    """Companion 滑动：ease-out 立方（末端减速），比 pyatv 默认线性插值更接近官方触控板手感。"""
    duration_ms = max(40, min(3000, int(duration_ms)))
    sx_f = float(start_x)
    sy_f = float(start_y)
    ex_f = float(end_x)
    ey_f = float(end_y)
    delay = 16 / 1000.0

    await api.hid_event(start_x, start_y, TouchAction.Press)
    t0 = time.time_ns()
    end_ns = t0 + duration_ms * 1_000_000
    while True:
        now = time.time_ns()
        if now >= end_ns:
            break
        span = end_ns - t0
        if span <= 0:
            break
        u = (now - t0) / span
        if u > 1.0:
            u = 1.0
        te = 1.0 - (1.0 - u) ** 3
        xi = int(max(0, min(1000, round(sx_f + (ex_f - sx_f) * te))))
        yi = int(max(0, min(1000, round(sy_f + (ey_f - sy_f) * te))))
        await api.hid_event(xi, yi, TouchAction.Hold)
        await asyncio.sleep(delay)

    rx = max(0, min(1000, int(end_x)))
    ry = max(0, min(1000, int(end_y)))
    await api.hid_event(rx, ry, TouchAction.Release)


async def touchpad_swipe(
    atv: AppleTV,
    start_x: int,
    start_y: int,
    end_x: int,
    end_y: int,
    duration_ms: int,
) -> None:
    api = companion_api_for_touch(atv)
    if api is None:
        await atv.touch.swipe(start_x, start_y, end_x, end_y, duration_ms)
        return
    await companion_swipe_eased(
        api, start_x, start_y, end_x, end_y, duration_ms
    )
