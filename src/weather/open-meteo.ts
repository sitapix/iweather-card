import type { CloudAltitude, ForecastEntry, ForecastReading } from '../card/home-assistant.ts';
import { DAY, HOUR, fromUnix } from '../lib/time.ts';
import { finite, isList, isRecord } from '../lib/values.ts';
import { UNITS } from './units.ts';
import { codeCondition, hourCondition } from './weather-codes.ts';
import { type Fetcher, askJson, keepAnswer, keptAnswer, sharedRequests } from '../lib/asking.ts';
import { OPEN_METEO, atPlace } from '../lib/services.ts';
// Open-Meteo's averages are kept for a place to two decimals (about 1 km). It names its units in
// words.
export const CACHE_DIGITS = 2;

export const OPEN_METEO_TEMPERATURE = { [UNITS.fahrenheit]: 'fahrenheit', other: 'celsius' } as const;

const OPEN_METEO_RAIN = { [UNITS.inches]: 'inch', other: 'mm' } as const;

export const openMeteoRain = (unit: string | undefined) =>
  unit === UNITS.inches ? OPEN_METEO_RAIN[UNITS.inches] : OPEN_METEO_RAIN.other;

// --- The supplement --------------------------------------------------------------------
// The forecast asked for beside the weather entity's, to fill what it leaves out (see
// supplementForecast): hours and days as the card holds them, in the units below, however the
// card shows them. Its data is CC BY 4.0, so what it fills is credited with a link wherever
// it shows.

// Yesterday and today's hours before now, and ten rows from any hour of the local day. Up to 14
// days weigh as one request at the service, and 27 readings as 2.7, so asking hourly comes to 65 of
// the 10,000 a day it allows.
const PAST_DAYS = 1;
const FORECAST_DAYS = 11;
// The default time between asks, across cards sharing the browser.
export const SUPPLEMENT_REFRESH = HOUR;

// The units each answer comes in, as the card spells them, for one conversion into the entity's.
export const OPEN_METEO_UNITS = {
  temperature_unit: UNITS.celsius,
  wind_speed_unit: UNITS.metersPerSecond,
  precipitation_unit: UNITS.millimeters,
  visibility_unit: UNITS.meters,
  pressure_unit: UNITS.hectopascals,
} as const;

// Each reading by Open-Meteo's name for it, and the card's.
type Readings = Readonly<Record<string, ForecastReading | 'wind_bearing'>>;
const HOURLY: Readings = {
  precipitation_probability: 'precipitation_probability',
  wind_gusts_10m: 'wind_gust_speed',
  wind_speed_10m: 'wind_speed',
  wind_direction_10m: 'wind_bearing',
  apparent_temperature: 'apparent_temperature',
  dew_point_2m: 'dew_point',
  visibility: 'visibility',
  precipitation: 'precipitation',
  temperature_2m: 'temperature',
  cloud_cover: 'cloud_coverage',
  relative_humidity_2m: 'humidity',
  pressure_msl: 'pressure',
  uv_index: 'uv_index',
};
const DAILY: Readings = {
  temperature_2m_max: 'temperature',
  temperature_2m_min: 'templow',
  precipitation_sum: 'precipitation',
  precipitation_probability_max: 'precipitation_probability',
  wind_speed_10m_max: 'wind_speed',
  wind_gusts_10m_max: 'wind_gust_speed',
};
const CODE = 'weather_code',
  SNOWFALL = 'snowfall';
// An hour's cover low, mid and high, which name the height of its cloud (see cloudAltitude).
const CLOUD_LAYERS = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'] as const;

// The height holding the most of the cloud. Where two hold the most alike, low wins over either and
// mid over high, so a sky with no cloud at all is low.
export function cloudAltitude(low: number, mid: number, high: number): CloudAltitude {
  if (low >= mid && low >= high) return 'low';
  return mid >= high ? 'mid' : 'high';
}
const SUN = ['sunrise', 'sunset'] as const;

// What an answer brings: every hour, oldest first, and every day, each as a forecast entry.
// `at`: when it was asked for, as what had ended by then is no forecast.
export interface Supplement {
  at: number;
  hours: readonly ForecastEntry[];
  days: readonly ForecastEntry[];
}

const valuesOf = (block: Record<string, unknown>, name: string): readonly unknown[] => {
  const values = block[name];
  return isList(values) ? values : [];
};
// Fills `entry` with a time's readings. The furthest days leave some out, sent as null.
function withReadings(
  entry: ForecastEntry,
  block: Record<string, unknown>,
  names: Readings,
  index: number,
): ForecastEntry {
  for (const [name, key] of Object.entries(names)) {
    const value = valuesOf(block, name)[index];
    if (finite(value)) entry[key] = value;
  }
  return entry;
}

