import type { CardConfig } from './config.ts';
import { dataUpdates } from '../weather/freshness.ts';
import {
  type HomeAssistant,
  type EntityState,
  type EntityAttributes,
  type ForecastEntry,
  SUN_ENTITY,
  CONDITION,
  isCondition,
} from './home-assistant.ts';
import type { WeatherText } from '../weather/i18n.ts';
import { type ForecastData, withHourlyDays } from '../weather/forecast.ts';
import {
  sceneInputs,
  weatherAvailable,
  conditionLabel,
  sceneCondition,
  noCondition,
  sunAt,
} from '../weather/conditions.ts';
import { type Strip, forecastStrip } from '../cards/forecast/strip.ts';
import {
  type DailyItem,
  type SoFar,
  type TimedEntry,
  dailyItems,
  forecasts,
  restOfDay,
} from '../weather/forecast-items.ts';
import { type PageAlert, pageAlerts } from '../cards/alerts/rules.ts';
import { type NextHourPanelData, nextHourOf } from '../cards/next-hour/rules.ts';
import type { TileContext } from '../cards/shared/context.ts';
import type { Mode } from '../cards/forecast/rows.ts';
import type { WeatherRecords } from './records.ts';
import { numberLocale, weatherNumber, hour12Of } from '../lib/formats.ts';
import { finite } from '../lib/values.ts';
import { skyKind, liftedCondition, NIGHT_LABELS, KIND_LABELS } from '../sky/presets.ts';
import type { SkyKind } from '../sky/presets-data.ts';
import { feltApart } from '../cards/feels-like/rules.ts';
import { alertLevel } from '../weather/icons.ts';
import { convertAttributesTo, convertUnit } from '../weather/units.ts';
import { readingsNow, hourUnderWay } from '../weather/now.ts';
import { type Climate, type ClimateUnits, climateIn } from '../cards/averages/climate.ts';
import { sensorReadings } from '../weather/sources.ts';
import { isHome, weatherPlace } from './place.ts';
import { type Credits, creditsOf } from './credits.ts';
import { airNow } from '../cards/air-quality/rules.ts';
import { minuteSpans, rainOutlook } from '../weather/rain-outlook.ts';
import type { Quarter } from '../weather/open-meteo.ts';
// What one update of the card works out, as plain data, before anything is drawn: every panel and
// sheet then draws from this and nothing else, so what is drawn first can't change what follows.
export interface Update {
  config: CardConfig;
  hass: HomeAssistant | undefined;
  state: EntityState | undefined;
  attrs: EntityAttributes;
  available: boolean;
  locale: string | undefined;
  // The locale numbers are written in (see numberLocale).
  numbers: string | undefined;
  timeZone: string | undefined;
  now: number;
  t: WeatherText;
  fmt: (value: number | null | undefined, digits?: number) => string;
  named: (condition: string | undefined) => string;
  data: ForecastData;
  // The daily forecast, or failing that the twice-daily one.
  daily: ForecastData['daily'];
  sun: EntityState | undefined;
  inputs: ReturnType<typeof sceneInputs>;
  hour12: boolean | undefined;
  // Home Assistant's name for its home: the one source of the place the page's words name.
  homeName: string;
  // The town or city the settings name, or away from home their zone's name, and whether the weather
  // is for home (see isHome).
  placeName: string;
  atHome: boolean;
  // The weather now as the card names it, and whether it is night.
  conditionText: string;
  // The kind of sky now, for what depends on more than the condition's name.
  sky: SkyKind | undefined;
  // How it feels, in words, when that is far from the temperature; else empty.
  feltText: string;
  night: boolean;
  // Where what the page shows comes from, credited at its foot.
  credits: Credits;
  // Open-Meteo has yet to answer for the first time.
  awaited: boolean;
  // The hourly panel, the daily list, and the panels at the head of the page.
  strip: Strip;
  days: DailyItem[];
  alerts: PageAlert[];
  // Alerts lead the page unless all are minor (the green level), which take their place after the
  // tiles that matter.
  alertsLead: boolean;
  nextHour: NextHourPanelData;
  // What the tiles and sheets are written from.
  ctx: TileContext;
}
// What an update reads.
export interface UpdateSources {
  config: CardConfig;
  hass: HomeAssistant | undefined;
  data: ForecastData;
  // Open-Meteo has filled part of `data`, or has yet to answer for the first time.
  supplied: boolean;
  awaited: boolean;
  // When the supplemental forecast was retrieved, retained with its response.
  supplementAt?: number | undefined;
  // Its quarter hours ahead (see rainOutlook), and whether any are still to come.
  quarters?: readonly Quarter[] | undefined;
  quartersComing?: boolean;
  // A nowcast weather entity's own forecast.
  nowcast: readonly ForecastEntry[] | undefined;
  timeZone: string | undefined;
  // The screen's colour scheme is dark, for when Home Assistant doesn't say what its theme is.
  prefersDark: boolean;
  text: (locale: string | undefined) => WeatherText;
  // The view picked; a card too narrow for the switch shows conditions.
  mode: Mode | undefined;
  narrow: boolean;
  id: string;
  records: Pick<WeatherRecords, 'earlier' | 'recent' | 'lastDay' | 'airYesterday' | 'recentRain' | 'climate'> &
    Partial<Pick<WeatherRecords, 'climateUnits' | 'airSupply' | 'airAwaited' | 'alerts' | 'minutes' | 'soFar'>>;
  now: number;
}
// Each record of normals as last shown in other units, so that it keeps its identity from one
// update to the next (see climateIn).
const climates = new WeakMap<Climate, { key: string; value: Climate }>();
function climateShown(climate: Climate, from: ClimateUnits, to: ClimateUnits): Climate {
  const key = JSON.stringify([to.temperature_unit, to.precipitation_unit]),
    kept = climates.get(climate);
  if (kept?.key === key) return kept.value;
  const value = climateIn(climate, from, to);
  climates.set(climate, { key, value });
  return value;
}
// The weather entity with the readings it leaves out filled in (see readingsNow), or as it is
// while it's unavailable.
function withReadingsNow(
  hass: HomeAssistant | undefined,
  config: CardConfig,
  hour: TimedEntry | undefined,
): EntityState | undefined {
  const entity = hass?.states[config.entity],
    second = config.forecast_entity === undefined ? undefined : hass?.states[config.forecast_entity];
  if (!weatherAvailable(entity)) return entity;
  const { attrs } = readingsNow({
    entity: entity.attributes,
    sensors: sensorReadings(hass, config),
    second: weatherAvailable(second) ? convertAttributesTo(second.attributes, entity.attributes) : undefined,
    hour,
  });
  // A condition the entity doesn't know, the second entity or the hour under way may.
  const condition = noCondition(entity.state)
    ? [second?.state, hour?.condition].find(each => isCondition(each))
    : undefined;
  if (attrs === entity.attributes && condition === undefined) return entity;
  return { ...entity, state: condition ?? entity.state, attributes: attrs };
}
// Today's temperatures so far: what was recorded since midnight, in the card's unit, and the reading
// now.
function soFar(recorded: UpdateSources['records']['soFar'], attrs: EntityAttributes): SoFar | undefined {
  const values = [
    ...(recorded
      ? [recorded.low, recorded.high].map(value =>
          convertUnit('temperature_unit', value, recorded.unit, attrs.temperature_unit),
        )
      : []),
    attrs.temperature,
  ].filter(finite);
  return values.length ? { low: Math.min(...values), high: Math.max(...values) } : undefined;
}
// English capitalises a sky as a headline, its small word aside: Mixed Rain and Snow.
const ENGLISH = 'en',
  LOWER_WORD = /\b(?!and\b)[a-z]/g;
