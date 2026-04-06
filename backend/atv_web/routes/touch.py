from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pyatv.const import TouchAction
from pyatv.interface import AppleTV

from atv_web.constants import ACTION_MAP, TOUCH_MODES
from atv_web.connection import device_call_twice
from atv_web.schemas import TouchActionPointBody, TouchClickBody, TouchSwipeBody
from atv_web.touch_volume import touchpad_click_at_xy, touchpad_swipe

router = APIRouter()


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
