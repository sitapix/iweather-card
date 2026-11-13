import { finite, isList, isRecord, text } from '../../lib/values.ts';
import { OPEN_METEO_TEMPERATURE, openMeteoRain, CACHE_DIGITS } from '../../weather/open-meteo.ts';
import { type Fetcher, answerOf, askJson, sharedRequests } from '../../lib/asking.ts';
import { COORDINATE_DIGITS, OPEN_METEO, atPlace } from '../../lib/services.ts';
import { UNITS, convertUnit } from '../../weather/units.ts';
import { HOURS_PER_DAY, DAY, HOUR, fromUnix } from '../../lib/time.ts';
import { dayAxis } from '../../sheets/days.ts';
import { dateKey, localHour } from '../../weather/forecast-items.ts';
import type { HomeAssistant } from '../../card/home-assistant.ts';
import { dateFormat } from '../../lib/formats.ts';

// Optional panels that need a source beyond the weather entity:
// climate averages, next-hour precipitation and the radar map. Each returns null
// without its data, so the card hides the panel instead of showing a placeholder.

// --- Averages --------------------------------------------------------------
// Precipitation is compared with its normal over this many days, and only when nine in ten of
// them came back.
export const RAIN_DAYS = 30;

const COMPLETE = 0.9;

// The normal range of a date's highs is their middle 80%.
const NORMAL_RANGE = [0.1, 0.9] as const;

const MONTHS = 12;

// One day of a record: its date (YYYY-MM-DD), high, low and precipitation, as the
// source gives them; days without a numeric high and low are skipped.
export interface DayRecord {
  date: string;
  high: unknown;
  low: unknown;
  precipitation?: unknown;
}

// `range`: the 10th and 90th percentile of the highs; `span`, the normal range of the date's
// temperatures, from the 10th percentile of its lows to the 90th of its highs; `rain`, the mean
// precipitation that falls on the date, where the record has amounts.
export interface Normal {
  high: number;
  low: number;
  range: [p10: number, p90: number];
  span: [low: number, high: number];
  rain?: number;
}

export interface MonthNormal {
  high: number;
  low: number;
  precipitation: number | null;
}

export interface Climate {
  // By "MM-DD".
  normals: Record<string, Normal>;
  since: number;
  years: number;
  // January to December; null for a month the record never reaches.
  months: (MonthNormal | null)[];
  source?: string;
}

// The units a record's temperatures and precipitation are in.
export interface ClimateUnits {
  temperature_unit?: string | undefined;
  precipitation_unit?: string | undefined;
}
// A record in other units. Units picked anew ask for a record in them, and the one held meanwhile
// shows in them too, rather than its numbers under the new units' names.
export function climateIn(climate: Climate, from: ClimateUnits, to: ClimateUnits): Climate {
  if (from.temperature_unit === to.temperature_unit && from.precipitation_unit === to.precipitation_unit)
    return climate;
  const degrees = (value: number) => convertUnit('temperature_unit', value, from.temperature_unit, to.temperature_unit),
    amount = (value: number) =>
      convertUnit('precipitation_unit', value, from.precipitation_unit, to.precipitation_unit);
  const normals: Record<string, Normal> = {};
  for (const [day, { high, low, range, span, rain }] of Object.entries(climate.normals))
    normals[day] = {
      high: degrees(high),
      low: degrees(low),
      range: [degrees(range[0]), degrees(range[1])],
      span: [degrees(span[0]), degrees(span[1])],
      ...(rain === undefined ? {} : { rain: amount(rain) }),
    };
  const months = climate.months.map(month =>
    month
      ? {
          high: degrees(month.high),
          low: degrees(month.low),
          precipitation: month.precipitation === null ? null : amount(month.precipitation),
        }
      : null,
  );
  return { ...climate, normals, months };
}

// The value `at` a share of the way up a list (0.1: its 10th percentile).
const percentile = (values: readonly number[], at: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(at * sorted.length))] ?? Number.NaN;
};

