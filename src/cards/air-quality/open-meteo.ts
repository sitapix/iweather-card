import { DAY, HOUR, MINUTE, fromUnix } from '../../lib/time.ts';
import { finite, isList, isRecord } from '../../lib/values.ts';
import { type Fetcher, askJson, keepAnswer, keptAnswer, sharedRequests } from '../../lib/asking.ts';
import { OPEN_METEO, atPlace } from '../../lib/services.ts';
// Air quality where no sensor gives it: Open-Meteo's US air quality index for a place, with the
// pollutants behind it and the index a day before. It needs no key, whatever weather integration
// the card shows. Its data is CC BY 4.0, drawn from the Copernicus Atmosphere Monitoring Service,
// so both are named wherever it shows.

// Each pollutant by Open-Meteo's name for it, and the sheet's (see POLLUTANTS in sheet.ts).
const POLLUTANT_KINDS: Readonly<Record<string, string>> = {
  pm2_5: 'pm25',
  pm10: 'pm10',
  ozone: 'ozone',
  nitrogen_dioxide: 'nitrogen_dioxide',
  sulphur_dioxide: 'sulphur_dioxide',
  carbon_monoxide: 'carbon_monoxide',
};
const INDEX = 'us_aqi';
// It gives every concentration as a mass in a volume, which Home Assistant writes with the micro sign.
const MASS = 'µg/m³';
export const AIR_SOURCE = 'Open-Meteo.com, Copernicus Atmosphere Monitoring Service';
// Its hours run from the start of yesterday, so a day back from now is always among them. The
// reading a day back counts only within half an hour of it, as a sensor's history does.
const PAST_DAYS = 1;
const FORECAST_DAYS = 1;
const YESTERDAY_WINDOW = 30 * MINUTE;
// The index changes by the hour, so an answer serves for an hour, across every card in the browser.
export const AIR_REFRESH = HOUR;

export interface AirSupply {
  // When it was asked for.
  at: number;
  index: number;
  // The index at about this time yesterday, where the answer has it.
  yesterday: number | undefined;
  pollutants: readonly { kind: string; value: number; unit: string }[];
}

// An answer as an index, or null when it holds none.
export function parseAirSupply(body: unknown, at: number): AirSupply | null {
  const current = isRecord(body) ? body['current'] : undefined,
    hourly = isRecord(body) ? body['hourly'] : undefined;
  if (!isRecord(current)) return null;
  const index = current[INDEX],
    time = current['time'];
  if (!finite(index) || !finite(time)) return null;
  const times = isRecord(hourly) && isList(hourly['time']) ? hourly['time'] : [],
    indexes = isRecord(hourly) && isList(hourly[INDEX]) ? hourly[INDEX] : [],
    then = fromUnix(time) - DAY;
  let yesterday: number | undefined,
    nearest = YESTERDAY_WINDOW;
  for (const [i, hour] of times.entries()) {
    const value = indexes[i],
      gap = finite(hour) ? Math.abs(fromUnix(hour) - then) : Infinity;
    if (finite(value) && gap <= nearest) {
      yesterday = value;
      nearest = gap;
    }
  }
  const pollutants = Object.entries(POLLUTANT_KINDS).flatMap(([name, kind]) => {
    const value = current[name];
    return finite(value) ? [{ kind, value, unit: MASS }] : [];
  });
  return { at, index, yesterday, pollutants };
}

// The last answer, as it came, for the place it was asked for: read back through the same checks,
// so a page opened again within the hour has its tile at once, without asking.
const CACHE = 'iweather-air-v1';

const savedAir = (url: string, now: number): AirSupply | null =>
  keptAnswer(CACHE, url, (at, body) => (finite(at) && now - at < AIR_REFRESH ? parseAirSupply(body, at) : null));

async function askAir(url: string, now: number, fetcher: Fetcher): Promise<AirSupply | null> {
  const saved = savedAir(url, now);
  if (saved) return saved;
  const body = await askJson(fetcher, url, 'Open-Meteo'),
    supply = parseAirSupply(body, now);
  if (supply) keepAnswer(CACHE, url, now, body);
  return supply;
}

const shared = sharedRequests<AirSupply | null>();

const airUrl = (latitude: number, longitude: number): string =>
  `${OPEN_METEO.airQuality}?${atPlace(latitude, longitude)}&current=${[INDEX, ...Object.keys(POLLUTANT_KINDS)].join(',')}&hourly=${INDEX}&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timeformat=unixtime`;

// This browser has had an answer for the place, however long ago: its air quality is known to come.
export const airAnswered = (latitude: number, longitude: number): boolean =>
  keptAnswer(CACHE, airUrl(latitude, longitude), () => true) ?? false;

// The air quality now at a place, in one call; the requests of cards asking together are shared.
export function openMeteoAir(
  latitude: number,
  longitude: number,
  now: number,
  fetcher: Fetcher = fetch,
): Promise<AirSupply | null> {
  const url = airUrl(latitude, longitude);
  return shared(url, () => askAir(url, now, fetcher));
}
