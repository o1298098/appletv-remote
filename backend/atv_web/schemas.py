from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ScanResponse(BaseModel):
    devices: list[dict[str, Any]]


class PairBeginBody(BaseModel):
    identifier: str


class PairBeginResponse(BaseModel):
    session_id: str
    device_provides_pin: bool
    protocol: str
    enter_on_tv_pin: str | None = None


class PairPinBody(BaseModel):
    session_id: str
    pin: str = Field(..., min_length=1, max_length=16)


class PairFinishBody(BaseModel):
    session_id: str


class RemoteBody(BaseModel):
    command: str
    action: str | None = None
    position_sec: int | None = None


class VolumeStateResponse(BaseModel):
    supported: bool
    level: float | None = None
    detail: str | None = None


class VolumeSetBody(BaseModel):
    level: float = Field(..., ge=0.0, le=100.0)


class InstalledAppOut(BaseModel):
    name: str | None = None
    identifier: str
    icon_url: str | None = None


class AppsListResponse(BaseModel):
    apps: list[InstalledAppOut]


class LaunchAppBody(BaseModel):
    target: str = Field(..., min_length=1, max_length=4096)


class KeyboardStateOut(BaseModel):
    text_focus_state: str
    text: str | None = None


class KeyboardOpBody(BaseModel):
    op: Literal["clear", "append", "set"]
    text: str | None = None


class TouchSwipeBody(BaseModel):
    start_x: int = Field(..., ge=0, le=1000)
    start_y: int = Field(..., ge=0, le=1000)
    end_x: int = Field(..., ge=0, le=1000)
    end_y: int = Field(..., ge=0, le=1000)
    duration_ms: int = Field(..., ge=1, le=30_000)


class TouchActionPointBody(BaseModel):
    x: int = Field(..., ge=0, le=1000)
    y: int = Field(..., ge=0, le=1000)
    mode: int = Field(..., description="TouchAction: 1 Press, 3 Hold, 4 Release, 5 Click")


class TouchClickBody(BaseModel):
    action: Literal["single", "double", "hold"] = "single"


class UserAccountOut(BaseModel):
    name: str | None = None
    identifier: str


class AccountsListResponse(BaseModel):
    accounts: list[UserAccountOut]


class SwitchAccountBody(BaseModel):
    account_id: str = Field(..., min_length=1, max_length=256)


class DeviceInfoResponse(BaseModel):
    operating_system: str
    version: str | None = None
    build_number: str | None = None
    model: str
    model_str: str
    raw_model: str | None = None
    mac: str | None = None
    output_device_id: str | None = None


class FeaturesListResponse(BaseModel):
    features: list[dict[str, Any]]


class PlayingAppOut(BaseModel):
    name: str | None = None
    identifier: str


class PlayingStateOut(BaseModel):
    supported: bool = True
    detail: str | None = None
    app: PlayingAppOut | None = None
    media_type: str | None = None
    device_state: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    genre: str | None = None
    series_name: str | None = None
    season_number: int | None = None
    episode_number: int | None = None
    position_sec: int | None = None
    total_time_sec: int | None = None
    hint: str | None = None
