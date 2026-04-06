from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pyatv.const import TouchAction
from pyatv.interface import AppleTV

from atv_web.constants import ACTION_MAP, TOUCH_MODES
from atv_web.connection import device_call_twice, get_or_connect
from atv_web.schemas import TouchActionPointBody, TouchClickBody, TouchSwipeBody
from atv_web.touch_volume import touchpad_click_at_xy, touchpad_swipe

router = APIRouter()
WS_HOLD_INTERVAL_SEC = 1 / 60


def _clamp_xy(x: int, y: int) -> tuple[int, int]:
    return max(0, min(1000, x)), max(0, min(1000, y))


@router.post("/api/devices/{identifier}/touch/swipe")
async def touch_swipe(identifier: str, body: TouchSwipeBody) -> dict[str, str]:
    async def op(atv: AppleTV) -> None:
        await touchpad_swipe(
            atv,
            body.start_x,
            body.start_y,
            body.end_x,
            body.end_y,
            body.duration_ms,
        )

    await device_call_twice(identifier, op)
    return {"status": "ok"}


@router.post("/api/devices/{identifier}/touch/action")
async def touch_action(identifier: str, body: TouchActionPointBody) -> dict[str, str]:
    mode = TOUCH_MODES.get(body.mode)
    if mode is None:
        raise HTTPException(
            status_code=400,
            detail="mode 须为 1(Press)、3(Hold)、4(Release) 或 5(Click)。",
        )

    async def op(atv: AppleTV) -> None:
        if mode is TouchAction.Click:
            await touchpad_click_at_xy(atv, body.x, body.y)
        else:
            await atv.touch.action(body.x, body.y, mode)

    await device_call_twice(identifier, op)
    return {"status": "ok"}


@router.post("/api/devices/{identifier}/touch/click")
async def touch_click(identifier: str, body: TouchClickBody) -> dict[str, str]:
    ia = ACTION_MAP[body.action]

    async def op(atv: AppleTV) -> None:
        await atv.touch.click(ia)

    await device_call_twice(identifier, op)
    return {"status": "ok"}


@router.websocket("/api/devices/{identifier}/touch/ws")
async def touch_ws(identifier: str, ws: WebSocket) -> None:
    await ws.accept()
    try:
        atv = await get_or_connect(identifier)
    except Exception:
        await ws.send_json({"type": "error", "detail": "设备不可用或未连接"})
        await ws.close(code=1011)
        return

    lock = asyncio.Lock()
    pressed = False
    last_xy = (500, 500)
    pending_hold: tuple[int, int] | None = None
    active_gesture_id = 0
    hold_task: asyncio.Task[None] | None = None

    async def send_action(x: int, y: int, mode: TouchAction) -> None:
        nonlocal pressed, last_xy
        cx, cy = _clamp_xy(x, y)
        async with lock:
            await atv.touch.action(cx, cy, mode)
            last_xy = (cx, cy)
            if mode is TouchAction.Press:
                pressed = True
            elif mode is TouchAction.Release:
                pressed = False

    async def hold_pump() -> None:
        nonlocal pending_hold, last_xy
        try:
            while True:
                await asyncio.sleep(WS_HOLD_INTERVAL_SEC)
                async with lock:
                    nxt = pending_hold
                    pending_hold = None
                    if not pressed or nxt is None:
                        continue
                    cx, cy = _clamp_xy(nxt[0], nxt[1])
                    await atv.touch.action(cx, cy, TouchAction.Hold)
                    last_xy = (cx, cy)
        except asyncio.CancelledError:
            return
        except Exception:
            return

    def parse_gid(raw: object) -> int:
        try:
            return int(raw)
        except Exception:
            return 0

    try:
        hold_task = asyncio.create_task(hold_pump())
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")
            gid = parse_gid(msg.get("gid"))
            if kind == "action":
                try:
                    x = int(msg.get("x"))
                    y = int(msg.get("y"))
                    mode_raw = int(msg.get("mode"))
                except Exception:
                    continue
                mode = TOUCH_MODES.get(mode_raw)
                if mode is None:
                    continue
                if mode is TouchAction.Click:
                    await touchpad_click_at_xy(atv, x, y)
                elif mode is TouchAction.Press:
                    pending_hold = None
                    active_gesture_id = gid
                    await send_action(x, y, TouchAction.Press)
                elif mode is TouchAction.Hold:
                    if gid != 0 and gid != active_gesture_id:
                        continue
                    pending_hold = _clamp_xy(x, y)
                elif mode is TouchAction.Release:
                    if gid != 0 and gid != active_gesture_id:
                        continue
                    pending_hold = None
                    if not pressed:
                        sx, sy = _clamp_xy(x, y)
                        await send_action(sx, sy, TouchAction.Press)
                    await send_action(x, y, TouchAction.Release)
                    active_gesture_id = 0
            elif kind == "click":
                action = str(msg.get("action") or "single")
                ia = ACTION_MAP.get(action)
                if ia is None:
                    continue
                await atv.touch.click(ia)
            elif kind == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        if hold_task is not None:
            hold_task.cancel()
        try:
            if pressed:
                await send_action(last_xy[0], last_xy[1], TouchAction.Release)
        except Exception:
            pass
        return
    except Exception:
        if hold_task is not None:
            hold_task.cancel()
        try:
            if pressed:
                await send_action(last_xy[0], last_xy[1], TouchAction.Release)
        except Exception:
            pass
        await ws.close(code=1011)
