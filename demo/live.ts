import type { EntityAttributes, ForecastEntry, ForecastReading } from '../src/card/home-assistant.ts';
import { DAY, HOUR, fromUnix } from '../src/lib/time.ts';
import { finite, isList, isRecord, text } from '../src/lib/values.ts';
import { CLOUD_LAYERS, cloudAltitude } from '../src/weather/open-meteo.ts';
import { codeCondition, hourCondition } from '../src/weather/weather-codes.ts';
import { OPEN_METEO, atPlace } from '../src/lib/services.ts';
import { ENTITY, UNIT_NAMES, type Units, type World } from './world.ts';

// Real weather for the demo, asked of Open-Meteo by the visitor's browser: places by name, and a
// place's weather now and for ten days, as an integration would hand it to Home Assistant. Each
// request is made only when the visitor asks for it.

export interface Place {
  name: string;
  // The region and country, to tell places of one name apart.
  detail: string;
  latitude: number;
  longitude: number;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const MATCHES = 5;
const FORECAST_DAYS = 10;
export const ATTRIBUTION = 'Weather data by Open-Meteo.com';

async function asked(url: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}.`);
  return response.json();
}

const valuesOf = (block: Record<string, unknown>, name: string): readonly unknown[] => {
  const values = block[name];
  return isList(values) ? values : [];
};

// The places a search found, best first.
export function placesFrom(body: unknown): Place[] {
  const results = isRecord(body) ? body['results'] : undefined;
  if (!isList(results)) return [];
  return results.flatMap(result => {
    if (!isRecord(result)) return [];
    const { name, admin1, country, latitude, longitude } = result;
    if (!text(name) || !finite(latitude) || !finite(longitude)) return [];
    const detail = [admin1, country].filter((part): part is string => text(part) && part !== name).join(', ');
    return [{ name, detail, latitude, longitude }];
  });
}

export async function findPlaces(query: string, fetcher: Fetcher): Promise<Place[]> {
  const words = query.trim();
  if (!words) return [];
  return placesFrom(
    await asked(`${GEOCODING}?name=${encodeURIComponent(words)}&count=${MATCHES}&language=en&format=json`, fetcher),
  );
}

// --- The forecast ----------------------------------------------------------------------------
type Field = ForecastReading | 'wind_bearing';
const HOURLY: Readonly<Record<string, Field>> = {
  temperature_2m: 'temperature',
  apparent_temperature: 'apparent_temperature',
  dew_point_2m: 'dew_point',
  relative_humidity_2m: 'humidity',
  cloud_cover: 'cloud_coverage',
  uv_index: 'uv_index',
  pressure_msl: 'pressure',
  visibility: 'visibility',
  precipitation: 'precipitation',
  precipitation_probability: 'precipitation_probability',
  wind_speed_10m: 'wind_speed',
  wind_gusts_10m: 'wind_gust_speed',
  wind_direction_10m: 'wind_bearing',
};
const DAILY: Readonly<Record<string, Field>> = {
  temperature_2m_max: 'temperature',
  temperature_2m_min: 'templow',
  precipitation_sum: 'precipitation',
  precipitation_probability_max: 'precipitation_probability',
  wind_speed_10m_max: 'wind_speed',
  wind_gusts_10m_max: 'wind_gust_speed',
  wind_direction_10m_dominant: 'wind_bearing',
  uv_index_max: 'uv_index',
};
// Now has no chance of rain or amount: the hour under way gives those.
const CURRENT: Readonly<Record<string, Field>> = Object.fromEntries(
  Object.entries(HOURLY).filter(([name]) => !name.startsWith('precipitation')),
);
const CODE = 'weather_code',
  SNOWFALL = 'snowfall',
  DAYTIME = 'is_day';

// Open-Meteo gives pressure in hPa whatever else is asked, and visibility in metres or feet.
const HPA_PER_INHG = 33.8639;
const METRES = { km: 1000, mi: 1609.344 } as const;
const FEET = { km: 3280.84, mi: 5280 } as const;
const PRESSURE_DIGITS = { us: 2, metric: 0 } as const;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

function converted(field: Field, value: number, units: Units, visibilityUnit: unknown): number {
  if (field === 'pressure') return round(units === 'us' ? value / HPA_PER_INHG : value, PRESSURE_DIGITS[units]);
  if (field === 'visibility') {
    const shown = UNIT_NAMES[units].visibility_unit;
    return round(value / (visibilityUnit === 'ft' ? FEET[shown] : METRES[shown]), 1);
  }
  return value;
}

// The readings `names` maps, from row `index` of `block`, in the units shown.
function cloudBand(block: Record<string, unknown>, index: number | null): Pick<EntityAttributes, 'cloud_altitude'> {
  const [low, mid, high] = CLOUD_LAYERS.map(name => (index === null ? block[name] : valuesOf(block, name)[index]));
  return finite(low) && finite(mid) && finite(high) ? { cloud_altitude: cloudAltitude(low, mid, high) } : {};
}

function readings(
  block: Record<string, unknown>,
  names: Readonly<Record<string, Field>>,
  index: number | null,
  units: Units,
  visibilityUnit: unknown,
): Partial<Record<Field, number>> {
  const entry: Partial<Record<Field, number>> = {};
  for (const [name, field] of Object.entries(names)) {
    const value = index === null ? block[name] : valuesOf(block, name)[index];
    if (finite(value)) entry[field] = converted(field, value, units, visibilityUnit);
  }
  return entry;
}

const unitOf = (body: Record<string, unknown>, block: string): unknown => {
  const units = body[block];
  return isRecord(units) ? units['visibility'] : undefined;
};

// A forecast's answer as what the card reads: the weather now, the hours from the one under way
// and the days from today, for `place` in its own zone. Throws when the answer isn't one.
export function liveWorld(body: unknown, place: Place, units: Units, now: number): World {
  const current = isRecord(body) ? body['current'] : undefined,
    hourly = isRecord(body) ? body['hourly'] : undefined,
    daily = isRecord(body) ? body['daily'] : undefined,
    zone = isRecord(body) ? body['timezone'] : undefined;
  if (!isRecord(body) || !isRecord(current) || !isRecord(hourly) || !isRecord(daily))
    throw new Error('Open-Meteo sent no forecast.');
  const hourCodes = valuesOf(hourly, CODE),
    snowfall = valuesOf(hourly, SNOWFALL),
    daytime = valuesOf(hourly, DAYTIME);
  const hours: ForecastEntry[] = valuesOf(hourly, 'time').flatMap((time, i) => {
    if (!finite(time) || fromUnix(time) + HOUR <= now) return [];
    const condition = hourCondition(hourCodes[i], snowfall[i], daytime[i] === 1);
    return [
      {
        datetime: new Date(fromUnix(time)).toISOString(),
        ...(condition ? { condition } : {}),
        ...readings(hourly, HOURLY, i, units, unitOf(body, 'hourly_units')),
        ...cloudBand(hourly, i),
      },
    ];
  });
  const dayCodes = valuesOf(daily, CODE);
  const days: ForecastEntry[] = valuesOf(daily, 'time').flatMap((time, i) => {
    if (!finite(time)) return [];
    const condition = codeCondition(dayCodes[i]);
    return [
      {
        // Local midnight in its zone: noon falls on the right date whatever the offset.
        datetime: new Date(fromUnix(time) + DAY / 2).toISOString(),
        ...(condition ? { condition } : {}),
        ...readings(daily, DAILY, i, units, undefined),
      },
    ];
  });
  const condition = hourCondition(current[CODE], current[SNOWFALL], current[DAYTIME] === 1);
  const attributes: EntityAttributes = {
    ...readings(current, CURRENT, null, units, unitOf(body, 'current_units')),
    ...cloudBand(current, null),
    ...UNIT_NAMES[units],
    friendly_name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    attribution: ATTRIBUTION,
    supported_features: 3,
  };
  return {
    states: { [ENTITY]: { entity_id: ENTITY, state: condition ?? 'unknown', attributes } },
    forecasts: { hourly: hours, daily: days },
    // No home location: the weather's own place is home, and the card works out its sun.
    config: { location_name: 'Home', ...(text(zone) ? { time_zone: zone } : {}) },
  };
}

export function forecastUrl(place: Place, units: Units): string {
  const unitParams =
    units === 'us'
      ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'
      : '&wind_speed_unit=kmh';
  return (
    `${OPEN_METEO.forecast}?${atPlace(place.latitude, place.longitude)}` +
    `&current=${[...Object.keys(CURRENT), CODE, SNOWFALL, DAYTIME, ...CLOUD_LAYERS].join(',')}` +
    `&hourly=${[...Object.keys(HOURLY), CODE, SNOWFALL, DAYTIME, ...CLOUD_LAYERS].join(',')}` +
    `&daily=${[...Object.keys(DAILY), CODE].join(',')}` +
    `&forecast_days=${FORECAST_DAYS}&timeformat=unixtime&timezone=auto${unitParams}`
  );
}

export async function liveWeather(place: Place, units: Units, fetcher: Fetcher, now: number): Promise<World> {
  return liveWorld(await asked(forecastUrl(place, units), fetcher), place, units, now);
}
