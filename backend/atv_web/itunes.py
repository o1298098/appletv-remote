from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any

from atv_web.log import logger
from atv_web.schemas import InstalledAppOut

_itunes_artwork_cache: dict[str, tuple[float, str | None]] = {}
_ITUNES_ARTWORK_CACHE_TTL_SEC = 86400 * 7


def itunes_app_icons_enabled() -> bool:
    return os.environ.get("ATV_ITUNES_APP_ICONS", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def pyatv_app_icon_url(raw_app: Any) -> str | None:
    """若将来 pyatv 在 App 上暴露图标地址，则自动带上（当前官方版通常仅有 name/identifier）。"""
    for key in ("icon", "icon_url", "artwork_url", "image_url"):
        v = getattr(raw_app, key, None)
        if isinstance(v, str):
            s = v.strip()
            if s.startswith(("http://", "https://")):
                return s.replace("http://", "https://", 1)
    return None


def itunes_lookup_artwork_url_sync(bundle_id: str) -> str | None:
    """用 iTunes Search API 按 bundle id 查询图标（与局域网协议无关，非系统 App 较常能命中）。"""
    if not bundle_id or len(bundle_id) > 256:
        return None
    now = time.monotonic()
    hit = _itunes_artwork_cache.get(bundle_id)
    if hit and now - hit[0] < _ITUNES_ARTWORK_CACHE_TTL_SEC:
        return hit[1]

    q = urllib.parse.urlencode({"bundleId": bundle_id})
    url = f"https://itunes.apple.com/lookup?{q}"
    result: str | None = None
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "AppleTVRemote/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        results = payload.get("results") if isinstance(payload, dict) else None
        if isinstance(results, list) and results:
            first = results[0]
            if isinstance(first, dict):
                art = (
                    first.get("artworkUrl512")
                    or first.get("artworkUrl100")
                    or first.get("artworkUrl60")
                )
                if isinstance(art, str) and art.startswith("http"):
                    result = art.replace("http://", "https://", 1)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as e:
        logger.debug("iTunes 图标查询失败 %s: %s", bundle_id, e)

    _itunes_artwork_cache[bundle_id] = (now, result)
    return result


async def enrich_installed_app_icons_itunes(
    apps: list[InstalledAppOut],
) -> list[InstalledAppOut]:
    if not itunes_app_icons_enabled():
        return apps

    sem = asyncio.Semaphore(8)

    async def one(a: InstalledAppOut) -> InstalledAppOut:
        if a.icon_url:
            return a
        async with sem:
            url = await asyncio.to_thread(itunes_lookup_artwork_url_sync, a.identifier)
        if url:
            return a.model_copy(update={"icon_url": url})
        return a

    return list(await asyncio.gather(*[one(x) for x in apps]))
