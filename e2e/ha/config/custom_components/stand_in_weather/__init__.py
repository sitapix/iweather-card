"""A weather entity that reports what it is told, for testing the card on a real Home Assistant.

`stand_in_weather.play` hands weather.stand_in one recording from test/integrations: its state,
its attributes and its forecasts. `stand_in_weather.hold` makes every forecast wait until
`stand_in_weather.release`.
"""

from __future__ import annotations

import asyncio

import voluptuous as vol

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, discovery
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, StandIn

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)

PLAY_SCHEMA = vol.Schema(
    {
        vol.Required("state"): cv.string,
        vol.Optional("attributes", default=dict): dict,
        vol.Optional("forecasts", default=dict): dict,
    }
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the services, and the weather entity they drive."""
    stand_in = StandIn(released=asyncio.Event())
    stand_in.released.set()
    hass.data[DOMAIN] = stand_in

    async def play(call: ServiceCall) -> None:
        if stand_in.entity is None:
            raise HomeAssistantError("weather.stand_in isn't there yet")
        stand_in.entity.play(call.data["state"], call.data["attributes"], call.data["forecasts"])

    async def hold(call: ServiceCall) -> None:
        stand_in.released.clear()

    async def release(call: ServiceCall) -> None:
        stand_in.released.set()

    hass.services.async_register(DOMAIN, "play", play, schema=PLAY_SCHEMA)
    hass.services.async_register(DOMAIN, "hold", hold)
    hass.services.async_register(DOMAIN, "release", release)
    hass.async_create_task(discovery.async_load_platform(hass, Platform.WEATHER, DOMAIN, {}, config))
    return True
