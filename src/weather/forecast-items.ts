import {
  CONDITION,
  type ForecastEntry,
  type EntityState,
  type ForecastType,
  FORECAST_FEATURES,
} from '../card/home-assistant.ts';
import { dateFormat } from '../lib/formats.ts';
import { DAY, HOUR, HOURS_PER_DAY } from '../lib/time.ts';
import { frozenPrecipitation, conditionPrecipitation } from './precipitation.ts';
import { finite } from '../lib/values.ts';
import { ELEVATION, solarElevation } from '../sky/sun.ts';

// A forecast entry placed in time; the hourly strip's live first entry and its sunrise
// and sunset markers are entries too.
export type TimedEntry = ForecastEntry & { time: number };

export type StripItem = TimedEntry & { now?: boolean; sun?: 'sunrise' | 'sunset'; night?: boolean };

// What a day's symbol shows: a condition, by day or by night, and the hour it is read from where
// that isn't the weather now.
export interface DaySky {
  condition: string | undefined;
  night: boolean;
  hour?: TimedEntry;
}

// `chance` is the one a day's row shows: its forecast's, and today's the worst of what is left.
export type DailyItem = TimedEntry & {
  high: number | null;
  low: number | null;
  today: boolean;
  sky: DaySky;
  chance?: number;
};

export type Sun = Pick<EntityState, 'state' | 'attributes'>;

