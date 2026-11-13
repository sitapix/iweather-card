import { dateFormat } from '../lib/formats.ts';
import { DAY, HOUR, HOURS_PER_DAY, MINUTE, MINUTES_PER_HOUR } from '../lib/time.ts';
import { type TimedEntry, type DailyItem, dateKey, forecasts } from '../weather/forecast-items.ts';
import { extendForecast, fillForecast } from '../weather/forecast.ts';
import { type History, stateTime } from '../weather/history.ts';
import { finite, isRecord, text } from '../lib/values.ts';
import type { ForecastEntry } from '../card/home-assistant.ts';
// One numeric part (hour, minute, …) of a formatted time; NaN when the format has none.
export const part = (parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  Number(parts.find(item => item.type === type)?.value);
// The minutes a clock shows past midnight, and the same in hours. A clock isn't an axis: it repeats
// an hour when the clocks go back and skips one when they go forward (see dayAxis).
function clockMinutes(time: number, timeZone: string | undefined): number {
  const parts = dateFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone }).formatToParts(
    time,
  );
  return (part(parts, 'hour') % HOURS_PER_DAY) * MINUTES_PER_HOUR + part(parts, 'minute');
}
export const clockHours = (time: number, timeZone: string | undefined): number =>
  clockMinutes(time, timeZone) / MINUTES_PER_HOUR;
// The first moment of `time`'s date. The clock says how long ago that was unless it changed on the
// way, so each step asks again from the moment before: going back it may land an hour short, still
// in the date, and going forward an hour past, in the day before.
function dayStart(time: number, timeZone: string | undefined): number {
  const date = dateKey(time, timeZone);
  let start = time - (time % MINUTE);
  for (;;) {
    const before = start - MINUTE;
    if (dateKey(before, timeZone) !== date) return start;
    start = before - clockMinutes(before, timeZone) * MINUTE;
    if (dateKey(start, timeZone) !== date) start += DAY - clockMinutes(start, timeZone) * MINUTE;
  }
}
// A day as a chart lays it out: the moment it starts and the hours it runs, which are 24 but for the
// days the clocks change, usually 23 and 25. A point's place on it is the time gone since the start.
export interface DayAxis {
  start: number;
  hours: number;
}
// Past the end of the longest day, and short of the end of the next.
const NEXT_DAY = 26 * HOUR;
// The last day asked for: a chart asks after the same day for each of its points.
let kept: (DayAxis & { timeZone: string | undefined }) | undefined;
export function dayAxis(time: number, timeZone: string | undefined): DayAxis {
  if (kept && kept.timeZone === timeZone && time >= kept.start && time < kept.start + kept.hours * HOUR) return kept;
  const start = dayStart(time, timeZone);
  kept = { start, hours: (dayStart(start + NEXT_DAY, timeZone) - start) / HOUR, timeZone };
  return kept;
}
// Hours gone from the start of `time`'s day.
export const hoursInto = (time: number, timeZone: string | undefined): number =>
  (time - dayAxis(time, timeZone).start) / HOUR;

// A day of the detail sheets: its hourly entries and, where there is one, its daily forecast. A day
// gone by is `past`: its hours are what was recorded, and there may be none.
export interface DetailDay {
  key: string;
  today: boolean;
  past?: true;
  time: number;
  entries: readonly TimedEntry[];
  daily?: ForecastEntry & Pick<DailyItem, 'high' | 'low' | 'sky'>;
}
// Days with at least a few hourly entries (six), today first.
const FEWEST_HOURS = 6;
export function detailDays(
  hourly: readonly ForecastEntry[] | undefined,
  now: number,
  timeZone: string | undefined,
): DetailDay[] {
  const today = dateKey(now, timeZone),
    days = new Map<string, TimedEntry[]>();
  for (const entry of forecasts(hourly)) {
    const key = dateKey(entry.time, timeZone);
    if (key < today) continue;
    const day = days.get(key);
    if (day) day.push(entry);
    else days.set(key, [entry]);
  }
  return [...days].flatMap(([key, entries]) => {
    const [first] = entries;
    return first && (key === today || entries.length >= FEWEST_HOURS)
      ? [{ key, today: key === today, time: first.time, entries }]
      : [];
  });
}

// Yesterday and today and nine more: every day-based sheet offers the same days, whether or not
// each has its reading. A day without says so, rather than the strip leaving it out.
const DAYS_ON_OFFER = 11;
// How near an hour of the forecast has to be to a recorded reading to fill in what that lacks.
const WITHIN_THE_HOUR = HOUR / 2;
// Yesterday's readings from the history of the entity, in the card's units, one to the hour.
function recordedHours(states: readonly unknown[]): ForecastEntry[] {
  const hours = new Map<number, ForecastEntry>();
  for (const state of states) {
    if (!isRecord(state)) continue;
    const time = stateTime(state),
      attrs = state['a'] ?? state['attributes'],
      condition = state['s'] ?? state['state'];
    if (Number.isFinite(time) && isRecord(attrs))
      hours.set(Math.floor(time / HOUR), {
        ...attrs,
        ...(text(condition) ? { condition } : {}),
        datetime: new Date(time).toISOString(),
      });
  }
  return [...hours.values()];
}
// A day gone by, as the daily list has a day: its range and the sky at its middle.
function dayFrom(entries: readonly TimedEntry[]): DetailDay['daily'] {
  const middle = entries[Math.floor(entries.length / 2)],
    temperatures = entries.flatMap(entry => (finite(entry.temperature) ? [entry.temperature] : []));
  if (!middle || !temperatures.length) return undefined;
  return {
    condition: middle.condition,
    high: Math.max(...temperatures),
    low: Math.min(...temperatures),
    sky: { condition: middle.condition, night: false },
  };
}
export interface DaySources {
  hourly: readonly TimedEntry[];
  pastHours: readonly TimedEntry[];
  daily: readonly DailyItem[];
  now: number;
  timeZone: string | undefined;
}
export function sheetDays(
  { hourly, pastHours, daily, now, timeZone }: DaySources,
  history: Pick<History, 'yesterday'> | null | undefined,
): DetailDay[] {
  const today = dateKey(now, timeZone),
    days = new Map(detailDays(hourly, now, timeZone).map(day => [day.key, day]));
  for (const item of daily) {
    const key = dateKey(item.time, timeZone);
    days.set(key, { key, today: item.today, time: item.time, daily: item, entries: days.get(key)?.entries ?? [] });
  }
  if (!days.has(today)) days.set(today, { key: today, today: true, time: now, entries: [] });
  // What Home Assistant recorded, filled in and carried on by the hours the forecast keeps.
  const time = dayAxis(dayAxis(now, timeZone).start - 1, timeZone).start,
    key = dateKey(time, timeZone),
    kept = pastHours.filter(entry => dateKey(entry.time, timeZone) === key),
    recorded = fillForecast(recordedHours(history?.yesterday ?? []), kept, WITHIN_THE_HOUR),
    { forecast, earlier } = extendForecast(recorded, kept, WITHIN_THE_HOUR, now),
    entries = forecasts([...earlier, ...forecast]),
    gone = dayFrom(entries);
  return [
    { key, today: false, past: true as const, time, entries, ...(gone ? { daily: gone } : {}) },
    ...[...days.values()].sort((a, b) => a.time - b.time),
  ].slice(0, DAYS_ON_OFFER);
}
