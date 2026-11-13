import { type EntityState, STATE } from '../../card/home-assistant.ts';
import { DAY } from '../../lib/time.ts';
import { dateKey } from '../../weather/forecast-items.ts';
// Sun position along a day curve: 1 at solar noon, -1 at midnight. The horizon lies as far down
// the curve, from its peak to its trough, as the day's share of daylight, so a 12-hour day puts it
// half way; the Sun, following the curve by the clock, crosses it a little after sunset and
// before sunrise. The curve is centred on the solar noon of the local date, and `progress` runs
// from 12 hours before it to 12 hours after, so it leaves 0 to 1 where solar midnight and local
// midnight differ: just before solar midnight it is below 0, in the place of a sun hanging past
// the curve's edge.
export interface SunPath {
  up: boolean;
  rising: number;
  setting: number;
  noon: number;
  horizon: number;
  progress: number;
  level: (time: number) => number;
}
export function sunPath(
  sun: Pick<EntityState, 'state' | 'attributes'> | undefined,
  now: number,
  timeZone: string | undefined,
): SunPath | null {
  const parse = (key: 'next_noon' | 'next_setting' | 'next_rising') => Date.parse(sun?.attributes[key] ?? '');
  let noon = parse('next_noon');
  const setting = parse('next_setting'),
    rising = parse('next_rising');
  if (![noon, setting, rising].every(Number.isFinite)) return null;
  const today = dateKey(now, timeZone);
  while (dateKey(noon, timeZone) > today) noon -= DAY;
  while (dateKey(noon, timeZone) < today) noon += DAY;
  const near = (time: number) => {
    while (time - noon > DAY / 2) time -= DAY;
    while (noon - time > DAY / 2) time += DAY;
    return time;
  };
  const level = (time: number) => Math.cos((2 * Math.PI * (time - noon)) / DAY),
    daylight = Math.min(1, Math.max(0, (near(setting) - near(rising)) / DAY));
  return {
    up: sun?.state === STATE.aboveHorizon,
    rising,
    setting,
    noon,
    horizon: 1 - 2 * daylight,
    progress: (now - (noon - DAY / 2)) / DAY,
    level,
  };
}
