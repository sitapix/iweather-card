"""What the services and the weather entity share."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .weather import StandInWeather

DOMAIN = "stand_in_weather"


@dataclass
class StandIn:
    """The entity once it is added, and whether its forecasts may answer."""

    released: asyncio.Event
    entity: StandInWeather | None = None
