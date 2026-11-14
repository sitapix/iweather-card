# Configuration

Every option here is also in the visual editor, which writes only the settings that differ from their defaults. The editor shows the **Full page**, **Map and online services** and **Alerts and sensors** sections when the layout is `page`. While you edit, the preview shows the part of the card a setting changes: it scrolls there when the preview sits beside the form, and rings it for a moment.

- [Card](#card)
- [Forecast](#forecast)
- [Full page](#full-page)
- [Look](#look)
- [Units](#units)
- [Data sources](#data-sources)
- [Advanced](#advanced)
- [The full-page layout](#the-full-page-layout)
- [Tiles and sheets](#tiles-and-sheets)
- [Alerts](#alerts)
- [Averages](#averages)
- [Next-hour precipitation](#next-hour-precipitation)
- [The map](#the-map)
- [Filling the forecast](#filling-the-forecast)
- [Local only](#local-only)
- [Card sizes](#card-sizes)

## Card

| Option | Default | Description |
|---|---|---|
| `entity` | required | Any `weather.*` entity |
| `weather_layout` | `auto` | `auto`, `compact`, `strip` for one line, `expanded`, or `page` for the full-page layout with detail tiles |

## Forecast

| Option | Default | Description |
|---|---|---|
| `show_forecast` | `true` | Hourly forecast |
| `forecast_hours` | `24` | Hourly entries, 2–48. Sunrise and sunset sit between them. |
| `show_daily` | `true` | Daily list |
| `forecast_days` | `10` | Days in the daily list, 1–10. A forecast with fewer shows what it has. |
| `show_high_low` | `true` | Today's high and low under the condition |
| `weather_mode` | `auto` | The hourly view to start in: `conditions`, `rain`, `wind`, or `auto`, which opens on Conditions |

## Full page

These apply to the `page` layout.

| Option | Default | Description |
|---|---|---|
| `size` | `standard` | How large the page draws: `standard`, `large` (a quarter larger) or `extra_large` (half as large again), for a screen seen from across a room. Text, tiles and gaps scale together, so fewer columns fit. |
| `top_padding` | `50` | Space above the current weather, as a percentage of the original spacing: `0`–`200`. The default halves it; `100` restores the original. Text size and the gap below the weather stay the same. |
| `sheet_style` | `auto` | How a tile opens its details: `auto` (a sheet on a phone, a popover anywhere larger), `sheet` or `popover`. A sheet slides up from the foot of the screen, and goes when pulled down by a finger or a mouse. |
| `tiles` | all, in the default order | The [tiles](#tiles-and-sheets) to show, in this order |
| `alert_entities` | none | Sensors or binary sensors with weather alerts. Without them, the page shows the National Weather Service's alerts in the United States. See [Alerts](#alerts). |
| `next_hour_entity` | none | A weather entity whose forecast steps less than an hour, or a sensor listing minute-by-minute precipitation. See [Next-hour precipitation](#next-hour-precipitation). |
| `air_quality_entity` | none | A sensor reporting an air quality index. Without one, the `page` layout shows Open-Meteo's US index for the weather's place |
| `air_quality_scale` | `auto` | The scale that sensor reports on: `auto`, `us`, `at`, `ca`, `cn`, `de`, `es`, `eu`, `fr`, `ie`, `in`, `kr`, `mx`, `sg` or `uk`. `auto` goes by the sensor's name, such as `aqhi` or `daqi`, and otherwise the US scale |
| `averages` | none | `open-meteo`, or a temperature sensor whose long-term statistics cover at least two years. See [Averages](#averages). |
| `local_only` | `false` | Ask no outside service, whatever else is set. See [Local only](#local-only). |
| `open_meteo_forecast` | `true` | Fill what your entity's forecast leaves out. `false` never asks. See [Filling the forecast](#filling-the-forecast). |
| `forecast_refresh_minutes` | `60` | Minutes between supplemental Open-Meteo forecast requests while visible: a whole number from 15 to 360. The browser's saved forecast uses the same interval. Does not change Home Assistant forecasts or the map's forecast grids. |
| `radar_refresh_minutes` | `5` | Minutes between RainViewer frame checks while visible: a whole number from 1 to 60. Checking more often cannot make the provider publish new frames sooner. |
| `map` | none | `rainviewer` adds radar and the wind across the map (recommended), `local` uses Home Assistant data, and `none` or `false` shows no map. See [The map](#the-map). |
| `map_wind_animation` | `true` | Move the wind map's streaks on the card too. Off, they hold still until you open the map. |
| `map_precipitation_animation` | `true` | Play the card's precipitation map from now on, with the time in its corner as it plays: while precipitation is falling, the latest radar carried on fifty minutes at the speed and heading it moves; otherwise the forecast's next 12 hours. Whether it is falling, and how far out the map looks, comes from the next hour's minute-by-minute forecast where there is one, then the hourly forecast. It never shows the past. Off, it shows the latest observation until you open the map. Follows `weather_animation` and reduced-motion preferences. |
| `map_tile_url` | OpenStreetMap | Base map template, an `https` URL with `{z}`, `{x}` and `{y}`, such as `https://tiles.example.com/{z}/{x}/{y}.png`. The card shows your tiles as they come on every theme, so pick dark ones for a dark theme. |
| `map_layers` | none | Tile overlays for each map kind from any service: `precipitation`, `wind`, `air_quality` and `temperature`, each an `https` URL with `{z}`, `{x}` and `{y}` |

## Look

| Option | Default | Description |
|---|---|---|
| `show_name` | `true` | Show the location name |
| `name` | entity name | Location shown above the temperature |
| `place_name` | none | Your town or city, for the `page` layout. It heads the page under Home Assistant's name for your home, with a location arrow, and names the map's pin when the weather is for somewhere more than 10 km from home. Unset, the page shows `name` alone and the pin goes unnamed away from home, unless a [`zone`](#weather-for-somewhere-else) names them. The card asks no service to look your place up. |
| `weather_scene` | `true` | Live sky, clouds, sun, moon, rain and snow |
| `weather_animation` | `true` | Animate the sky. Off when your system asks for reduced motion. |
| `glass_refraction` | `true` | Show the sky refracted through raindrops on the panels. Off keeps moving droplets, highlights and shadows, while reducing rendering work. |
| `low_power` | `false` | For a wall tablet or an older screen: a softer sky, at most 20 frames a second, a third of the rain and snow, and no drops on the panels |
| `haptics` | `moon` | `moon`: a light tick for each mark the moon’s timeline passes as it scrolls, and a firmer one at each midnight; the menu at the top of a sheet on a phone ticks too, as a held finger passes each sheet in it. `all` adds a tap as views and days change, charts are read, tiles are pressed and the map is moved. `off` gives none. The Home Assistant app gives it; in a browser, only with Vibrate turned on in your profile. |
| `tap_action` | more-info | What tapping the current weather does, as a [Home Assistant action](https://www.home-assistant.io/dashboards/actions/). |
| `hold_action` | none | What holding it does. |
| `double_tap_action` | none | What double-tapping it does. |

## Units

| Option | Default | Description |
|---|---|---|
| `temperature_unit` | `auto` | `°C` or `°F`. `auto` uses the weather entity's units. |
| `wind_speed_unit` | `auto` | `mph`, `km/h`, `m/s`, `bft` (Beaufort force) or `kn` |
| `precipitation_unit` | `auto` | `in` or `mm`. Inches read in steps of .05″, millimetres whole, and a trace as `<.05″` or `<1 mm`. |
| `pressure_unit` | `auto` | `mbar`, `inHg`, `mmHg`, `hPa` or `kPa` |
| `distance_unit` | `auto` | Visibility in `mi` or `km` |

The pressure, wind, visibility, precipitation, averages and conditions sheets end with **Options**, where each of their units can be picked from a menu: the system's own with a mouse or trackpad, and the card's glass menu under a finger. A unit picked there is kept in the browser and shown on that device in place of the card's setting, until the card's setting for that unit changes.

## Data sources

| Option | Default | Description |
|---|---|---|
| `forecast_entity` | none | Another weather entity that fills in what yours lacks: forecast types it doesn't provide, such as hourly alongside a daily-only integration; details it leaves out, such as rain chance, UV or gusts, matched hour by hour; and readings now, such as UV or pressure. The card converts them into your entity's units. |
| `condition_entity` | none | The condition from another weather entity, or from a `sensor`, `input_select` or `select` whose state is a Home Assistant condition (`sunny`, `rainy`, …) |
| `temperature_entity`, `apparent_temperature_entity`, `humidity_entity`, `dew_point_entity`, `pressure_entity`, `uv_index_entity`, `wind_speed_entity`, `wind_gust_speed_entity`, `wind_bearing_entity`, `visibility_entity`, `cloud_coverage_entity`, `precipitation_entity` | none | A `sensor`, `input_number`, `number` or `weather` entity for any reading. It replaces your weather entity's value, or supplies one the integration doesn't provide. |

The card converts values from the source's unit. Wind direction may be degrees or a compass point. A rain gauge or rain-rate sensor as `precipitation_entity` also gives the precipitation tile what fell in the last 6 hours, or the last 24 when nothing fell in the 6. If the rate sensor was unavailable for part of that period, `≥` marks the amount measured during the known intervals. A partial day does not count as a measured 24-hour total.

Each reading now comes from the first source that has it: its sensor above, your weather entity, `forecast_entity`, then the forecast for the hour under way, which includes `forecast_entity`'s hours and Open-Meteo's. Every tile, sheet and the sky read the same values.

- **Dew point:** when your entity doesn't report one, the card works it out from the temperature and humidity, as long as both come from the same source, so it agrees with the humidity shown beside it. Otherwise it takes the forecast's.
- **Gusts:** a gust from another source is never shown below the wind now.
- **Values that mean "none":** a share outside 0–100% (such as a −99% chance of rain), a negative UV index, or a gust of 0 in a wind counts as missing, and is filled in like one.
- **Conditions:** one outside Home Assistant's set shows as the integration writes it, and the sky and its symbols follow the nearest of Home Assistant's, read from English words such as "light rain", "thunderstorm", "mist" or "overcast clouds". Words that name no weather the card knows show an overcast sky. An entity with no condition (`unknown`) still shows its readings, and takes a condition from `forecast_entity` or the hour under way when either has one. `condition_entity` sets one outright.
- **Days:** a daily forecast stamped at midnight belongs to the date it names, in whatever zone it's written, so days stamped at midnight UTC don't fall a day early west of it.

## Advanced

| Option | Default | Description |
|---|---|---|
| `zone` | your entity's own place, else home | The zone the weather is for, such as `zone.paris`. See [Weather for somewhere else](#weather-for-somewhere-else). |
| `time_zone` | Your profile's | IANA zone for forecast hours, such as `America/Chicago`. Unset, it follows your profile's time zone setting: your device's, or Home Assistant's. |

### Weather for somewhere else

The card shows the weather entity it is given, for wherever that entity is set up, and most integrations take any place. What the card works out for itself goes by a place too: the sky's sun and moon, the moon tile, the map, and what it asks of Open-Meteo. That place is the `zone` you set, else the entity's own where it reports one (few do), else Home Assistant's home.

So for another town, add the weather integration for it and a zone there, then set both:

```yaml
type: custom:iweather-card
entity: weather.paris
zone: zone.paris
time_zone: Europe/Paris
```

More than 10 km from home, the zone's name heads the page and names the map's pin, unless `place_name` gives another. Set `time_zone` too: the card can't tell a place's time zone by itself, so forecast hours otherwise follow yours.

## The full-page layout

`weather_layout: page` shows the current conditions over the live sky, then the hourly and daily panels and a grid of detail tiles. The columns follow the width: two on a phone, then at the standard size four from 656 px, five from 908 and six from 1165. From four columns the tiles are 144 px square with 16 px between them. They never stretch, and the grid stays centred with the sky on either side.

From four columns the hourly panel, the daily list and the map form one block with the other tiles around it. Alerts, the next hour and air quality that matters go first. With fewer columns, wind and moon tiles go two wide and list their readings beside the dial or the moon. From four columns they do so where that fills the grid with the fewest gaps, and the map stands two rows tall or as tall as the daily list by the same test.

In a panel view, given rows in a sections dashboard, or given a height with `--iweather-height`, the page fills that space and scrolls in place over a still sky. As it scrolls, the conditions collapse into a band at the top ("72° | Partly cloudy" under the place name). Each panel stops at the band's edge, holds its title row there while the rest slides under, then lets the title rise away and fade.

The page ends with one small button: where the weather is for, over the credit line (`attribution`) of each entity the page draws from, a line each: the card's own entity, and the `forecast_entity`, `condition_entity`, reading sensors, `next_hour_entity`, air quality and averages sensors and alert entities while the page shows something of theirs. A line another already says is left out. Alerts the card asks for itself credit the National Weather Service. It opens what tapping the conditions does. When the integration hasn't written new data for three hours, the conditions say when it last did ("Last updated 7:06 AM").

In the `page` layout a screen reader hears what the hourly forecast shows in a sentence ("Rain until 4PM."). In the Precipitation view, pulling the strip past its start with a trackpad, wheel or finger names the bars' levels and the row under them.

## Tiles and sheets

The tile list and what each one needs are in the [README](../README.md#detail-tiles). The default order:

```yaml
tiles: [air_quality, wind, moon, sun, uv, map, feels_like, averages, precipitation, visibility, humidity, pressure]
```

Tiles keep your order, apart from a few that move up while they matter:

- Air quality goes first once the AQI is over 100. The map then shows air quality too, unless precipitation is near.
- Feels like moves up when it is 5 °F (3 °C) or more from the temperature.
- Averages moves up on an unusual day.

A tile shows when any source has its reading (see [Data sources](#data-sources)), and stays hidden when none does. Met.no, for example, has no visibility unless Open-Meteo fills it. Air quality comes from `air_quality_entity` when you set one, and otherwise from Open-Meteo for the weather's place, on the US scale, whatever integration gives the weather. Open-Meteo is then credited at the foot of the page.

Tap a tile for its sheet: an hourly chart for each forecast day, a comparison with yesterday from Home Assistant's history, and an "About" note.

The Conditions sheet also has **Data Updates**, with the age and date of each configured weather source's last entity change and the last supplemental forecast retrieval. These times describe Home Assistant changes and browser requests, not when the weather was observed. Reopening the sheet or reading a saved forecast does not reset those times. Missing or invalid timestamps are omitted.

The card receives Home Assistant entity and forecast changes as they arrive; it does not wait for the next forecast hour. The integration and its provider determine how soon a change outdoors reaches Home Assistant. **Map and online services → Refresh intervals** controls only the card's own radar and supplemental forecast requests. Requests pause while the card is out of sight or the tab is hidden, and overdue data is requested when it returns. The card checks due times on its minute tick and relevant updates, so routine refreshes can run up to a minute after their interval.

- **Pressure** shows whether it is rising, falling or steady, and the gauge marks the trend.
- **Wind** gives the Beaufort force.
- **Moon** has illumination, moonrise and moonset, the next full and new moons, the distance and a month of phases.
- **Air quality** lists the primary pollutant and every pollutant sensor on the same device as `air_quality_entity`, or without one the pollutants Open-Meteo gives, with health guidance.

## Alerts

`alert_entities` takes sensors or binary sensors with weather alerts, for example from NWS Alerts, Meteoalarm, Météo-France, DWD Weather Warnings or Environment Canada. The page shows them as one panel, first on the page, or after the tiles that matter when every alert is minor (green).

- **Météo-France:** each hazard shows at its own colour, and none while the sensor reads Vert (green).
- **DWD Weather Warnings:** each warning shows with its headline, message, times and level.
- **Environment Canada:** add its warnings, watches, advisories and statements sensors you want. Statements and endings count as minor.

Without `alert_entities`, the page asks the [National Weather Service](https://www.weather.gov/) for the alerts in force at the weather's place, every five minutes while the card is in sight. It asks only where the service covers the weather: the entity comes from Home Assistant's NWS integration, or Home Assistant's country is the United States or one of its territories. Test messages and cancelled alerts are left out, and each alert links to the forecast page for the place. `local_only: true` stops it, and alert sensors take over from it once set.

The panel is headed by the first alert's own event, after a sign in the colour of the most severe alert ("Flood Watch & 1 More" for several, or the first event alone where that runs past 25 characters). Under it, it says when the first alert holds, names the rest, counting an event repeated by several alerts once, and says who issued them. Times show their zone unless it is yours.

Tap the panel to read every alert in full: its severity, when it begins, the whole message, what to do and how soon, the area and who issued it, with a link to the source.

## Averages

With `averages: open-meteo`, the browser fetches 1991–2020 daily highs, lows and precipitation for the weather's place (the `zone` set, else your entity's own, else home) from [Open-Meteo](https://open-meteo.com/)'s archive once and keeps only the averages. Every six hours it also fetches the last 30 days' precipitation from Open-Meteo's forecast service.

The tile turns to precipitation when those 30 days brought half as much again as usual, or half as little, while today's high is within 5 °F (3 °C) of its normal. This applies in places where at least 10 mm (0.4″) usually falls in 30 days.

With a temperature sensor, the card reads Home Assistant's own long-term statistics and the tile shows temperature only.

## Next-hour precipitation

`next_hour_entity` needs minute or five-minute data, so an hourly forecast can't drive it. It takes a weather entity whose forecast steps less than an hour, or a sensor listing precipitation in an attribute (`forecast`, `minutely`, `data`…).

With none set, an OpenWeatherMap entity in its One Call mode gives the next hour by itself: the card asks Home Assistant for its minute forecast every five minutes while in sight, from data Home Assistant already holds.

The panel appears while precipitation falls or starts within 50 minutes. Tap it to see the hour minute by minute, with the rest of the day's forecast. Gaps in the source are unknown. For example, “Rain · Now–+4m” means the available readings cover four more minutes of rain; it does not predict when the rain will stop.

## The map

`map: rainviewer` and `map: local` both show the map tile, which follows the forecast panel and the weather:

1. The wind, while the hourly panel shows wind.
2. Precipitation while it is near: the next-hour panel is up, it is falling, or the coming hour brings it within 50 minutes.
3. Air quality when the AQI is over 100.
4. Otherwise the radar with `rainviewer`, or the temperature with `local`.

| | `rainviewer` | `local` |
|---|---|---|
| Radar | [RainViewer](https://www.rainviewer.com/), free for personal use with attribution, stopping at zoom 7 | None |
| Wind | Across the whole map, from Open-Meteo, asked for hourly while the map needs it | Your entity's wind around home only |
| Temperature and air quality | Across the map, from Open-Meteo | Your own entity and sensor |
| Ground | OpenFreeMap's tiles through MapLibre, with OpenStreetMap's tiles behind them | OpenStreetMap's tiles |

Set `map_tile_url` to use your own ground with either source. Add `map_layers` to overlay tiles from any service you use.

The map follows your theme, not the sky: dark on a dark theme, even on a sunny afternoon. It reads Home Assistant's theme, or the screen's colour scheme where Home Assistant doesn't say. The wind map keeps its blue. The pin reads My Location at home.

On the card the map is a still, as far out as the weather calls for, with the radar's latest frame on it. The card looks for a new frame every `radar_refresh_minutes` while it is in sight (five minutes by default). Open the map to play the last two hours; the timeline shows each frame's time. The large map opens close in while precipitation is falling or due within the hour, and further out the longer it stays off. With `rainviewer` its radar starts playing, unless motion is off.

In the large map's **1h** view, areas within the contiguous United States also show up to an hour ahead using NOAA HRRR simulated radar from the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/GIS/model.phtml), free with no account or API key. These are actual model frames at 15-minute intervals, interpolated between their valid times. The timeline heading stays **Forecast** throughout playback; the source attribution is under **Map Data**. Model predictions can differ from observed storm locations; the card does not slide the last radar image forward.

The forecast uses one completed model run, checked every ten minutes while this map is open and visible. Runs older than six hours, observations older than thirty minutes, failed forecast tiles, and views outside the model's coverage leave the timeline on observed radar. This short forecast requires the live map; with custom base tiles or without WebGL, the 1h view shows observations only. The **12h** view continues to use its regional and global precipitation forecasts.

## Filling the forecast

Weather integrations send different things. Met.no gives 48 hours and 6 days, with no rain chances, gusts, feels-like, dew point or visibility. On the `page` layout, when your entity's forecast leaves a rain chance or a gust out of any hour, or has fewer days than `forecast_days`, the browser asks [Open-Meteo](https://open-meteo.com/) for the rest. You need no integration, account or key, and it's free for non-commercial use, which includes home automation.

- **What goes out:** the weather's place, to three decimals (about 100 m): the `zone` you set, else your entity's own where it gives one, else your home's. With it goes the time zone, every `forecast_refresh_minutes` while the card is in sight (60 minutes by default), and again when either changes. An entity that sends everything causes no request. Set `open_meteo_forecast: false` to stop it altogether.
- **Your entity wins,** field by field and hour by hour. Within the hours it covers, the card fills only rain chance, gusts, feels-like, dew point and visibility. Past them, and for days it doesn't reach, the hours and days are Open-Meteo's, so a chart can step where one forecast meets the other. Readings the card doesn't ask Open-Meteo for (UV, humidity and pressure) stop with your entity's hours, and their sheets offer only those days.
- **If it fails,** the card carries on with what it has and tries again a quarter of an hour later.
- **Credit:** while it fills the forecast, the air quality or the averages, the page links to Open-Meteo at its foot, as its CC BY 4.0 licence asks.

## Local only

`local_only: true` keeps the `page` layout inside Home Assistant, whatever else you set:

- `open_meteo_forecast` counts as `false`, so your entity's forecast stands alone, gaps and all.
- `averages: open-meteo` stops, and the averages tile hides. An averages sensor keeps working.
- Air quality comes only from `air_quality_entity`, and without it the air quality tile hides.
- Alerts come only from `alert_entities`.
- The radar stops, and `map: rainviewer` counts as `map: local`.
- The map tile hides unless you set `map_tile_url`, because the map has no ground without tiles.

With `map_tile_url` the card asks that server, and any `map_layers` you name, for tiles. You chose those services, so the setting leaves them alone. Point them at a tile server on your own network to keep every request at home.

Your other settings stay in place, so turning `local_only` off brings them all back. The other layouts send nothing out, so the setting changes nothing there.

## A weather dashboard

From Home Assistant 2026.5, **Settings → Dashboards → Add dashboard** offers iWeather among the community dashboards: the card over a whole view, on your first weather entity. Edit it afterwards like any dashboard.

## Card sizes

In a sections dashboard the card defaults to the full width and six rows. Resize it from a strip one row tall to the whole section, and as narrow as three columns:

- **1 row:** one line: the place name at the start, the temperature and condition parted by a bar ("64° | Sunny"), and from 400 px wide the high and low at the end. Narrower, the high and low go first, then the condition below 200 px, then the place below 150 px, leaving the temperature.
- **2 rows:** the same, headed by Home Assistant's name for its home in small capitals after a location arrow, left out when it matches the place name. From about 420 px wide the coming hours sit beside them. Narrow cards give the condition a line of its own.
- **3 rows and up:** the current conditions over the hourly forecast, side by side on wide cards, with the daily forecast added once the card is tall enough.
- **Narrow cards** (under 200 px, three or four columns): the conditions stacked, and from about 300 px tall the coming hours listed under them. These cards are too narrow for the forecast's switch, so they show conditions.

The sky keeps its proportions at every size. It scales with the card's longer side, so a wide card shows less of the top of the sky and cuts off the highest clouds and the sun, with the sun's glow still reaching in. The moon sits at the same share of the card's width and height whatever its shape. Rain and snow fall equally dense on a small card or a large one.

Without a dashboard-assigned height, including in the editor preview and masonry views, `strip` uses 56 px, `compact` uses 180 px, `auto` uses 280 px and `expanded` uses 700 px to fit its hourly and daily panels. Compact is a city tile with the location at upper left, temperature at upper right, and conditions and high/low along the bottom. It shows “My Location” and the home name for home, or the time in the configured `time_zone` for another place. It has no hourly or daily panels, and defaults to three rows in a sections grid. `strip` is the 1-row line above wherever the card sits, in a stack or a masonry view as well as a sections grid, where it takes one row and as few as three columns. It has no hourly or daily panels either. In a sections grid, `expanded` needs about 320 px, and a card made shorter lays out as `auto`. The `page` layout takes at least six columns and sets its own height from its content, unless it sits in a panel view or has rows or a height, where it scrolls in place. Set `--iweather-height` in a theme or with card-mod to override the default height.

The editor’s **Interactions** section uses Home Assistant’s native action pickers for **Tap**, **Hold**, and **Double tap**. Choose Navigate to send the user to a dashboard or subview, or choose another supported Home Assistant action. In Compact and Strip, the whole card responds to these gestures, and Interactions appears directly below Layout. The default tap opens the weather entity’s details; hold and double tap do nothing until configured.

The editor for Compact and Strip hides forecast panels, glass refraction, haptic feedback, units other than temperature, and sensor overrides that do not affect the tile. Data sources keeps temperature and the readings that refine the condition text and sky; its missing-data count includes only those readings. Hidden settings stay saved, including map layers, tile order and custom YAML, so switching back restores them. Editing a source or time zone highlights the compact tile in the preview.

## Styling

The card draws its own surface rather than `ha-card`, so styles aimed at `ha-card { }` match nothing. It follows your theme's `--ha-card-border-radius`, and the rest can be styled from `:host` and the card's own classes.