// Normals keyed by "MM-DD": the mean daily high and low for that date across the
// years given, smoothed over a week either side as climate normals are. Dates are ISO
// (YYYY-MM-DD), so their year, month and month-day are always at the same places.
const ISO_DATE = { year: [0, 4], month: [5, 7], monthDay: [5, 10] } as const;

export const yearOf = (date: string) => date.slice(...ISO_DATE.year),
  monthOf = (date: string): number => Number(date.slice(...ISO_DATE.month)),
  monthDay = (date: string) => date.slice(...ISO_DATE.monthDay);

// A calendar month across the record: its highs and lows, and each year's total precipitation.
interface MonthRecord {
  highs: number[];
  lows: number[];
  rain: Map<string, number>;
}

export function climateNormals(days: readonly DayRecord[], window = 7): Climate | null {
  const byDate = new Map<string, { highs: number[]; lows: number[]; rains: number[] }>(),
    validYears = new Set<string>(),
    months = Array.from({ length: MONTHS }, (): MonthRecord => ({ highs: [], lows: [], rain: new Map() }));
  let first: string | null = null;
  for (const { date, high, low, precipitation } of days) {
    if (!finite(high) || !finite(low)) continue;
    const stamp = Date.parse(`${date}T00:00:00Z`);
    if (!finite(stamp) || isoDate(stamp) !== date) continue;
    validYears.add(yearOf(date));
    if (!first || date <= first) first = date;
    const key = monthDay(date);
    let normal = byDate.get(key);
    if (!normal) {
      normal = { highs: [], lows: [], rains: [] };
      byDate.set(key, normal);
    }
    normal.highs.push(high);
    normal.lows.push(low);
    if (finite(precipitation)) normal.rains.push(precipitation);
    const month = months[monthOf(date) - 1];
    if (!month) continue;
    month.highs.push(high);
    month.lows.push(low);
    if (finite(precipitation)) month.rain.set(yearOf(date), (month.rain.get(yearOf(date)) ?? 0) + precipitation);
  }
  const years = validYears.size;
  if (years < 2 || !first) return null;
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  // Use a leap year so February 29 has a slot and the window wraps across New Year.
  const normals: Record<string, Normal> = {};
  for (const key of byDate.keys()) {
    const middle = Date.parse(`2000-${key}T00:00:00Z`);
    if (!finite(middle)) continue;
    const near = Array.from({ length: 2 * window + 1 }, (_, i) =>
      byDate.get(monthDay(isoDate(middle + (i - window) * DAY))),
    );
    const highs = near.flatMap(entry => (entry ? entry.highs : [])),
      lows = near.flatMap(entry => (entry ? entry.lows : [])),
      rains = near.flatMap(entry => (entry ? entry.rains : []));
    normals[key] = {
      high: mean(highs),
      low: mean(lows),
      range: [percentile(highs, NORMAL_RANGE[0]), percentile(highs, NORMAL_RANGE[1])],
      span: [percentile(lows, NORMAL_RANGE[0]), percentile(highs, NORMAL_RANGE[1])],
    };
    if (rains.length) normals[key].rain = mean(rains);
  }
  return {
    normals,
    since: Number(yearOf(first)),
    years,
    months: months.map(month =>
      month.highs.length
        ? {
            high: mean(month.highs),
            low: mean(month.lows),
            precipitation: month.rain.size ? mean([...month.rain.values()]) : null,
          }
        : null,
    ),
  };
}

export const normalFor = (climate: Climate | null | undefined, key: string): Normal | null =>
  climate?.normals[key] ?? climate?.normals[key === '02-29' ? '02-28' : key] ?? null;

// A climate saved earlier, checked field by field; anything else is refetched.
const pair = (value: unknown): [number, number] | null =>
  isList(value) && value.length === 2 && finite(value[0]) && finite(value[1]) ? [value[0], value[1]] : null;