// An answer as hours and days, or null when it isn't one. Hours keep their own times, which are
// epochs. A day's time doesn't: the answer holds one UTC offset throughout, so past a clock change
// a day's midnight reads as an hour off it, on the date before in autumn. Its noon falls on the
// right date either way. Sunrise and sunset are true times, and in polar night they meet.
export function parseSupplement(body: unknown, at: number): Supplement | null {
  const hourly = isRecord(body) ? body['hourly'] : undefined,
    daily = isRecord(body) ? body['daily'] : undefined;
  if (!isRecord(hourly) || !isRecord(daily)) return null;
  const [rises, sets] = SUN.map(name => valuesOf(daily, name)),
    spans = (rises ?? []).flatMap((rise, i) => {
      const set = sets?.[i];
      return finite(rise) && finite(set) ? [[rise, set] as const] : [];
    });
  const hourCodes = valuesOf(hourly, CODE),
    snowfall = valuesOf(hourly, SNOWFALL),
    layers = CLOUD_LAYERS.map(name => valuesOf(hourly, name)),
    dayCodes = valuesOf(daily, CODE);
  const hours = valuesOf(hourly, 'time').flatMap((time, i) => {
    if (!finite(time)) return [];
    const entry: ForecastEntry = { datetime: new Date(fromUnix(time)).toISOString() },
      daytime = spans.length ? spans.some(([rise, set]) => time >= rise && time < set) : undefined,
      condition = hourCondition(hourCodes[i], snowfall[i], daytime);
    if (daytime !== undefined) entry.is_daytime = daytime;
    if (condition) entry.condition = condition;
    const [low, mid, high] = layers.map(values => values[i]);
    if (finite(low) && finite(mid) && finite(high)) entry.cloud_altitude = cloudAltitude(low, mid, high);
    return [withReadings(entry, hourly, HOURLY, i)];
  });
  const days = valuesOf(daily, 'time').flatMap((time, i) => {
    if (!finite(time)) return [];
    const entry: ForecastEntry = { datetime: new Date(fromUnix(time) + DAY / 2).toISOString() },
      condition = codeCondition(dayCodes[i]);
    if (condition) entry.condition = condition;
    return [withReadings(entry, daily, DAILY, i)];
  });
  return hours.length && days.length ? { at, hours, days } : null;
}

// The last answer, as it came, for the place it was asked for: read back through the same checks,
// so a page opened again within its refresh interval has its rows at once, without asking.
const CACHE = 'iweather-supplement-v1';

const savedSupplement = (url: string, now: number, maxAge: number): Supplement | null =>
  keptAnswer(CACHE, url, (at, body) =>
    finite(at) && at <= now && now - at < maxAge ? parseSupplement(body, at) : null,
  );

async function askForecast(url: string, now: number, fetcher: Fetcher): Promise<Supplement | null> {
  const body = await askJson(fetcher, url, 'Open-Meteo'),
    supplement = parseSupplement(body, now);
  if (supplement) keepAnswer(CACHE, url, now, body);
  return supplement;
}

const shared = sharedRequests<Supplement | null>();

// Hours and days for a place, in its zone, so that its dates are the card's. In one call, whatever
// the entity lacks, and the requests of cards asking together are shared. A saved answer comes
// back synchronously so a rebuilt editor preview has its cloud cover before its first paint.
export function openMeteoForecast(
  latitude: number,
  longitude: number,
  timeZone: string | undefined,
  now: number,
  { maxAge = SUPPLEMENT_REFRESH, fetcher = fetch }: { maxAge?: number; fetcher?: Fetcher } = {},
): Supplement | Promise<Supplement | null> {
  const asked = {
    hourly: [...Object.keys(HOURLY), CODE, SNOWFALL, ...CLOUD_LAYERS].join(','),
    daily: [...Object.keys(DAILY), CODE, ...SUN].join(','),
  };
  const url = `${OPEN_METEO.forecast}?${atPlace(latitude, longitude)}&hourly=${asked.hourly}&daily=${asked.daily}&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timeformat=unixtime&timezone=${encodeURIComponent(timeZone ?? 'auto')}&wind_speed_unit=ms&precipitation_unit=mm&temperature_unit=celsius`;
  // Each card decides whether a saved answer is fresh enough before sharing a network request.
  const saved = savedSupplement(url, now, maxAge);
  if (saved) return saved;
  return shared(url, () => askForecast(url, now, fetcher));
}
