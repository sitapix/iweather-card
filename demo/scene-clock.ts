import { DAY, HOUR, HOURS_PER_DAY } from '../src/lib/time.ts';

// The previews place the clock from the sky they show: noon with the sun 55° up,
// before dawn, evening or midnight with the sun below the horizon.
export function sceneHour(elevation: number, rising: boolean): number {
  const share = Math.min(1, elevation / 55) * 6;
  return elevation < 0 ? (rising ? 4 : elevation > -10 ? 20 : 0) : rising ? 6 + share : 18 - share;
}

// A zone where it is `hour` o'clock now, so the forecast's first hour is the scene's. Fixed
// offsets are whole hours, and the minutes stay the visitor's.
export function zoneAt(hour: number, now: number): string {
  const utc = new Date(now).getUTCHours(),
    offset = ((Math.round(hour - utc) + HOURS_PER_DAY + HOURS_PER_DAY / 2) % HOURS_PER_DAY) - HOURS_PER_DAY / 2;
  if (offset === 0) return 'UTC';
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

// Sunrise, noon and sunset on a preview's twelve-hour day.
export function sunTimes(local: number, now: number) {
  const sunrise = now - ((local + 18) % HOURS_PER_DAY) * HOUR,
    next = (time: number) => new Date(time > now ? time : time + DAY).toISOString();
  return { next_rising: next(sunrise), next_noon: next(sunrise + 6 * HOUR), next_setting: next(sunrise + 12 * HOUR) };
}
