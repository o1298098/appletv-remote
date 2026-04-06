from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from pyatv.const import FeatureName, FeatureState
from pyatv.interface import AppleTV, KeyboardListener

from atv_web import state
from atv_web.connection import get_or_connect
from atv_web.constants import KEYBOARD_SSE_KEEPALIVE_SEC, KEYBOARD_SSE_POLL_SEC
from atv_web.log import logger
from atv_web.schemas import KeyboardStateOut
from atv_web.util import enum_name


async def read_keyboard_state_snapshot(atv: AppleTV) -> KeyboardStateOut:
    kb = atv.keyboard
    focus = kb.text_focus_state
    text = await kb.text_get()
    return KeyboardStateOut(
        text_focus_state=enum_name(focus),
        text=text,
    )


def notify_keyboard_sse_subscribers(identifier: str, snap: KeyboardStateOut) -> None:
    line = snap.model_dump_json()

    def pump() -> None:
        for q in state._keyboard_sse_queues.get(identifier, []):
            try:
                q.put_nowait(line)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(line)
                except asyncio.QueueFull:
                    pass

    loop = state._loop
    if loop is None:
        return
    try:
        loop.call_soon_threadsafe(pump)
    except RuntimeError:
        pump()


async def keyboard_focus_changed_async(
    identifier: str,
    _old_name: str,
    new_name: str,
) -> None:
    atv = state._clients.get(identifier)
    if atv is None:
        return
    try:
        snap = await read_keyboard_state_snapshot(atv)
    except Exception as e:
        logger.warning("键盘焦点变更后读取文本失败 [%s]: %s", identifier, e)
        snap = KeyboardStateOut(text_focus_state=new_name, text=None)
    notify_keyboard_sse_subscribers(identifier, snap)


class KeyboardPushListener(KeyboardListener):
    def __init__(self, identifier: str) -> None:
        self.identifier = identifier

    def focusstate_update(self, old_state: Any, new_state: Any) -> None:
        try:
            loop = state.get_loop()
        except RuntimeError:
            return
        old_n = enum_name(old_state)
        new_n = enum_name(new_state)

        def kick() -> None:
            asyncio.create_task(
                keyboard_focus_changed_async(self.identifier, old_n, new_n),
            )

        try:
            loop.call_soon_threadsafe(kick)
        except RuntimeError:
            kick()


async def ensure_keyboard_listener(identifier: str, atv: AppleTV) -> None:
    if identifier in state._keyboard_listener_started:
        return
    try:
        feat = atv.features.get_feature(FeatureName.TextFocusState)
        if feat.state == FeatureState.Unsupported:
            logger.info("[%s] TextFocusState 不支持，跳过键盘焦点监听", identifier)
            return
        listener = KeyboardPushListener(identifier)
        atv.keyboard.listener = listener
        state._keyboard_listener_refs[identifier] = listener
        state._keyboard_listener_started.add(identifier)
        logger.info("[%s] 已注册键盘焦点监听", identifier)
    except Exception as e:
        logger.warning("[%s] 注册键盘焦点监听失败: %s", identifier, e)


async def keyboard_sse_generator(identifier: str):
    q: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
    lst = state._keyboard_sse_queues.setdefault(identifier, [])
    lst.append(q)
    last_sent: str | None = None
    last_yield_mono = time.monotonic()
    last_focus_for_poll: str | None = None

    def should_send(line: str) -> bool:
        nonlocal last_sent, last_yield_mono
        if line == last_sent:
            return False
        last_sent = line
        last_yield_mono = time.monotonic()
        return True

    async def poll_snap() -> KeyboardStateOut | None:
        atv = state._clients.get(identifier)
        if atv is None:
            return None
        try:
            return await read_keyboard_state_snapshot(atv)
        except Exception as e:
            logger.debug("SSE 键盘轮询失败 %s: %s", identifier, e)
            return None

    try:
        atv = await get_or_connect(identifier)
        await ensure_keyboard_listener(identifier, atv)
        snap0 = await poll_snap()
        if snap0 is not None:
            last_focus_for_poll = snap0.text_focus_state
            line0 = snap0.model_dump_json()
            if should_send(line0):
                yield f"data: {line0}\n\n"

        while True:
            try:
                payload = await asyncio.wait_for(
                    q.get(), timeout=KEYBOARD_SSE_POLL_SEC
                )
                if should_send(payload):
                    try:
                        j = json.loads(payload)
                        if isinstance(j, dict):
                            v = j.get("text_focus_state")
                            if isinstance(v, str):
                                last_focus_for_poll = v
                    except (json.JSONDecodeError, TypeError):
                        pass
                    yield f"data: {payload}\n\n"
            except asyncio.TimeoutError:
                polled = await poll_snap()
                if polled is not None:
                    pline = polled.model_dump_json()
                    if should_send(pline):
                        last_focus_for_poll = polled.text_focus_state
                        yield f"data: {pline}\n\n"

            if time.monotonic() - last_yield_mono >= KEYBOARD_SSE_KEEPALIVE_SEC:
                yield ": keepalive\n\n"
                last_yield_mono = time.monotonic()
    finally:
        subs = state._keyboard_sse_queues.get(identifier)
        if subs:
            try:
                subs.remove(q)
            except ValueError:
                pass
            if not subs:
                state._keyboard_sse_queues.pop(identifier, None)
