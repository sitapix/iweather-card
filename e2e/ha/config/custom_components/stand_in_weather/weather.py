"""weather.stand_in: reports a recording as an integration would report its own readings.

Home Assistant writes a weather entity's state from its native readings and units, converting them
to its own unit system, and sends its forecasts the same way. So a recording's values go in as
native readings in the recording's units, and Home Assistant does the rest.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.weather import Forecast, WeatherEntity, WeatherEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.typing import ConfigType, DiscoveryInfoType

from .const import DOMAIN, StandIn

# Each forecast a recording can hold, and the feature that offers it.
FEATURES = {
    "daily": WeatherEntityFeature.FORECAST_DAILY,
    "hourly": WeatherEntityFeature.FORECAST_HOURLY,
    "twice_daily": WeatherEntityFeature.FORECAST_TWICE_DAILY,
}

# A state attribute, and the entity property Home Assistant writes it from.
READINGS = {
    "temperature": "native_temperature",
    "temperature_unit": "native_temperature_unit",
    "apparent_temperature": "native_apparent_temperature",
    "dew_point": "native_dew_point",
    "humidity": "humidity",
    "cloud_coverage": "cloud_coverage",
    "uv_index": "uv_index",
    "ozone": "ozone",
    "pressure": "native_pressure",
    "pressure_unit": "native_pressure_unit",
    "wind_bearing": "wind_bearing",
    "wind_speed": "native_wind_speed",
    "wind_gust_speed": "native_wind_gust_speed",
    "wind_speed_unit": "native_wind_speed_unit",
    "visibility": "native_visibility",
    "visibility_unit": "native_visibility_unit",
    "precipitation_unit": "native_precipitation_unit",
    "attribution": "attribution",
    "icon": "icon",
}
# Attributes Home Assistant writes itself, from the features and the entity's name.
OWN = {"supported_features", "friendly_name"}

# A forecast's reading as Home Assistant sends it, and the native key it converts from.
FORECAST_READINGS = {
    "temperature": "native_temperature",
    "templow": "native_templow",
    "apparent_temperature": "native_apparent_temperature",
    "dew_point": "native_dew_point",
    "pressure": "native_pressure",
    "precipitation": "native_precipitation",
    "wind_speed": "native_wind_speed",
    "wind_gust_speed": "native_wind_gust_speed",
}


async def async_setup_platform(
    hass: HomeAssistant,
    config: ConfigType,
    async_add_entities: AddEntitiesCallback,
    discovery_info: DiscoveryInfoType | None = None,
) -> None:
    """Add the one entity."""
    stand_in: StandIn = hass.data[DOMAIN]
    stand_in.entity = StandInWeather(stand_in)
    async_add_entities([stand_in.entity])


def native(entry: dict[str, Any]) -> Forecast:
    """A forecast entry as sent, keyed as an integration hands it to Home Assistant."""
    forecast: dict[str, Any] = {}
    for key, value in entry.items():
        forecast[FORECAST_READINGS.get(key, key)] = value
    return Forecast(**forecast)


class StandInWeather(WeatherEntity):
    """Reports the recording it was last given, and nothing until then."""

    _attr_has_entity_name = False
    _attr_name = "Stand-in"
    _attr_should_poll = False

    def __init__(self, stand_in: StandIn) -> None:
        self.entity_id = "weather.stand_in"
        self._stand_in = stand_in
        self._forecasts: dict[str, list[dict[str, Any]]] = {}

    @callback
    def play(self, state: str, attributes: dict[str, Any], forecasts: dict[str, Any]) -> None:
        """Report this recording from now on, and send its forecasts to whoever follows them."""
        for prop in READINGS.values():
            setattr(self, f"_attr_{prop}", None)
        extra: dict[str, Any] = {}
        for key, value in attributes.items():
            if key in READINGS:
                setattr(self, f"_attr_{READINGS[key]}", value)
            elif key not in OWN:
                extra[key] = value
        self._attr_extra_state_attributes = extra
        self._attr_available = state != "unavailable"
        self._attr_condition = None if state in ("unknown", "unavailable") else state
        self._forecasts = {
            kind: entries
            for kind, entries in forecasts.items()
            if kind in FEATURES and isinstance(entries, list)
        }
        features = WeatherEntityFeature(0)
        for kind in self._forecasts:
            features |= FEATURES[kind]
        self._attr_supported_features = features or None
        self.async_write_ha_state()
        self.hass.async_create_task(self.async_update_listeners(None))

    async def _forecast(self, kind: str) -> list[Forecast] | None:
        await self._stand_in.released.wait()
        entries = self._forecasts.get(kind)
        return None if entries is None else [native(entry) for entry in entries]

    async def async_forecast_daily(self) -> list[Forecast] | None:
        return await self._forecast("daily")

    async def async_forecast_hourly(self) -> list[Forecast] | None:
        return await self._forecast("hourly")

    async def async_forecast_twice_daily(self) -> list[Forecast] | None:
        return await self._forecast("twice_daily")
