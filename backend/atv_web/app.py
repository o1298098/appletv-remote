from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pyatv.storage.file_storage import FileStorage

import atv_web.log  # noqa: F401 — 初始化 logging
from atv_web import state
from atv_web.connection import close_all_clients
from atv_web.log import logger
from atv_web.routes import register_api_routes


@asynccontextmanager
async def lifespan(app: FastAPI):
    state._loop = asyncio.get_running_loop()
    path = state.storage_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    state.storage = FileStorage(str(path), state._loop)
    await state.storage.load()
    logger.info("已加载凭据存储: %s", path)
    yield
    await close_all_clients()
    for sid, (handler, _) in list(state._pairing_sessions.items()):
        try:
            await handler.close()
        except Exception:
            logger.exception("关闭配对会话: %s", sid)
    state._pairing_sessions.clear()


app = FastAPI(title="Apple TV Remote", lifespan=lifespan)

_origins = state.cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_api_routes(app)


def configure_frontend(application: FastAPI) -> None:
    raw = os.environ.get("ATV_STATIC_DIR", "").strip()
    if raw:
        static_root = Path(raw).resolve()
    else:
        static_root = (Path(__file__).resolve().parent.parent / "static").resolve()
    if not static_root.is_dir():
        logger.info("未找到前端静态目录 %s，仅提供 API", static_root)
        return
    index_html = static_root / "index.html"
    if not index_html.is_file():
        logger.warning("静态目录缺少 index.html: %s", static_root)
        return
    assets_dir = static_root / "assets"
    if assets_dir.is_dir():
        application.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="spa_assets",
        )

    @application.get("/favicon.svg", include_in_schema=False)
    async def spa_favicon() -> FileResponse:
        p = static_root / "favicon.svg"
        if p.is_file():
            return FileResponse(p)
        raise HTTPException(status_code=404)

    @application.get("/", include_in_schema=False)
    async def spa_index() -> FileResponse:
        return FileResponse(index_html)

    @application.get("/{full_path:path}", include_in_schema=False)
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


configure_frontend(app)
