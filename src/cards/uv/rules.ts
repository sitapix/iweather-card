import { clock } from '../shared/tile.ts';
import type { ForecastEntry } from '../../card/home-assistant.ts';
import type { ClockContext } from '../shared/context.ts';
import { dateKey, forecasts, type TimedEntry, localHour } from '../../weather/forecast-items.ts';
import { finite } from '../../lib/values.ts';
import { HOURS_PER_DAY } from '../../lib/time.ts';
import { phrase, say } from '../../weather/words.ts';
// The UV index's levels, each from its value up: Moderate (3) and up needs sun protection,
// strongly from Very High (8); the scales run to Extreme (11).
export const UV = { moderate: 3, high: 6, veryHigh: 8, extreme: 11 } as const;
const UV_TOP_LEVEL = phrase('Extreme');
const UV_LEVELS: readonly (readonly [below: number, level: string])[] = [
  [UV.moderate, phrase('Low')],
  [UV.high, phrase('Moderate')],
  [UV.veryHigh, phrase('High')],
  [UV.extreme, phrase('Very High')],
  [Infinity, UV_TOP_LEVEL],
];
export const uvLevel = (value: number): string => say(UV_LEVELS.find(([limit]) => value < limit)?.[1] ?? UV_TOP_LEVEL);
// The hours left today that have a UV index.
const laterToday = (hourly: readonly ForecastEntry[], now: number, timeZone: string | undefined) => {
  const today = dateKey(now, timeZone);
  return forecasts(hourly).filter(
    (entry): entry is TimedEntry & { uv_index: number } =>
      entry.time > now && dateKey(entry.time, timeZone) === today && finite(entry.uv_index),
  );
};
// Hours from now that need sun protection (UV 3 or more) on the local date.
export function uvAdvice(
  value: number,
  hourly: readonly ForecastEntry[],
  now: number,
  timeZone: string | undefined,
  ctx: ClockContext,
): string {
  // Moderate (3) and up needs sun protection. The first of these that applies:
  // high now, until the first low hour after it, or all day / the rest of the day when none
  // is low; a low morning with nothing high today, low all day; low now and high later
  // today, from the first high hour to the next low one, or at it when none follows; else
  // low for the rest of the day.
  const ahead = laterToday(hourly, now, timeZone),
    high = (uv: number) => uv >= UV.moderate,
    morning = beforeNoon(now, timeZone),
    at = (time: number) => clock(time, ctx, false);
  if (high(value)) {
    const low = ahead.find(entry => !high(entry.uv_index));
    return low
      ? say('Use sun protection until {time}.', { time: at(low.time) })
      : morning
        ? say('Use sun protection all day.')
        : say('Use sun protection for the rest of the day.');
  }
  const start = ahead.find(entry => high(entry.uv_index));
  if (!start) return morning ? say('Low levels all day.') : say('Low for the rest of the day.');
  const end = ahead.find(entry => entry.time > start.time && !high(entry.uv_index));
  return end
    ? say('Use sun protection {from}-{to}.', { from: at(start.time), to: at(end.time) })
    : say('Use sun protection at {time}.', { time: at(start.time) });
}
// The UV sheet's summary of today: low all day when nothing reaches Moderate; protection
// recommended when it is Moderate or High now, strongly from Very High (8); else low now with
// higher to come, or low for the rest of the day.
export function uvSummary(
  value: number,
  hourly: readonly ForecastEntry[],
  now: number,
  timeZone: string | undefined,
): string {
  const later = laterToday(hourly, now, timeZone),
    rises = later.some(entry => entry.uv_index >= UV.moderate);
  if (value < UV.moderate && !rises)
    return beforeNoon(now, timeZone) ? say('Low levels all day.') : say('Low for the rest of the day.');
  if (value >= UV.veryHigh) return say('Sun protection strongly recommended.');
  if (value >= UV.moderate) return say('Sun protection recommended.');
  return say('Low levels currently.');
}
// Whether it is still morning where the card is.
const beforeNoon = (now: number, timeZone: string | undefined) => localHour(now, timeZone) < HOURS_PER_DAY / 2;
