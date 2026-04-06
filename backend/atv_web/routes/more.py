from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pyatv.interface import AppleTV

from atv_web.connection import (
    device_call_twice,
    device_info_payload,
    jsonify_feature_options,
)
from atv_web.keyboard import keyboard_sse_generator, read_keyboard_state_snapshot
from atv_web.schemas import (
    AccountsListResponse,
    DeviceInfoResponse,
    FeaturesListResponse,
    KeyboardOpBody,
    KeyboardStateOut,
    SwitchAccountBody,
    UserAccountOut,
)

router = APIRouter()


@router.get(
    "/api/devices/{identifier}/device-info",
    response_model=DeviceInfoResponse,
)
async def get_device_info(identifier: str) -> DeviceInfoResponse:
    async def op(atv: AppleTV) -> DeviceInfoResponse:
        return DeviceInfoResponse(**device_info_payload(atv.device_info))

    return await device_call_twice(identifier, op)


@router.get(
    "/api/devices/{identifier}/features",
    response_model=FeaturesListResponse,
)
async def list_device_features(
    identifier: str,
    include_unsupported: bool = Query(False),
) -> FeaturesListResponse:
    async def op(atv: AppleTV) -> FeaturesListResponse:
        raw = atv.features.all_features(include_unsupported=include_unsupported)
        feats: list[dict[str, Any]] = []
        for name, info in sorted(raw.items(), key=lambda x: x[0].name):
            feats.append(
                {
                    "name": name.name,
                    "state": info.state.name,
                    "options": jsonify_feature_options(info.options),
                }
            )
        return FeaturesListResponse(features=feats)

    return await device_call_twice(identifier, op)


@router.get(
    "/api/devices/{identifier}/keyboard",
    response_model=KeyboardStateOut,
)
async def get_keyboard_state(identifier: str) -> KeyboardStateOut:
    async def op(atv: AppleTV) -> KeyboardStateOut:
        return await read_keyboard_state_snapshot(atv)

    return await device_call_twice(identifier, op)


@router.post("/api/devices/{identifier}/keyboard", response_model=KeyboardStateOut)
async def keyboard_operation(
    identifier: str, body: KeyboardOpBody
) -> KeyboardStateOut:
    if body.op in ("append", "set") and body.text is None:
        raise HTTPException(
            status_code=400,
            detail="append / set 需要提供 text 字段（可为空字符串）。",
        )

    async def op(atv: AppleTV) -> KeyboardStateOut:
        kb = atv.keyboard
        if body.op == "clear":
            await kb.text_clear()
        elif body.op == "append":
            await kb.text_append(body.text or "")
        else:
            await kb.text_set(body.text or "")
        return await read_keyboard_state_snapshot(atv)

    return await device_call_twice(identifier, op)


@router.get("/api/devices/{identifier}/keyboard/stream")
async def stream_keyboard(identifier: str) -> StreamingResponse:
    """SSE：KeyboardListener（若有）+ 定时 polling 合并快照；polling 用于补焦点推送缺失。"""
    return StreamingResponse(
        keyboard_sse_generator(identifier),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/api/devices/{identifier}/accounts",
    response_model=AccountsListResponse,
)
async def list_user_accounts(identifier: str) -> AccountsListResponse:
    async def op(atv: AppleTV) -> AccountsListResponse:
        raw = await atv.user_accounts.account_list()
        out = [
            UserAccountOut(
                name=a.name,
                identifier=a.identifier,
            )
            for a in raw
        ]
        return AccountsListResponse(accounts=out)

    return await device_call_twice(identifier, op)


@router.post("/api/devices/{identifier}/accounts/switch")
async def switch_user_account(
    identifier: str, body: SwitchAccountBody
) -> dict[str, str]:
    async def op(atv: AppleTV) -> None:
        await atv.user_accounts.switch_account(body.account_id.strip())

    await device_call_twice(identifier, op)
    return {"status": "ok"}
