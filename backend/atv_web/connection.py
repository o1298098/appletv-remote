from __future__ import annotations

import asyncio
import time
from copy import deepcopy
from typing import Any, Awaitable, Callable, TypeVar

import pyatv
from fastapi import HTTPException
from pyatv import exceptions as atv_exc
from pyatv.const import InputAction, PairingRequirement, PowerState, Protocol
from pyatv.interface import AppleTV, BaseConfig, DeviceInfo
from atv_web.constants import ACTION_MAP, ALLOWED_COMMANDS, INPUT_COMMANDS
from atv_web.log import logger
from atv_web import state
from atv_web.util import enum_name


def _service_has_credentials(conf: BaseConfig, protocol: Protocol) -> bool:
    svc = conf.get_service(protocol)
    return bool(svc and svc.credentials)


def pairing_eligible_protocol(conf: BaseConfig) -> Protocol | None:
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


def invalidate_cred_flags_cache(identifier: str | None = None) -> None:
    if identifier is None:
        state._cred_flags_cache.clear()
    else:
        state._cred_flags_cache.pop(identifier, None)


async def _scan_cred_flags(identifier: str) -> tuple[bool, bool, bool] | None:
    loop = state.get_loop()
    st = state.get_storage()
    confs = await pyatv.scan(loop, identifier=identifier, timeout=8, storage=st)
    if not confs:
        return None
    c = confs[0]
    return (
        _service_has_credentials(c, Protocol.MRP),
        _service_has_credentials(c, Protocol.Companion),
        _service_has_credentials(c, Protocol.AirPlay),
    )


async def scan_cred_flags_cached(identifier: str) -> tuple[bool, bool, bool] | None:
    now = time.monotonic()
    hit = state._cred_flags_cache.get(identifier)
    if hit and now - hit[0] < state._CRED_FLAGS_TTL_SEC:
        return hit[1]
    flags = await _scan_cred_flags(identifier)
    if flags is not None:
        state._cred_flags_cache[identifier] = (now, flags)
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
        atv.keyboard.listener = None
    except Exception:
        pass
    try:
        atv.push_updater.stop()
    except Exception:
        pass
    try:
        await asyncio.gather(*atv.close())
    except Exception:
        logger.exception("关闭 pyatv 连接时出错")


async def close_atv(identifier: str) -> None:
    atv = state._clients.pop(identifier, None)
    state._keyboard_listener_started.discard(identifier)
    state._keyboard_listener_refs.pop(identifier, None)
    await _shutdown_atv(atv)
    if identifier not in state._clients_meta:
        state._play_push_started.discard(identifier)
        state._playing_cache.pop(identifier, None)


async def close_atv_meta(identifier: str) -> None:
    await _shutdown_atv(state._clients_meta.pop(identifier, None))
    state._play_push_started.discard(identifier)
    state._playing_cache.pop(identifier, None)


async def close_all_clients() -> None:
    ids = set(state._clients) | set(state._clients_meta)
    for i in ids:
        await _shutdown_atv(state._clients.pop(i, None))
        await _shutdown_atv(state._clients_meta.pop(i, None))
    state._play_push_started.clear()
    state._playing_cache.clear()
    state._connect_mode.clear()
    state._keyboard_listener_started.clear()
    state._keyboard_listener_refs.clear()
    state._keyboard_sse_queues.clear()


async def get_or_connect(identifier: str) -> AppleTV:
    from atv_web.keyboard import ensure_keyboard_listener

    loop = state.get_loop()
    st = state.get_storage()
    async with state._lock:
        existing = state._clients.get(identifier)
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
        if state._connect_mode.get(identifier) == "no_mrp":
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
        state._clients[identifier] = atv
        await ensure_keyboard_listener(identifier, atv)
        return atv


async def get_or_connect_for_playing(identifier: str) -> AppleTV:
    loop = state.get_loop()
    st = state.get_storage()
    async with state._lock:
        meta = state._clients_meta.get(identifier)
        if meta is not None:
            return meta

        main = state._clients.get(identifier)

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
        state._clients_meta[identifier] = atv
        logger.info("已为 %s 建立元数据连接", identifier)
        return atv


async def evict_stale_atv(identifier: str, atv: AppleTV) -> None:
    async with state._lock:
        if state._clients_meta.get(identifier) is atv:
            state._clients_meta.pop(identifier, None)
        elif state._clients.get(identifier) is atv:
            state._clients.pop(identifier, None)
    state._play_push_started.discard(identifier)
    state._playing_cache.pop(identifier, None)
    state._keyboard_listener_started.discard(identifier)
    state._keyboard_listener_refs.pop(identifier, None)
    await _shutdown_atv(atv)


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
            pstate = atv.power.power_state
        except atv_exc.NotSupportedError:
            await atv.power.turn_on()
            return
        if pstate == PowerState.On:
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


_T = TypeVar("_T")


def jsonify_feature_options(raw: dict[str, object] | None) -> dict[str, Any]:
    if not raw:
        return {}
    out: dict[str, Any] = {}
    for k, v in raw.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            out[k] = v
        elif isinstance(v, (list, tuple)):
            out[k] = [
                x if isinstance(x, (str, int, float, bool)) or x is None else str(x)
                for x in v
            ]
        else:
            out[k] = str(v)
    return out


def device_info_payload(info: DeviceInfo) -> dict[str, Any]:
    return {
        "operating_system": enum_name(info.operating_system),
        "version": info.version,
        "build_number": info.build_number,
        "model": enum_name(info.model),
        "model_str": info.model_str,
        "raw_model": info.raw_model,
        "mac": info.mac,
        "output_device_id": info.output_device_id,
    }


async def device_call_twice(
    identifier: str,
    fn: Callable[[AppleTV], Awaitable[_T]],
) -> _T:
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            atv = await get_or_connect(identifier)
            return await fn(atv)
        except HTTPException:
            raise
        except atv_exc.AuthenticationError as e:
            raise HTTPException(
                status_code=401,
                detail="未配对或凭据无效，请完成配对。",
            ) from e
        except atv_exc.NotSupportedError as e:
            raise HTTPException(
                status_code=400,
                detail=str(e) or "当前连接不支持此操作。",
            ) from e
        except Exception as e:
            last_err = e
            logger.warning("设备操作失败 (尝试 %s): %s", attempt + 1, e)
            await close_atv(identifier)
    raise HTTPException(
        status_code=503,
        detail=f"操作失败: {last_err}",
    ) from last_err
