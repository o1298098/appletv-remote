"""ASGI 入口：``uvicorn main:app``。实现位于 ``atv_web`` 包。"""

from atv_web.app import app

__all__ = ["app"]
