"""Apple TV 专用遥控后端：局域网扫描、一次性配对、多设备切换与按键指令。"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import uuid
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any

import pyatv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pyatv import exceptions as atv_exc
from pyatv.const import InputAction, PairingRequirement, Protocol
from pyatv.interface import AppleTV, BaseConfig, PairingHandler
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

# 仅保留 Apple TV 导航与常用媒体键（界面也只暴露这些）
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
# tvOS 15+ 常见：MRP 广播仍在但遥控走 Companion；首次按键失败则禁用 MRP 再连一次
_connect_mode: dict[str, str] = {}
_pairing_sessions: dict[str, tuple[PairingHandler, Protocol]] = {}
_lock = asyncio.Lock()


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
    for proto in (Protocol.MRP, Protocol.Companion):
        svc = conf.get_service(proto)
        if svc is None:
            continue
        if svc.pairing in (
            PairingRequirement.Mandatory,
            PairingRequirement.Optional,
        ):
            return proto
    return None


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


async def _close_atv(identifier: str) -> None:
    atv = _clients.pop(identifier, None)
    if atv is None:
        return
    try:
        await asyncio.gather(*atv.close())
    except Exception:
        logger.exception("关闭连接时出错: %s", identifier)


async def close_all_clients() -> None:
    ids = list(_clients.keys())
    for i in ids:
        await _close_atv(i)
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


async def invoke_remote(rc: Any, command: str, action: str | None) -> None:
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail="不支持的遥控指令")

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
    enter_on_tv_pin: str | None = Field(
        default=None,
        description="电视向本机索要 PIN 时为空；否则为需在电视上输入的 PIN",
    )


class PairPinBody(BaseModel):
    session_id: str
    pin: str = Field(..., min_length=1, max_length=16)


class PairFinishBody(BaseModel):
    session_id: str


class RemoteBody(BaseModel):
    command: str
    action: str | None = None


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
            detail="没有可配对的协议（MRP/Companion），或设备已可连接。",
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
    _connect_mode.pop(identifier, None)
    return {"status": "ok"}


@app.post("/api/devices/{identifier}/remote")
async def send_remote(identifier: str, body: RemoteBody) -> dict[str, str]:
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            atv = await get_or_connect(identifier)
            await invoke_remote(atv.remote_control, body.command, body.action)
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


def _configure_frontend(app: FastAPI) -> None:
    """若存在构建后的前端目录，则由本进程托管静态资源并回退到 SPA。"""
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