export function workOut({
  config,
  hass,
  data: given,
  supplied,
  awaited,
  supplementAt,
  quarters,
  quartersComing = false,
  nowcast,
  timeZone,
  prefersDark,
  text,
  mode: chosen,
  narrow,
  id,
  records,
  now,
}: UpdateSources): Update {
  const data = withHourlyDays(given, awaited, now, timeZone),
    hourly = forecasts(data.hourly?.forecast),
    hourNow = hourUnderWay(hourly, now),
    state = withReadingsNow(hass, config, hourNow),
    attrs = state?.attributes ?? {},
    locale = hass?.locale?.language || hass?.language || undefined,
    t = text(locale),
    located = weatherPlace(hass, config),
    atHome = isHome(located ?? {}, hass?.config),
    homeLocated = finite(hass?.config?.latitude) && finite(hass.config.longitude),
    place = atHome && homeLocated ? hass.config : located,
    sun = atHome && (homeLocated || place === hass?.config) ? hass?.states[SUN_ENTITY] : sunAt(place ?? {}, now),
    available = weatherAvailable(state),
    daily = data.daily ?? data.twice_daily,
    inputs = sceneInputs(state, sun, place, now, data.hourly?.forecast),
    night = sceneCondition(state, sun).night,
    zoneName = config.zone === undefined ? undefined : hass?.states[config.zone]?.attributes.friendly_name,
    // Away from home, a zone the settings name also names the place, unless they name it themselves.
    placeName = config.place_name ?? (atHome ? '' : (zoneName ?? '')),
    numbers = numberLocale(hass?.locale?.number_format, locale),
    fmt: Update['fmt'] = (value, digits = 0) => weatherNumber(value, numbers, digits);
  // HA translates condition names; "clear-night" reads "Clear".
  const named = (value: string | undefined) => {
    if (value === CONDITION.clearNight) return t('clear');
    if (noCondition(value)) return '';
    if (state && hass?.formatEntityState) {
      try {
        const text = hass.formatEntityState(state, value);
        if (text && text !== value) return text;
      } catch {}
    }
    return conditionLabel(value ?? '');
  };
  // Refined skies get their own names (Mostly sunny, Drizzle, Flurries, Haze…), by night
  // where it differs (Clear, Mostly clear); the rest keep Home Assistant's translated condition,
  // and a condition in an integration's own words keeps those words, whatever sky they draw.
  // As the page's headline it is capitalised as one, in English.
  const sky = available ? skyKind(inputs.condition ?? '', inputs) : undefined,
    refined =
      sky !== undefined &&
      isCondition(inputs.condition) &&
      inputs.condition !== CONDITION.windy &&
      inputs.condition !== CONDITION.windyVariant
        ? (inputs.night && NIGHT_LABELS[sky]) || KIND_LABELS[sky]
        : undefined,
    // Fog that has thinned to nothing leaves the sky it lay under to name the weather.
    lifted = sky && state?.state === CONDITION.fog ? liftedCondition(sky, night) : undefined,
    conditionName = available ? (refined ? t(refined) : named(lifted ?? state.state)) : t('unavailable'),
    conditionText = (locale ?? ENGLISH).startsWith(ENGLISH)
      ? conditionName.replace(LOWER_WORD, letter => letter.toUpperCase())
      : conditionName;
  const strip = forecastStrip(
      { config, state, attrs, data, daily, sun, place, now, timeZone },
      narrow ? 'conditions' : chosen,
    ),
    days = available
      ? dailyItems(
          daily?.forecast,
          now,
          timeZone,
          { condition: state.state, night, ...restOfDay(hourly, now, timeZone), soFar: soFar(records.soFar, attrs) },
          config.forecast_days,
        )
      : [],
    alerts = pageAlerts(config, hass, now, records.alerts?.found?.alerts),
    nextHour = nextHourOf(
      config,
      hass,
      state,
      now,
      nowcast,
      strip.points.find(item => !item.sun)?.precipitation_probability ?? undefined,
      records.minutes?.list,
    ),
    felt = available ? feltApart(attrs) : null,
    airSupply = records.airSupply?.supply ?? undefined,
    credits = creditsOf({
      config,
      hass,
      supplied,
      alerts,
      nextHour: Boolean(nextHour.data),
      air: airNow({ config, hass, airSupply }),
      averaged: Boolean(records.climate ?? records.recentRain?.rain),
    });
  return {
    config,
    hass,
    state,
    attrs,
    available,
    locale,
    numbers,
    timeZone,
    now,
    t,
    fmt,
    named,
    data,
    daily,
    sun,
    inputs,
    hour12: hour12Of(hass?.locale?.time_format),
    homeName: hass?.config?.location_name?.trim() ?? '',
    placeName,
    atHome,
    conditionText,
    sky,
    feltText: felt === null ? '' : t('feels_like_now').replace('{}', `${fmt(felt)}°`),
    night,
    credits,
    awaited,
    strip,
    days,
    alerts,
    alertsLead: alerts.some(alert => alertLevel(alert.severity) !== 'green'),
    nextHour,
    ctx: {
      id,
      attrs,
      hourly,
      pastHours: forecasts(data.hourly?.earlier),
      daily: days,
      sun,
      config,
      hass,
      locale,
      numbers,
      timeZone,
      now,
      freshness: dataUpdates(config, hass, now, supplementAt),
      hour12: hour12Of(hass?.locale?.time_format),
      fmt,
      mode: strip.mode,
      condition: state?.state,
      latitude: place?.latitude,
      longitude: place?.longitude,
      atHome,
      dark: hass?.themes?.darkMode ?? prefersDark,
      pinName: atHome ? t('my_location') : placeName,
      placeName,
      // Both in the units shown, though asked for in others, until those come.
      earlier: records.earlier && convertAttributesTo(records.earlier, attrs),
      recent: records.recent,
      lastDay: records.lastDay,
      airYesterday: records.airYesterday?.value,
      airSupply,
      airAwaited: records.airAwaited ?? false,
      nextHour: Boolean(nextHour.data),
      // Undecided while the minute forecast is still on its way.
      rainOutlook:
        quartersComing && !nextHour.data
          ? undefined
          : rainOutlook(minuteSpans(nextHour.data?.series, quarters, now), hourly, now),
      recentRain: records.recentRain?.rain,
      climate:
        records.climate && records.climateUnits
          ? climateShown(records.climate, records.climateUnits, attrs)
          : records.climate,
    },
  };
}
