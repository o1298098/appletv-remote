from __future__ import annotations

import random
import uuid

import pyatv
from fastapi import APIRouter, HTTPException
from pyatv import exceptions as atv_exc

from atv_web import state
from atv_web.connection import (
    config_to_device,
    invalidate_cred_flags_cache,
    pairing_eligible_protocol,
)
from atv_web.schemas import (
    PairBeginBody,
    PairBeginResponse,
    PairFinishBody,
    PairPinBody,
    ScanResponse,
)

router = APIRouter()


@router.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/api/scan", response_model=ScanResponse)
async def scan_network(timeout: int = 8) -> ScanResponse:
    loop = state.get_loop()
    st = state.get_storage()
    timeout = max(3, min(timeout, 30))
    devices = await pyatv.scan(loop, timeout=timeout, storage=st)
    await st.save()
    invalidate_cred_flags_cache()
    return ScanResponse(devices=[config_to_device(c) for c in devices])


@router.post("/api/pair/begin", response_model=PairBeginResponse)
async def pair_begin(body: PairBeginBody) -> PairBeginResponse:
    loop = state.get_loop()
    st = state.get_storage()
    confs = await pyatv.scan(
        loop, identifier=body.identifier, timeout=10, storage=st
    )
    if not confs:
        raise HTTPException(status_code=404, detail="未找到设备")
    conf = confs[0]
    proto = pairing_eligible_protocol(conf)
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
    state._pairing_sessions[sid] = (pairing, proto)
    return PairBeginResponse(
        session_id=sid,
        device_provides_pin=pairing.device_provides_pin,
        protocol=proto.name,
        enter_on_tv_pin=enter_on_tv,
    )


@router.post("/api/pair/pin")
async def pair_pin(body: PairPinBody) -> dict[str, str]:
    entry = state._pairing_sessions.get(body.session_id)
    if not entry:
        raise HTTPException(status_code=404, detail="配对会话不存在或已结束")
    pairing, _ = entry
    try:
        pin_val = int(body.pin.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="PIN 应为数字") from e
    pairing.pin(pin_val)
    return {"status": "ok"}


@router.post("/api/pair/finish")
async def pair_finish(body: PairFinishBody) -> dict[str, object]:
    entry = state._pairing_sessions.pop(body.session_id, None)
    if not entry:
        raise HTTPException(status_code=404, detail="配对会话不存在或已结束")
    pairing, _ = entry
    try:
        await pairing.finish()
        ok = pairing.has_paired
    finally:
        await pairing.close()
    if ok:
        await state.get_storage().save()
        invalidate_cred_flags_cache()
    return {"paired": ok}


@router.post("/api/pair/cancel")
async def pair_cancel(body: PairFinishBody) -> dict[str, str]:
    entry = state._pairing_sessions.pop(body.session_id, None)
    if entry:
        pairing, _ = entry
        await pairing.close()
    return {"status": "ok"}
