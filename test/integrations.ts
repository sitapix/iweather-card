import type { EntityAttributes, HomeAssistant } from '../src/card/home-assistant.ts';
import { finite, isList, isRecord, text } from '../src/lib/values.ts';
import { ELEVATION, solarElevation, sunEvents } from '../src/sky/sun.ts';
import { FORECAST_TYPES, forecastEntries, type ForecastData } from '../src/weather/forecast.ts';
import { namedDays } from '../src/weather/forecast-items.ts';

// What real integrations' weather entities send: each one's state, and its forecasts as Home
// Assistant hands them out, one file each in test/integrations/. A file is recorded from a running
// Home Assistant (`<integration>.live.json`) or built from its own test data (`<integration>.json`),
// in metric or US units (`.us.json`). The card takes them in the way it takes Home Assistant's own
// messages.
export interface Integration {
  // The file's name: the integration, and how and in which units it was recorded.
  name: string;
  units: 'metric' | 'us';
  // Where and when it was recorded: a live recording's own place, else a place in Europe.
  latitude: number;
  longitude: number;
  timeZone: string;
  now: number;
  state: string;
  attributes: EntityAttributes;
  forecasts: ForecastData;
  // The forecasts as sent, before the card reads them.
  sent: Readonly<Record<string, readonly unknown[]>>;
}
const FILES = import.meta.glob('./integrations/*.json', { import: 'default', eager: true });

const AMSTERDAM = { latitude: 52.37, longitude: 4.89 };
function integration(path: string, json: unknown): Integration {
  const state = isRecord(json) ? json['state'] : undefined,
    lists = isRecord(json) ? json['forecasts'] : undefined;
  if (!isRecord(json) || !isRecord(state) || !isRecord(lists)) throw new Error(`${path} holds no integration.`);
  // The attributes as they came, whatever their types.
  const attributes: EntityAttributes = {},
    supplied = state['attributes'];
  for (const [key, value] of Object.entries(isRecord(supplied) ? supplied : {})) attributes[key] = value;
  const forecasts: ForecastData = {},
    sent: Record<string, readonly unknown[]> = {};
  const given = json['now'],
    now = Date.parse(text(given) ? given : ''),
    condition = state['state'],
    zone = json['time_zone'],
    timeZone = text(zone) ? zone : 'UTC';
  for (const type of FORECAST_TYPES) {
    const list = lists[type];
    if (!isList(list)) continue;
    sent[type] = list;
    // As the card reads them where they arrive.
    const entries = forecastEntries({ forecast: sent[type] });
    forecasts[type] = { status: 'ready', forecast: type === 'daily' ? namedDays(entries, timeZone) : entries };
  }
  return {
    name: path.replace(/^.*\/|\.json$/gu, ''),
    units: json['units'] === 'us' ? 'us' : 'metric',
    latitude: finite(json['latitude']) ? json['latitude'] : AMSTERDAM.latitude,
    longitude: finite(json['longitude']) ? json['longitude'] : AMSTERDAM.longitude,
    timeZone,
    now,
    state: text(condition) ? condition : 'unknown',
    attributes,
    forecasts,
    sent,
  };
}
export const INTEGRATIONS: readonly Integration[] = Object.entries(FILES)
  .map(([path, json]) => integration(path, json))
  .toSorted((a, b) => a.name.localeCompare(b.name));

// Home Assistant with the integration's entity as weather.home, at its home, with the sun where it
// was then.
export const ENTITY = 'weather.home';
export const hassOf = ({ state, attributes, now, latitude, longitude, timeZone }: Integration): HomeAssistant => ({
  states: {
    [ENTITY]: { entity_id: ENTITY, state, attributes },
    'sun.sun': sunAt(now, latitude, longitude),
  },
  locale: { language: 'en' },
  config: { latitude, longitude, time_zone: timeZone, location_name: 'Home' },
});
const MINUTE = 60_000,
  DAY = 86_400_000;
function sunAt(now: number, latitude: number, longitude: number) {
  const elevation = solarElevation(now, latitude, longitude),
    events = [-1, 0, 1].map(day => sunEvents(now + day * DAY, latitude, longitude)),
    next = (times: (number | null)[]) => times.find((time): time is number => time !== null && time > now);
  const rising = next(events.map(({ sunrise }) => sunrise)),
    setting = next(events.map(({ sunset }) => sunset));
  return {
    entity_id: 'sun.sun',
    state: elevation > ELEVATION.daylight ? 'above_horizon' : 'below_horizon',
    attributes: {
      elevation,
      rising: solarElevation(now + MINUTE, latitude, longitude) > elevation,
      ...(rising === undefined ? {} : { next_rising: new Date(rising).toISOString() }),
      ...(setting === undefined ? {} : { next_setting: new Date(setting).toISOString() }),
    },
  };
}