export function forecasts(entries: readonly ForecastEntry[] | undefined): TimedEntry[] {
  const unique = new Map<number, TimedEntry>();
  for (const entry of entries ?? []) {
    const time = Date.parse(entry.datetime ?? '');
    if (Number.isFinite(time)) unique.set(time, { ...entry, time });
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

// The hours a sentence speaks of, from the one under way: two days at most, as its clock names no
// day, whatever length the forecast runs to.
const TOLD = 2 * DAY;
export const hoursToTell = (entries: readonly ForecastEntry[] | undefined, now: number): TimedEntry[] =>
  forecasts(entries).filter(entry => entry.time + HOUR > now && entry.time < now + TOLD);

export function forecastTypes(
  features: number,
  config: { show_forecast: boolean; show_daily: boolean; show_high_low: boolean; weather_layout?: string },
): ForecastType[] {
  const hourly = Boolean(features & FORECAST_FEATURES.hourly),
    // The full page's tiles and sheets read both, whether or not its panels show them.
    page = config.weather_layout === 'page',
    wantsDays = page || config.show_daily || config.show_high_low || (config.show_forecast && !hourly),
    days: ForecastType[] = !wantsDays
      ? []
      : features & FORECAST_FEATURES.daily
        ? ['daily']
        : features & FORECAST_FEATURES.twiceDaily
          ? ['twice_daily']
          : [];
  // Hours are wanted for themselves, and for the days of an entity that gives none (see
  // daysFromHours).
  const hours: ForecastType[] =
    hourly && (page || config.show_forecast || (wantsDays && !days.length)) ? ['hourly'] : [];
  return [...hours, ...days];
}

export function dateKey(date: number | Date, timeZone: string | undefined): string {
  return dateFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// A day stamped at midnight names its date, in whatever zone it is written: an integration that
// stamps its days at midnight UTC would otherwise have each fall on the evening before, west of it.
// Such a day moves to noon on its date where the card is, as the card's own days are stamped. One
// stamped at any other hour is a moment in its day, read where the card is, and stays.
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u;
export function namedDays(list: readonly ForecastEntry[], timeZone: string | undefined): readonly ForecastEntry[] {
  const date = (entry: ForecastEntry) => MIDNIGHT.exec(entry.datetime ?? '')?.[1];
  if (!list.some(entry => date(entry) !== undefined)) return list;
  return list.map(entry => {
    const named = date(entry);
    return named === undefined ? entry : { ...entry, datetime: new Date(localNoon(named, timeZone)).toISOString() };
  });
}
// Noon on a date where the card is: noon UTC, less the zone's offset then.
const NOON_UTC = 'T12:00:00Z';
function localNoon(date: string, timeZone: string | undefined): number {
  const noon = Date.parse(date + NOON_UTC),
    parts = dateFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(noon),
    of = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(each => each.type === type)?.value),
    clock = Date.UTC(of('year'), of('month') - 1, of('day'), of('hour'), of('minute'));
  return noon - (clock - noon);
}

// Calendar days from `now` to `time` where the card is: 0 today, 1 tomorrow.
export const daysUntil = (time: number, now: number, timeZone: string | undefined): number =>
  Math.round((Date.parse(dateKey(time, timeZone)) - Date.parse(dateKey(now, timeZone))) / DAY);

// Today's forecast condition; with day and night halves, the one with frozen precipitation
// when either has it.
export function todayCondition(
  entries: readonly ForecastEntry[],
  now: number,
  timeZone: string | undefined,
): string | undefined {
  const today = dateKey(now, timeZone),
    conditions = forecasts(entries)
      .filter(entry => dateKey(entry.time, timeZone) === today)
      .map(entry => entry.condition);
  return conditions.find(condition => frozenPrecipitation(conditionPrecipitation(condition))) ?? conditions[0];
}

export function todayRange(
  entries: readonly ForecastEntry[],
  now: number,
  timeZone: string | undefined,
): { high: number | null; low: number | null } {
  const today = dateKey(now, timeZone);
  return dayRange(forecasts(entries).filter(entry => dateKey(entry.time, timeZone) === today));
}

function dayRange(day: readonly ForecastEntry[]): { high: number | null; low: number | null } {
  // A night's temperature is its low: with only "Tonight" left, today has no high to show.
  const highs = day
    .filter(entry => entry.is_daytime !== false)
    .map(entry => entry.temperature)
    .filter(finite);
  const lows = day
    .map(entry => entry.templow ?? (entry.is_daytime === false ? entry.temperature : null))
    .filter(finite);
  return { high: highs.length ? Math.max(...highs) : null, low: lows.length ? Math.min(...lows) : null };
}

// A gust is never under the wind. The two can come from different models, or from a reading and a
// forecast hour, and one under the other would turn the band between them inside out.
export const gustOverWind = <T extends ForecastEntry>(entry: T): T =>
  finite(entry.wind_gust_speed) && finite(entry.wind_speed) && entry.wind_gust_speed < entry.wind_speed
    ? { ...entry, wind_gust_speed: entry.wind_speed }
    : entry;

export function forecastItems(
  entries: readonly ForecastEntry[] | undefined,
  type: ForecastType,
  state: Pick<EntityState, 'state' | 'attributes'> | undefined,
  now = Date.now(),
  count = 12,
  timeZone?: string,
): StripItem[] {
  const sorted = forecasts(entries);
  if (type !== 'hourly') {
    const today = dateKey(now, timeZone);
    return sorted.filter(entry => dateKey(entry.time, timeZone) >= today).slice(0, count);
  }
  // The hour under way, or the first to come where the forecast starts after now: what now shows
  // wherever the entity has no reading of its own.
  const current =
    sorted.findLast(entry => entry.time <= now && entry.time > now - HOUR) ??
    sorted.find(entry => entry.time > now && entry.time <= now + HOUR);
  const attrs = state?.attributes;
  const live: StripItem = gustOverWind({
    ...current,
    time: now,
    now: true,
    condition: state?.state ?? current?.condition,
    temperature: attrs?.temperature ?? current?.temperature,
    wind_speed: attrs?.wind_speed ?? current?.wind_speed,
    wind_bearing: attrs?.wind_bearing ?? current?.wind_bearing,
  });
  return [live, ...sorted.filter(entry => entry.time > now).slice(0, count - 1)];
}

export function rainMetric(items: readonly ForecastEntry[]): 'precipitation_probability' | 'precipitation' {
  return items.some(entry => finite(entry.precipitation_probability)) ? 'precipitation_probability' : 'precipitation';
}

// The conditions that bring something down, worst first: what is severe, then what is frozen, as
// it is for the precipitation the views name, then what is heaviest.
const WETTEST = [
  CONDITION.hail,
  CONDITION.lightningRainy,
  CONDITION.snowyRainy,
  CONDITION.snowy,
  CONDITION.pouring,
  CONDITION.rainy,
] as const;
export interface RestOfDay {
  chance?: number;
  low?: number;
  high?: number;
  condition?: string | undefined;
  hour?: TimedEntry;
}
// What is left of today, from the hour under way to midnight: its worst chance, its lowest and
// highest temperatures, and the wettest hour in it. With nothing wet left there's no condition to go
// by, and with no hours nothing at all.
export function restOfDay(hours: readonly TimedEntry[], now: number, timeZone: string | undefined): RestOfDay {
  const today = dateKey(now, timeZone),
    left = hours.filter(entry => entry.time + HOUR > now && dateKey(entry.time, timeZone) === today),
    chances = left.map(entry => entry.precipitation_probability).filter(finite),
    temperatures = left.map(entry => entry.temperature).filter(finite),
    hour = WETTEST.flatMap(condition => left.find(entry => entry.condition === condition) ?? [])[0];
  return {
    ...(chances.length ? { chance: Math.max(...chances) } : {}),
    ...(temperatures.length ? { low: Math.min(...temperatures), high: Math.max(...temperatures) } : {}),
    ...(hour ? { condition: hour.condition, hour } : {}),
  };
}

// A later day made from hours needs at least half of them: a few hours of it say little of its high
// and low. Today counts however few are left.
const WHOLE_ENOUGH = HOURS_PER_DAY / 2;
// A day's sky from its hours: the wettest it holds, or else the one most of them have, in its day
// form.
function skyOfHours(hours: readonly TimedEntry[]): string | undefined {
  const wet = WETTEST.find(condition => hours.some(entry => entry.condition === condition));
  if (wet) return wet;
  const counts = new Map<string, number>();
  for (const { condition } of hours)
    if (condition) {
      const sky = condition === CONDITION.clearNight ? CONDITION.sunny : condition;
      counts.set(sky, (counts.get(sky) ?? 0) + 1);
    }
  return [...counts].reduce<[string | undefined, number]>(
    (most, sky) => (sky[1] > most[1] ? sky : most),
    [undefined, 0],
  )[0];
}
const present = (hours: readonly TimedEntry[], key: 'temperature' | HourlyTotal): number[] =>
  hours.map(entry => entry[key]).filter(finite);
type HourlyTotal = 'precipitation' | 'precipitation_probability' | 'wind_speed' | 'wind_gust_speed' | 'uv_index';
// The largest of a reading across a day's hours, where any has it.
const peak = (hours: readonly TimedEntry[], key: HourlyTotal): ForecastEntry => {
  const values = present(hours, key);
  return values.length ? { [key]: Math.max(...values) } : {};
};
// Days from an hourly forecast, for an entity that gives none.
export function daysFromHours(
  entries: readonly ForecastEntry[],
  now: number,
  timeZone: string | undefined,
): ForecastEntry[] {
  const dates = new Map<string, TimedEntry[]>();
  for (const entry of forecasts(entries)) {
    const date = dateKey(entry.time, timeZone);
    const group = dates.get(date);
    if (group) group.push(entry);
    else dates.set(date, [entry]);
  }
  const today = dateKey(now, timeZone);
  return [...dates]
    .filter(([date, hours]) => date === today || hours.length >= WHOLE_ENOUGH)
    .flatMap(([, hours]) => {
      const [first] = hours,
        temperatures = present(hours, 'temperature'),
        falls = present(hours, 'precipitation'),
        condition = skyOfHours(hours);
      if (!first?.datetime) return [];
      return {
        datetime: first.datetime,
        ...(condition ? { condition } : {}),
        ...(temperatures.length ? { temperature: Math.max(...temperatures), templow: Math.min(...temperatures) } : {}),
        ...(falls.length ? { precipitation: falls.reduce((sum, fall) => sum + fall, 0) } : {}),
        ...peak(hours, 'precipitation_probability'),
        ...peak(hours, 'wind_speed'),
        ...peak(hours, 'wind_gust_speed'),
        ...peak(hours, 'uv_index'),
      };
    });
}

// Today's symbol is the wettest of what is left of it, or the weather as it is now, and takes the
// form of now by night too; every later day shows its forecast in the day form, even where that
// entry is a night's.
// A forecast given by day and night has each night's low on the night's own entry, but that low
// comes in the small hours, on the date the night runs into. So a night that starts after noon
// belongs to the next day. These are the lows by date; a forecast with no such nights has none.
const NOON = 12;
function nightLows(entries: readonly TimedEntry[], timeZone: string | undefined): Map<string, number> {
  const lows = new Map<string, number>();
  for (const entry of entries) {
    if (entry.is_daytime !== false || finite(entry.templow) || !finite(entry.temperature)) continue;
    const key = dateKey(entry.time + (localHour(entry.time, timeZone) >= NOON ? DAY : 0), timeZone);
    lows.set(key, Math.min(entry.temperature, lows.get(key) ?? entry.temperature));
  }
  return lows;
}

// Today's temperatures so far: the lowest and highest recorded since midnight, the reading now among
// them.
export interface SoFar {
  low: number;
  high: number;
}

export function dailyItems(
  entries: readonly ForecastEntry[] | undefined,
  now: number,
  timeZone: string | undefined,
  current: Partial<DaySky> & RestOfDay & { soFar?: SoFar | undefined },
  count = 6,
): DailyItem[] {
  const groups = new Map<string, TimedEntry[]>(),
    today = dateKey(now, timeZone),
    sorted = forecasts(entries),
    nights = nightLows(sorted, timeZone);
  for (const entry of sorted) {
    const key = dateKey(entry.time, timeZone);
    if (key < today) continue;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups].slice(0, count).flatMap(([key, day]) => {
    const [first] = day;
    if (!first) return [];
    const range = dayRange(day),
      entry = day.find(each => each.is_daytime !== false) ?? first,
      isToday = key === today,
      own = nights.size ? nights.get(key) : range.low,
      // Today runs from midnight to midnight: what the forecast gives for it, the hours left of it,
      // and what was recorded of it so far. A forecast told by day and night has dropped last night's
      // low, and late in the day its daytime high too; with nothing else to go by, today keeps
      // tonight's low.
      lows = isToday ? [own, current.low, current.soFar?.low].filter(finite) : [],
      highs = isToday ? [range.high, current.high, current.soFar?.high].filter(finite) : [],
      low = lows.length ? Math.min(...lows) : (own ?? range.low),
      high = highs.length ? Math.max(...highs) : range.high,
      sky: DaySky = isToday
        ? {
            condition: current.condition ?? entry.condition,
            night: current.night ?? false,
            ...(current.hour ? { hour: current.hour } : {}),
          }
        : { condition: entry.condition, night: false },
      chance = (isToday ? current.chance : undefined) ?? entry.precipitation_probability;
    return [{ ...entry, ...range, high, low, today: isToday, sky, ...(finite(chance) ? { chance } : {}) }];
  });
}

// A later day as an hour of it, for what goes by a rate: its precipitation is the day's total.
export const dayAsHour = <Day extends { precipitation?: number | null | undefined }>(day: Day) =>
  finite(day.precipitation) ? { ...day, precipitation: day.precipitation / HOURS_PER_DAY } : day;

export const localHour = (time: number, timeZone: string | undefined): number =>
  Number(dateFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(time)) % HOURS_PER_DAY;

// Insert the next sunrise and sunset from sun.sun where they fall inside the strip, and mark
// each later hour that starts between a sunset and the next sunrise as night, whatever its
// condition says. The times recur a day apart; where the next one is further off, as near the
// poles, no hour is marked.
const SUN_EVENTS = [
  ['sunrise', 'next_rising'],
  ['sunset', 'next_setting'],
] as const;

// How long after the last `event` (one a day) `time` falls.
const since = (time: number, event: number) => (((time - event) % DAY) + DAY) % DAY;

// Whether a time falls between a sunset and the next sunrise, by sun.sun's next times as seen
// from `from`; null where they don't recur a day apart or aren't known.
export function nightBySun(
  sun: Pick<EntityState, 'attributes'> | undefined,
  from: number,
): ((time: number) => boolean) | null {
  const [rising, setting] = SUN_EVENTS.map(([, key]) => Date.parse(sun?.attributes[key] ?? ''));
  return finite(rising) && finite(setting) && Math.abs(rising - setting) < DAY && Math.min(rising, setting) < from + DAY
    ? time => since(time, setting) < since(rising, setting)
    : null;
}

// Where the card is, from which the sun can be worked out when sun.sun can't say.
export interface Place {
  latitude?: number | undefined;
  longitude?: number | undefined;
}
// Whether the sun is down at a time, by where the card is alone.
function nightByPlace({ latitude, longitude }: Place = {}): ((time: number) => boolean) | null {
  return finite(latitude) && finite(longitude)
    ? time => solarElevation(time, latitude, longitude) < ELEVATION.daylight
    : null;
}

export function withSunEvents(
  items: StripItem[],
  sun: Pick<EntityState, 'attributes'> | undefined,
  place?: Place,
): StripItem[] {
  const first = items[0],
    last = items.at(-1);
  if (items.length < 2 || !first || !last) return items;
  const start = first.time,
    end = last.time,
    events: StripItem[] = [];
  for (const [kind, key] of SUN_EVENTS) {
    const time = Date.parse(sun?.attributes[key] ?? '');
    if (Number.isFinite(time) && time > start && time < end) events.push({ time, sun: kind });
  }
  const bySun = nightBySun(sun, start),
    dark = bySun ?? nightByPlace(place);
  // Now is for the sky itself to say, unless there is no sun.sun to tell it.
  const hours = dark ? items.map(item => (item.now && bySun ? item : { ...item, night: dark(item.time) })) : items;
  return [...hours, ...events].sort((a, b) => a.time - b.time);
}
