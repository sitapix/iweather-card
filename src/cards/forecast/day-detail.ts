// What a row of the daily list shows of its day, from the hours the forecast holds of it: a day cut
// into stretches of two hours, with what each brings.
import type { ForecastEntry } from '../../card/home-assistant.ts';
import { HOUR, HOURS_PER_DAY, MINUTE } from '../../lib/time.ts';
import { finite } from '../../lib/values.ts';
import { clockHours, dayAxis, type DayAxis, hoursInto } from '../../sheets/days.ts';
import { sunEvents } from '../../sky/sun.ts';
import { dateKey, type DailyItem, forecasts, type Place, type TimedEntry } from '../../weather/forecast-items.ts';
import { conditionPrecipitation, precipitationSymbol, roundChance } from '../../weather/precipitation.ts';

// Two hours gone by the clock's own count from midnight, so that the hour a clock repeats or skips
// falls where the time does. Twelve to a day; thirteen on a day of 25 hours, its last one lone
// hour; and eleven on a day of 23, its last taking the odd hour.
const SEGMENT_HOURS = 2;
const SEGMENTS = 12;
const segmentCount = (hours: number): number => SEGMENTS + Math.round(hours - HOURS_PER_DAY);

// With no place to work the sun out from, it is taken to be up from six to six.
const SUN_UP = { from: 6, to: 18 } as const;
// A chance this likely shows its drop, whatever the day brings.
const LIKELY = 10;

export interface DaySegment {
  // The sun is up for all of it.
  day: boolean;
  // The most of each reading among its hours, or null with none.
  amount: number | null;
  chance: number | null;
  speed: number | null;
  gust: number | null;
}
export interface DayDetail {
  segments: DaySegment[];
  total: number;
  chance: number | null;
  // The wind's lowest and highest. Hours that cover under half a day are no range for it, unless
  // the day is today, which holds what is left of it.
  range: [low: number, high: number] | null;
}

const most = (values: readonly (number | null | undefined)[]): number | null => {
  const held = values.filter(finite);
  return held.length ? Math.max(...held) : null;
};
// Whether the sun is up for the whole of a stretch of the day.
function sunlight({ start, hours }: DayAxis, { latitude, longitude }: Place, timeZone: string | undefined) {
  if (!finite(latitude) || !finite(longitude))
    return (from: number, to: number) =>
      clockHours(from, timeZone) >= SUN_UP.from && clockHours(to - MINUTE, timeZone) < SUN_UP.to;
  const { sunrise, sunset, daylight } = sunEvents(start + (hours / 2) * HOUR, latitude, longitude);
  // Where it never rises or never sets, it is the same all day.
  if (sunrise === null || sunset === null) return () => daylight > 0;
  return (from: number, to: number) => sunrise <= from && to <= sunset;
}
function dayDetail(
  { time, today }: Pick<DailyItem, 'time' | 'today'>,
  hours: readonly TimedEntry[],
  timeZone: string | undefined,
  place: Place,
): DayDetail {
  const axis = dayAxis(time, timeZone),
    count = segmentCount(axis.hours),
    sunUp = sunlight(axis, place, timeZone),
    end = axis.start + axis.hours * HOUR,
    edge = (index: number) => (index < count ? axis.start + index * SEGMENT_HOURS * HOUR : end);
  const segments = Array.from({ length: count }, (_, index): DaySegment => {
    const from = edge(index),
      to = edge(index + 1),
      inside = hours.filter(entry => entry.time >= from && entry.time < to),
      speed = most(inside.map(entry => entry.wind_speed)),
      gust = most(inside.map(entry => entry.wind_gust_speed));
    return {
      day: sunUp(from, to),
      amount: most(inside.map(entry => entry.precipitation)),
      chance: most(inside.map(entry => entry.precipitation_probability)),
      speed,
      // Each reading is the most of its hours, and an hour without a gust can hold the wind's.
      gust: gust === null ? null : Math.max(gust, speed ?? gust),
    };
  });
  const speeds = hours.map(entry => entry.wind_speed).filter(finite);
  return {
    segments,
    total: hours.reduce((total, entry) => total + (finite(entry.precipitation) ? entry.precipitation : 0), 0),
    chance: most(segments.map(segment => segment.chance)),
    range: speeds.length >= (today ? 1 : HOURS_PER_DAY / 2) ? [Math.min(...speeds), Math.max(...speeds)] : null,
  };
}
// Each of the listed days by its date, a day with no hours among them: its segments have only the
// sun to go by.
export function dailyDetail(
  hourly: readonly ForecastEntry[] | undefined,
  days: readonly Pick<DailyItem, 'time' | 'today'>[],
  timeZone: string | undefined,
  place: Place = {},
): Map<string, DayDetail> {
  const held = new Map<string, TimedEntry[]>();
  for (const entry of forecasts(hourly)) {
    const key = dateKey(entry.time, timeZone),
      hours = held.get(key);
    if (hours) hours.push(entry);
    else held.set(key, [entry]);
  }
  return new Map(
    days.map(day => {
      const key = dateKey(day.time, timeZone);
      return [key, dayDetail(day, held.get(key) ?? [], timeZone, place)];
    }),
  );
}
// Where a moment comes along its day's segments: 7.5 is halfway through the eighth. The last hours of
// a day stand on the last segment, where its line ends.
export const placeInDay = (time: number, timeZone: string | undefined): number =>
  Math.min(segmentCount(dayAxis(time, timeZone).hours) - 1, hoursInto(time, timeZone) / SEGMENT_HOURS);

// A day's chance as a row shows it: its forecast's, else the worst of its hours.
export const dayChance = (day: DailyItem, info: DayDetail | undefined): number | null =>
  day.chance ?? info?.chance ?? null;

// How much a day brings: what its hours add up to, as long as they cover half of it or there's
// nothing else, or else its forecast's. Every surface that names a day's total reads this one.
export function dayTotal(day: Pick<DailyItem, 'precipitation'>, info: DayDetail | undefined) {
  const held = info?.segments.filter(segment => segment.amount !== null).length ?? 0;
  return info && held && (held >= info.segments.length / 2 || !finite(day.precipitation))
    ? info.total
    : day.precipitation;
}
// A day's precipitation as its row shows it: how much, how likely, of what kind, and whether the
// chance goes with its drop. The day's own kind, as the hours have theirs, counts what its hours
// bring.
export function dayRain(day: DailyItem, info: DayDetail | undefined) {
  const total = dayTotal(day, info),
    chance = dayChance(day, info),
    wet = conditionPrecipitation(day.sky.condition) !== undefined && (total ?? 0) > 0;
  return {
    total,
    chance,
    falling: precipitationSymbol({ condition: day.sky.condition, precipitation: total }),
    drop: wet || (finite(chance) && roundChance(chance) >= LIKELY),
  };
}
