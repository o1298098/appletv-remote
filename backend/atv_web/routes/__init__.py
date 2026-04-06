from __future__ import annotations

from fastapi import FastAPI

from atv_web.routes import core, devices, more, playback_routes, touch


def register_api_routes(app: FastAPI) -> None:
    app.include_router(core.router)
    app.include_router(devices.router)
    app.include_router(touch.router)
    app.include_router(more.router)
    app.include_router(playback_routes.router)