function savedClimate(value: unknown): Climate | null {
  if (
    !isRecord(value) ||
    !isRecord(value['normals']) ||
    !finite(value['since']) ||
    !finite(value['years']) ||
    !isList(value['months'])
  )
    return null;
  const normals: Record<string, Normal> = {};
  for (const [key, normal] of Object.entries(value['normals'])) {
    const range = isRecord(normal) ? pair(normal['range']) : null,
      span = isRecord(normal) ? pair(normal['span']) : null;
    if (!isRecord(normal) || !finite(normal['high']) || !finite(normal['low']) || !range || !span) return null;
    normals[key] = { high: normal['high'], low: normal['low'], range, span };
    if (finite(normal['rain'])) normals[key].rain = normal['rain'];
  }
  const months: (MonthNormal | null)[] = [];
  for (const month of value['months']) {
    if (month === null) {
      months.push(null);
      continue;
    }
    if (
      !isRecord(month) ||
      !finite(month['high']) ||
      !finite(month['low']) ||
      !(month['precipitation'] === null || finite(month['precipitation']))
    )
      return null;
    months.push({ high: month['high'], low: month['low'], precipitation: month['precipitation'] });
  }
  const climate: Climate = { normals, since: value['since'], years: value['years'], months },
    source = value['source'];
  if (text(source)) climate.source = source;
  return climate;
}

// Open-Meteo's historical archive for 1991–2020, the current climate normal period.
// Free and keyless; the result is cached in the browser, reduced to the normals.
// Version 4 smooths across calendar dates. Older, position-based normals must be recomputed.
const CACHE = 'iweather-normals-v4';
const climateRequests = sharedRequests<Climate | null>();
const archiveDegrees = (unit: string | undefined) => (unit === UNITS.fahrenheit ? UNITS.fahrenheit : UNITS.celsius);
const archiveRain = (unit: string | undefined) => (unit === UNITS.inches ? UNITS.inches : UNITS.millimeters);

