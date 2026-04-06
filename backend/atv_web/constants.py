from __future__ import annotations

from pyatv.const import InputAction, TouchAction

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
    "set_position",
    "power_toggle",
}

INPUT_COMMANDS = {"up", "down", "left", "right", "select", "menu", "home"}
ACTION_MAP = {
    "single": InputAction.SingleTap,
    "double": InputAction.DoubleTap,
    "hold": InputAction.Hold,
}

TOUCH_MODES: dict[int, TouchAction] = {
    TouchAction.Press.value: TouchAction.Press,
    TouchAction.Hold.value: TouchAction.Hold,
    TouchAction.Release.value: TouchAction.Release,
    TouchAction.Click.value: TouchAction.Click,
}

# tvOS 常忽略极短的 Press→Release；与 pyatv swipe 同源：同点短 swipe = Press + 多帧 Hold + Release。
TOUCH_TAP_SWIPE_MS = 140

# 与 pyatv MrpAudio 在绝对模式下的步进量级接近；电视 CEC 每键实际百分比因设备而异
VOLUME_REMOTE_DEADBAND_PCT = 1.5
VOLUME_REMOTE_PCT_PER_STEP = 5.0
VOLUME_REMOTE_MAX_STEPS = 40
VOLUME_REMOTE_STEP_DELAY_S = 0.07

# 略短于 playing SSE：焦点常无推送，依赖轮询发现 Focused。
KEYBOARD_SSE_POLL_SEC = 1.5
KEYBOARD_SSE_KEEPALIVE_SEC = 25.0

SSE_STREAM_PUSH_WAIT_SEC = 2.5
SSE_STREAM_KEEPALIVE_SEC = 25.0
