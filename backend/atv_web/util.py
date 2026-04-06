from __future__ import annotations

from typing import Any


def enum_name(value: Any) -> str:
    name = getattr(value, "name", None)
    return str(name) if name is not None else str(value)


def int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
