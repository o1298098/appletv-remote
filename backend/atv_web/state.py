from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from pyatv.const import Protocol
from pyatv.interface import AppleTV, PairingHandler
from pyatv.storage.file_storage import FileStorage

storage: FileStorage | None = None
_loop: asyncio.AbstractEventLoop | None = None
_clients: dict[str, AppleTV] = {}
_clients_meta: dict[str, AppleTV] = {}
_connect_mode: dict[str, str] = {}
_pairing_sessions: dict[str, tuple[PairingHandler, Protocol]] = {}
_lock = asyncio.Lock()
_playing_cache: dict[str, Any] = {}
_play_push_started: set[str] = set()
_playing_sse_queues: dict[str, list[asyncio.Queue[str]]] = {}
_keyboard_sse_queues: dict[str, list[asyncio.Queue[str]]] = {}
_keyboard_listener_started: set[str] = set()
_keyboard_listener_refs: dict[str, Any] = {}
_cred_flags_cache: dict[str, tuple[float, tuple[bool, bool, bool]]] = {}
_CRED_FLAGS_TTL_SEC = 60.0


def get_loop() -> asyncio.AbstractEventLoop:
    if _loop is None:
        raise RuntimeError("事件循环未初始化")
    return _loop


def get_storage() -> FileStorage:
    if storage is None:
        raise RuntimeError("存储未初始化")
    return storage


def storage_path() -> Path:
    return Path(os.environ.get("PYATV_STORAGE", "pyatv.json"))


def cors_origins() -> list[str]:
    raw = os.environ.get("ATV_CORS_ORIGINS", "*").strip()
    if raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]
