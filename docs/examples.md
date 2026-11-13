# Make it yours

Start with your own `weather.*` entity. Every example below works without an API key, and every option is available in the visual editor. The forecasts and readings you see depend on your integration.

In the editor, expand **Quick setup** to apply Compact, Expanded, Full page or Wall tablet. These starting points change presentation settings and offer **Undo** until your next manual edit. They keep your sources, units, actions, privacy settings, tile choices and dashboard sizing. They save ordinary card options, so there is no preset to keep in sync later.

## A small city tile

Current conditions and today's high and low, with the sky behind them. Add several for different places. The entity's coordinates determine the sky; set `time_zone` when the place uses a different time zone from Home Assistant.

```yaml
type: custom:iweather-card
entity: weather.home
weather_layout: compact
place_name: Home
```

Compact takes three rows in a sections dashboard. Resize it with Home Assistant's layout controls.

## Weather beside your other cards

A forecast for the next 24 hours and five days. Tap a forecast day to explore its details. Conditions, precipitation and wind each have a view in the hourly strip.

```yaml
type: custom:iweather-card
entity: weather.home
weather_layout: expanded
forecast_hours: 24
forecast_days: 5
```

## A whole weather page

Paste this into a dashboard's raw configuration as a view, replacing the entity. A panel view gives the card the available screen and lets its content scroll. The online map and climate averages below are optional and contact outside services; see [privacy](../README.md#what-leaves-your-browser).

```yaml
views:
  - title: Weather
    path: weather
    icon: mdi:weather-partly-cloudy
    type: panel
    cards:
      - type: custom:iweather-card
        entity: weather.home
        weather_layout: page
        map: rainviewer
        averages: open-meteo
```

You can also choose **iWeather** when creating a community dashboard. Its strategy selects an available weather entity, preferring one with forecasts, and makes a panel view for it.

## A wall tablet

Larger text, fewer forecast days, and lower rendering demands. This is the editor's **Wall tablet** starting point. Use it inside a panel view as above; it also works as a card on an existing dashboard.

```yaml
type: custom:iweather-card
entity: weather.home
weather_layout: page
size: extra_large
low_power: true
glass_refraction: false
map_wind_animation: false
forecast_hours: 12
forecast_days: 5
```

For a still sky, add `weather_animation: false`. iWeather also follows the device's reduced-motion preference. A device's performance still depends on its browser, GPU, screen resolution and other dashboard cards.

## Your weather station, with a forecast provider

Keep the forecast from your integration while using observations from your yard. Only add sensors you have. Sensor units are converted before display; a missing or unavailable override leaves the weather entity's reading in place.

```yaml
type: custom:iweather-card
entity: weather.home
weather_layout: page
temperature_entity: sensor.outdoor_temperature
humidity_entity: sensor.outdoor_humidity
wind_speed_entity: sensor.wind_speed
wind_gust_speed_entity: sensor.wind_gust
wind_bearing_entity: sensor.wind_direction
pressure_entity: sensor.outdoor_pressure
```

If your main weather entity is an observation-only station, set `forecast_entity: weather.forecast_home` to a second weather entity that supplies forecasts. The editor shows the forecast types advertised by the two configured sources. This describes their capabilities; a provider can still be temporarily unable to return data.

## Home Assistant data only

A full page with no supplemental service requests. Your Home Assistant weather integration may itself use a cloud service; this setting controls requests made by the card.

```yaml
type: custom:iweather-card
entity: weather.home
weather_layout: page
local_only: true
tiles:
  - wind
  - sun
  - moon
  - precipitation
  - humidity
  - pressure
```

Add an air quality or other sensor in the editor to show more. Tiles without readings hide themselves.

## When something is missing

| What you see | What to check |
| --- | --- |
| No weather entity to select | Add a weather integration in **Settings → Devices & services**. A temperature sensor alone is not a weather entity. |
| Entity not found | The entity may have been renamed or removed. Choose its current name in the editor. |
| Entity unavailable | Check the weather integration's status. iWeather cannot refresh a provider that Home Assistant cannot reach. |
| Current weather but no forecast | Check the editor's supported forecast types. An observation-only source needs a forecast provider in **Data sources → Forecast**. |
| Fewer days than requested | The provider may return fewer days. The requested count is a maximum. The page can optionally fill gaps with Open-Meteo. |
| Missing detail tile | The tile needs a reading. Use **Data sources** to add an appropriate sensor, and check the tile is selected under **Full page → Tiles**. |
| Missing map or air quality in local-only mode | These need your own sources. Online radar and automatic air quality are disabled in this mode. |
| Card cannot load after a manual install | Copy **every** file from `dist/` into the same folder, then reload. Copying only the main JavaScript file leaves assets and languages missing. |
| Old appearance after updating | Update the resource URL's version suffix and reload; see [installation](../README.md#manual). |

See [all configuration options](configuration.md) for units, custom map tiles, interaction actions and sensor details.
