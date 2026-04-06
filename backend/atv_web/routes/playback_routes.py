from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pyatv import exceptions as atv_exc
from pyatv.interface import AppleTV

from atv_web.connection import evict_stale_atv, get_or_connect_for_playing
from atv_web.log import logger
from atv_web.playback import build_merged_playing_from_atv, playing_sse_generator
from atv_web.schemas import PlayingStateOut

router = APIRouter()


@router.get(
    "/api/devices/{identifier}/playing",
    response_model=PlayingStateOut,
)
async def get_playing(identifier: str) -> PlayingStateOut:
    last_blocked: BaseException | None = None
    for attempt in range(3):
        atv: AppleTV | None = None
        try:
            atv = await get_or_connect_for_playing(identifier)
            return await build_merged_playing_from_atv(identifier, atv)
        except atv_exc.BlockedStateError as e:
            last_blocked = e
            logger.warning(
                "播放状态连接已关闭或阻塞 (尝试 %s/3): %s",
                attempt + 1,
                e,
            )
            if atv is not None:
                await evict_stale_atv(identifier, atv)
            continue
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("获取播放状态失败: %s", e)
            raise HTTPException(
                status_code=503,
                detail=f"无法读取播放状态: {e}",
            ) from e

    raise HTTPException(
        status_code=503,
        detail="播放状态连接多次失效，请点「断开」后重试。",
    ) from last_blocked


@router.get("/api/devices/{identifier}/playing/stream")
async def stream_playing(identifier: str) -> StreamingResponse:
    """SSE：pyatv 推送（若有）+ 约每 2.5s playing() 合并快照，与 GET /playing 一致。"""
    return StreamingResponse(
        playing_sse_generator(identifier),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/api/devices/{identifier}/playing/artwork",
    response_class=Response,
)
async def get_playing_artwork(
    identifier: str,
    w: int | None = Query(None, ge=32, le=2048),
    h: int | None = Query(None, ge=32, le=2048),
) -> Response:
    aw_w = w if w is not None else 480
    aw_h = h
    last_blocked: BaseException | None = None
    for attempt in range(3):
        atv: AppleTV | None = None
        try:
            atv = await get_or_connect_for_playing(identifier)
            info = await atv.metadata.artwork(width=aw_w, height=aw_h)
            if info is None or not info.bytes:
                raise HTTPException(
                    status_code=404,
                    detail="当前无可用封面图",
                )
            return Response(
                content=info.bytes,
                media_type=info.mimetype or "image/jpeg",
            )
        except HTTPException:
            raise
        except atv_exc.NotSupportedError as e:
            raise HTTPException(
                status_code=404,
                detail="当前连接不支持获取封面图",
            ) from e
        except atv_exc.BlockedStateError as e:
            last_blocked = e
            if atv is not None:
                await evict_stale_atv(identifier, atv)
            continue
        except Exception as e:
            logger.warning("读取封面失败: %s", e)
            raise HTTPException(
                status_code=503,
                detail=f"读取封面失败: {e}",
            ) from e

    raise HTTPException(
        status_code=503,
        detail=f"封面请求连接失效: {last_blocked}",
    ) from last_blocked