export async function openMeteoClimate(
  latitude: number | undefined,
  longitude: number | undefined,
  temperatureUnit: string | undefined,
  precipitationUnit: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<Climate | null> {
  if (!finite(latitude) || !finite(longitude)) return null;
  const temperature =
      temperatureUnit === UNITS.fahrenheit ? OPEN_METEO_TEMPERATURE[UNITS.fahrenheit] : OPEN_METEO_TEMPERATURE.other,
    rain = openMeteoRain(precipitationUnit);
  const key = `${CACHE}:${latitude.toFixed(CACHE_DIGITS)},${longitude.toFixed(CACHE_DIGITS)},${temperature},${rain}`;
  const raw = await climateRequests(key, async () => {
    try {
      const stored = localStorage.getItem(key),
        cached = stored === null ? null : savedClimate(JSON.parse(stored));
      if (cached) return cached;
    } catch {}
    const url = `${OPEN_METEO.archive}?${atPlace(latitude, longitude)}&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=${temperature}&precipitation_unit=${rain}&timezone=auto`;
    const body = await askJson(fetcher, url, 'Open-Meteo'),
      daily = isRecord(body) ? body['daily'] : undefined;
    if (!isRecord(daily)) throw new Error('Open-Meteo sent no daily values');
    const { time, temperature_2m_max: highs, temperature_2m_min: lows, precipitation_sum: totals } = daily;
    if (!isList(time) || !isList(highs) || !isList(lows) || !isList(totals))
      throw new Error('Open-Meteo sent no daily values');
    const climate = climateNormals(
      time.flatMap((date, i) => (text(date) ? [{ date, high: highs[i], low: lows[i], precipitation: totals[i] }] : [])),
    );
    if (climate) {
      climate.source = 'Open-Meteo, 1991–2020';
      try {
        localStorage.setItem(key, JSON.stringify(climate));
      } catch {}
    }
    return climate;
  });
  return (
    raw &&
    climateIn(
      raw,
      {
        temperature_unit: archiveDegrees(temperatureUnit),
        precipitation_unit: archiveRain(precipitationUnit),
      },
      { temperature_unit: temperatureUnit, precipitation_unit: precipitationUnit },
    )
  );
}

// --- The normal range through the day ------------------------------------------
// For each hour of a date, the middle 80% of the temperatures at that hour on the days a week
// either side of it in every year of the record: the band today's temperatures are read against.
// By local hour, 0 to 23; null without enough of a record (20 readings an hour).
export interface DayBand {
  low: number[];
  high: number[];
}

const BAND_WINDOW = 7,
  BAND_READINGS = 20;

export function dayBand(
  readings: readonly { time: number; value: number }[],
  timeZone: string | undefined,
): DayBand | null {
  const hours = Array.from({ length: HOURS_PER_DAY }, (): number[] => []);
  for (const { time, value } of readings) hours[localHour(time, timeZone)]?.push(value);
  if (hours.some(values => values.length < BAND_READINGS)) return null;
  return {
    low: hours.map(values => percentile(values, NORMAL_RANGE[0])),
    high: hours.map(values => percentile(values, NORMAL_RANGE[1])),
  };
}

// The days a week either side of a date ("MM-DD") in a year, as ISO dates.
const ISO_LENGTH = 10;

const isoDate = (time: number) => new Date(time).toISOString().slice(0, ISO_LENGTH);

const MONTH_DAY = { month: [0, 2], day: [3, 5] } as const;

function bandDays(year: number, date: string): [start: string, end: string] {
  const middle = Date.UTC(year, Number(date.slice(...MONTH_DAY.month)) - 1, Number(date.slice(...MONTH_DAY.day)));
  return [isoDate(middle - BAND_WINDOW * DAY), isoDate(middle + BAND_WINDOW * DAY)];
}

// From Open-Meteo's archive for 1991–2020, the normal period the daily normals use, in one request:
// the place given once for each year, each with its own two weeks. A band once worked out is kept
// for good, by place, unit, time zone and date, so each date is asked for once per browser; a failed
// request is not made again for an hour, and requests already on their way are shared.
const BAND_CACHE = 'iweather-day-bands-v1',
  BAND_RETRY = HOUR,
  NORMAL_YEARS = { from: 1991, to: 2020 } as const,
  BAND_DIGITS = 1;

interface SavedBands {
  bands: Record<string, [low: number[], high: number[]]>;
  failed?: number;
}

const hourList = (value: unknown): number[] | null =>
  isList(value) && value.length === HOURS_PER_DAY && value.every(finite) ? [...value] : null;

function savedBands(key: string): SavedBands {
  const saved: SavedBands = { bands: {} };
  try {
    const stored = localStorage.getItem(key),
      value: unknown = stored === null ? null : JSON.parse(stored);
    if (!isRecord(value)) return saved;
    if (finite(value['failed'])) saved.failed = value['failed'];
    for (const [date, band] of Object.entries(isRecord(value['bands']) ? value['bands'] : {})) {
      const low = isList(band) ? hourList(band[0]) : null,
        high = isList(band) ? hourList(band[1]) : null;
      if (low && high) saved.bands[date] = [low, high];
    }
  } catch {}
  return saved;
}

const shared = sharedRequests<DayBand | null>();

export function openMeteoDayBand(
  latitude: number | undefined,
  longitude: number | undefined,
  temperatureUnit: string | undefined,
  // The date, as "MM-DD", and the time zone its hours are local to.
  date: string,
  timeZone: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<DayBand | null> {
  if (!finite(latitude) || !finite(longitude)) return Promise.resolve(null);
  const temperature =
    temperatureUnit === UNITS.fahrenheit ? OPEN_METEO_TEMPERATURE[UNITS.fahrenheit] : OPEN_METEO_TEMPERATURE.other;
  const key = `${BAND_CACHE}:${latitude.toFixed(CACHE_DIGITS)},${longitude.toFixed(CACHE_DIGITS)},${temperature},${timeZone ?? ''}`,
    id = `${key}:${date}`;
  const request = shared(id, () =>
    askBand(key, date, timeZone, () => {
      const years = Array.from({ length: NORMAL_YEARS.to - NORMAL_YEARS.from + 1 }, (_, i) => NORMAL_YEARS.from + i),
        days = years.map(year => bandDays(year, date)),
        each = (value: string) => years.map(() => value).join(',');
      return fetcher(
        `${OPEN_METEO.archive}?latitude=${each(latitude.toFixed(COORDINATE_DIGITS))}&longitude=${each(longitude.toFixed(COORDINATE_DIGITS))}&start_date=${days.map(([start]) => start).join(',')}&end_date=${days.map(([, end]) => end).join(',')}&hourly=temperature_2m&temperature_unit=${temperature}&timezone=GMT&timeformat=unixtime`,
      );
    }),
  );
  const from = archiveDegrees(temperatureUnit);
  if (!temperatureUnit || temperatureUnit === from) return request;
  const convert = (value: number) => convertUnit('temperature_unit', value, from, temperatureUnit);
  return request.then(band => band && { low: band.low.map(convert), high: band.high.map(convert) });
}

async function askBand(
  key: string,
  date: string,
  timeZone: string | undefined,
  ask: () => ReturnType<Fetcher>,
): Promise<DayBand | null> {
  const saved = savedBands(key),
    kept = saved.bands[date];
  if (kept) return { low: kept[0], high: kept[1] };
  if (saved.failed !== undefined && Date.now() - saved.failed < BAND_RETRY) return null;
  let band: DayBand | null = null;
  try {
    const body = await answerOf(await ask(), 'Open-Meteo');
    // One answer for each year: its hours (in seconds) and their temperatures.
    const readings = (isList(body) ? body : [body]).flatMap(year => {
      const hourly = isRecord(year) ? year['hourly'] : undefined,
        times = isRecord(hourly) ? hourly['time'] : undefined,
        values = isRecord(hourly) ? hourly['temperature_2m'] : undefined;
      if (!isList(times) || !isList(values)) return [];
      return times.flatMap((time, i) => {
        const value = values[i];
        return finite(time) && finite(value) ? [{ time: fromUnix(time), value }] : [];
      });
    });
    band = dayBand(readings, timeZone);
  } catch {}
  const round = (values: readonly number[]) => values.map(value => +value.toFixed(BAND_DIGITS));
  if (band) {
    saved.bands[date] = [round(band.low), round(band.high)];
    delete saved.failed;
  } else saved.failed = Date.now();
  try {
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {}
  return band;
}

// Bound a recorder query by the chosen local dates, including a clock change inside the window.
function localDateAxis(date: string, zone: string | undefined) {
  const noon = Date.parse(`${date}T12:00:00Z`),
    local = dateKey(noon, zone);
  return dayAxis(noon + (local > date ? -DAY : local < date ? DAY : 0), zone);
}

// The same from Home Assistant's own long-term statistics for a temperature sensor: its hourly
// means a week either side of the date in each whole year it has, asked for together.
export async function statisticsDayBand(
  hass: Pick<HomeAssistant, 'callWS' | 'config'>,
  statistic: string,
  unit: string | undefined,
  date: string,
  since: number,
  timeZone = hass.config?.time_zone,
  now = Date.now(),
): Promise<DayBand | null> {
  const last = new Date(now).getUTCFullYear() - 1,
    years = Array.from({ length: Math.max(0, last - since + 1) }, (_, i) => since + i);
  const answers = await Promise.all(
    years.map(year => {
      const [start, end] = bandDays(year, date),
        first = localDateAxis(start, timeZone),
        last = localDateAxis(end, timeZone);
      return (
        hass.callWS?.({
          type: 'recorder/statistics_during_period',
          start_time: new Date(first.start).toISOString(),
          end_time: new Date(last.start + last.hours * HOUR - 1).toISOString(),
          statistic_ids: [statistic],
          period: 'hour',
          types: ['mean'],
          ...(unit === UNITS.celsius || unit === UNITS.fahrenheit || unit === UNITS.kelvin
            ? { units: { temperature: unit } }
            : {}),
        }) ?? Promise.resolve(null)
      );
    }),
  );
  const readings = answers.flatMap(answer => {
    const rows = isRecord(answer) ? answer[statistic] : undefined;
    return (isList(rows) ? rows : []).flatMap(row => {
      if (!isRecord(row)) return [];
      const start = row['start'],
        time = typeof start === 'number' ? start : Date.parse(text(start) ? start : ''),
        value = row['mean'];
      return Number.isFinite(time) && finite(value) ? [{ time, value }] : [];
    });
  });
  return dayBand(readings, timeZone);
}

// The precipitation of the last `days` days at a place, ending yesterday, from Open-Meteo's
// forecast service, which keeps recent days. Free and keyless. Each day comes with its
// date, so the same days' normals can be summed.
export interface RecentRain {
  dates: string[];
  amounts: number[];
  total: number;
}

export async function openMeteoRecentRain(
  latitude: number | undefined,
  longitude: number | undefined,
  precipitationUnit: string | undefined,
  days = RAIN_DAYS,
  fetcher: Fetcher = fetch,
): Promise<RecentRain | null> {
  if (!finite(latitude) || !finite(longitude)) return null;
  const rain = openMeteoRain(precipitationUnit),
    url = `${OPEN_METEO.forecast}?${atPlace(latitude, longitude)}&daily=precipitation_sum&past_days=${days}&forecast_days=1&precipitation_unit=${rain}&timezone=auto`;
  const body = await askJson(fetcher, url, 'Open-Meteo'),
    daily = isRecord(body) ? body['daily'] : undefined,
    time = isRecord(daily) ? daily['time'] : undefined,
    totals = isRecord(daily) ? daily['precipitation_sum'] : undefined;
  if (!isList(time) || !isList(totals)) return null;
  // The last day is today, still under way.
  const past = time.slice(0, -1).flatMap((date, i) => {
    const total = totals[i];
    return text(date) && finite(total)
      ? [{ date, total: convertUnit('precipitation_unit', total, archiveRain(precipitationUnit), precipitationUnit) }]
      : [];
  });
  return past.length >= days * COMPLETE
    ? {
        dates: past.map(day => day.date),
        amounts: past.map(day => day.total),
        total: past.reduce((sum, day) => sum + day.total, 0),
      }
    : null;
}

// What usually falls over the same calendar days, from the normals; null where any is missing.
export function normalRain(climate: Climate | null | undefined, dates: readonly string[]): number | null {
  let total = 0;
  for (const date of dates) {
    const rain = normalFor(climate, monthDay(date))?.rain;
    if (!finite(rain)) return null;
    total += rain;
  }
  return total;
}

// Home Assistant's own long-term statistics for a temperature sensor: daily max and
// min for every day the recorder has kept, in `unit` (the card's) whatever the sensor's.
// Needs at least two years.
export async function statisticsClimate(
  hass: Pick<HomeAssistant, 'callWS' | 'config' | 'states'>,
  statistic: string,
  unit?: string,
): Promise<Climate | null> {
  const result = await hass.callWS?.({
    type: 'recorder/statistics_during_period',
    start_time: '2000-01-01T00:00:00Z',
    statistic_ids: [statistic],
    period: 'day',
    types: ['max', 'min'],
    // Home Assistant converts statistics only into the temperature units it knows.
    ...(unit === UNITS.celsius || unit === UNITS.fahrenheit || unit === UNITS.kelvin
      ? { units: { temperature: unit } }
      : {}),
  });
  const rows = isRecord(result) ? result[statistic] : undefined;
  const date = dateFormat('en-CA', { timeZone: hass.config?.time_zone });
  const climate = climateNormals(
    (isList(rows) ? rows : []).flatMap(row => {
      if (!isRecord(row)) return [];
      const start = row['start'],
        time = new Date(typeof start === 'number' ? start : text(start) ? start : '').getTime();
      return finite(time) ? [{ date: date.format(time), high: row['max'], low: row['min'] }] : [];
    }),
  );
  if (climate)
    climate.source = `${hass.states[statistic]?.attributes.friendly_name ?? statistic}, since ${climate.since}`;
  return climate;
}
