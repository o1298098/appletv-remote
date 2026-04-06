from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pyatv import exceptions as atv_exc
from pyatv.interface import AppleTV

from atv_web import state
from atv_web.connection import (
    close_atv,
    close_atv_meta,
    device_call_twice,
    get_or_connect,
    invalidate_cred_flags_cache,
    invoke_remote,
)
from atv_web.itunes import enrich_installed_app_icons_itunes, pyatv_app_icon_url
from atv_web.log import logger
from atv_web.schemas import (
    AppsListResponse,
    InstalledAppOut,
    LaunchAppBody,
    RemoteBody,
    VolumeSetBody,
    VolumeStateResponse,
)
from atv_web.touch_volume import (
    apply_target_volume_via_remote_keys,
    facade_volume_best_effort,
    try_companion_get_volume_percent,
)

router = APIRouter()


@router.post("/api/devices/{identifier}/disconnect")
async def disconnect_device(identifier: str) -> dict[str, str]:
    await close_atv(identifier)
    await close_atv_meta(identifier)
    state._connect_mode.pop(identifier, None)
    invalidate_cred_flags_cache(identifier)
    return {"status": "ok"}


@router.post("/api/devices/{identifier}/remote")
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
            if attempt == 0 and state._connect_mode.get(identifier) != "no_mrp":
                logger.warning(
                    "遥控接口未就绪 (%s)，将禁用 MRP 后重连并重试: %s",
                    body.command,
                    e,
                )
                state._connect_mode[identifier] = "no_mrp"
                await close_atv(identifier)
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
            await close_atv(identifier)
    raise HTTPException(
        status_code=503,
        detail=f"发送指令失败: {last_err}",
    ) from last_err


@router.get(
    "/api/devices/{identifier}/volume",
    response_model=VolumeStateResponse,
)
async def get_device_volume(identifier: str) -> VolumeStateResponse:
    async def op(atv: AppleTV) -> VolumeStateResponse:
        v = 0.0
        not_supported = False
        try:
            v = facade_volume_best_effort(atv)
        except atv_exc.NotSupportedError:
            not_supported = True
        except Exception as e:
            logger.debug("读取 pyatv 音量缓存失败 %s: %s", identifier, e)

        if not_supported or v <= 0.0:
            cv = await try_companion_get_volume_percent(atv)
            if cv is not None:
                return VolumeStateResponse(supported=True, level=cv)

        if not_supported:
            return VolumeStateResponse(supported=False, level=None)

        return VolumeStateResponse(supported=True, level=round(float(v), 2))

    return await device_call_twice(identifier, op)


@router.post("/api/devices/{identifier}/volume")
async def set_device_volume(
    identifier: str, body: VolumeSetBody
) -> dict[str, str]:
    async def op(atv: AppleTV) -> None:
        await apply_target_volume_via_remote_keys(atv, float(body.level))
        try:
            await atv.audio.set_volume(float(body.level))
        except Exception:
            pass

    await device_call_twice(identifier, op)
    return {"status": "ok"}


@router.get(
    "/api/devices/{identifier}/apps",
    response_model=AppsListResponse,
)
async def list_installed_apps(identifier: str) -> AppsListResponse:
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            atv = await get_or_connect(identifier)
            raw = await atv.apps.app_list()
            out: list[InstalledAppOut] = []
            for a in raw:
                ident = str(getattr(a, "identifier", "") or "").strip()
                if not ident:
                    continue
                nm = getattr(a, "name", None)
                name = str(nm).strip() if nm is not None else None
                if name == "":
                    name = None
                icon = pyatv_app_icon_url(a)
                out.append(
                    InstalledAppOut(name=name, identifier=ident, icon_url=icon)
                )
            out.sort(
                key=lambda x: (
                    (x.name or "").lower(),
                    x.identifier.lower(),
                )
            )
            out = await enrich_installed_app_icons_itunes(out)
            return AppsListResponse(apps=out)
        except HTTPException:
            raise
        except atv_exc.NotSupportedError as e:
            raise HTTPException(
                status_code=400,
                detail=(
                    "当前连接不支持列出已安装应用。请完成 **Companion** 配对；"
                    "tvOS 15+ 上通常需要 Companion 才能列出/启动应用。"
                ),
            ) from e
        except Exception as e:
            last_err = e
            logger.warning("读取应用列表失败 (尝试 %s): %s", attempt + 1, e)
            await close_atv(identifier)
    raise HTTPException(
        status_code=503,
        detail=f"无法读取应用列表: {last_err}",
    ) from last_err


@router.post("/api/devices/{identifier}/apps/launch")
async def launch_installed_app(
    identifier: str, body: LaunchAppBody
) -> dict[str, str]:
    target = body.target.strip()
    if not target:
        raise HTTPException(status_code=400, detail="target 不能为空")
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            atv = await get_or_connect(identifier)
            await atv.apps.launch_app(target)
            return {"status": "ok"}
        except HTTPException:
            raise
        except atv_exc.NotSupportedError as e:
            raise HTTPException(
                status_code=400,
                detail=(
                    "当前连接不支持从网络侧启动应用，请完成 **Companion** 配对后重试。"
                ),
            ) from e
        except Exception as e:
            last_err = e
            logger.warning("启动应用失败 (尝试 %s): %s", attempt + 1, e)
            await close_atv(identifier)
    raise HTTPException(
        status_code=503,
        detail=f"启动失败: {last_err}",
    ) from last_err
