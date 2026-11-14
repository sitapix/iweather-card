import { HOUR, MINUTE } from '../lib/time.ts';
import { finite } from '../lib/values.ts';
import type { ForecastEntry } from '../card/home-assistant.ts';
import { conditionPrecipitation } from './precipitation.ts';

// How soon precipitation comes, which sets how the small precipitation map plays and how far out it
// looks: falling now, starting within the hour, within three hours or six, or not in sight; unknown
// without an hourly forecast at all.
export type RainOutlook = 'now' | 'nextHour' | 'nextThreeHours' | 'nextSixHours' | 'none' | 'unknown';

// A stretch of the next hour minute by minute: from `start` to `end` (ms), and whether anything
// falls in it.
export interface MinuteSpan {
  start: number;
  end: number;
  wet: boolean;
}

// The minute forecast decides first, where there is one: precipitation falling in the stretch under
// way is now, and a stretch with it starting within the hour is the next hour. The hourly forecast
// decides the rest, by the first hour that brings precipitation, passing over hours begun more than
// an hour ago: an hour under way is no hours off, and one ahead its whole hours away and at least
// one. Under three hours off is within three, under six within six.
const WITHIN = { threeHours: 3, sixHours: 6 } as const;
export function rainOutlook(
  minutes: readonly MinuteSpan[],
  hourly: readonly ForecastEntry[],
  now: number,
): RainOutlook {
  if (minutes.some(span => span.wet && span.start <= now && now < span.end)) return 'now';
  const next = minutes.find(span => span.wet && span.start > now);
  if (next && next.start - now < HOUR) return 'nextHour';
  if (hourly.length === 0) return 'unknown';
  const start = Math.min(
    ...hourly.flatMap(entry => {
      const time = Date.parse(entry.datetime ?? '');
      return Number.isFinite(time) &&
        time >= now - HOUR &&
        ((entry.precipitation ?? 0) > 0 || conditionPrecipitation(entry.condition) !== undefined)
        ? [time]
        : [];
    }),
  );
  if (!Number.isFinite(start)) return 'none';
  const hours = start <= now ? 0 : Math.max(1, Math.trunc((start - now) / HOUR));
  return hours < WITHIN.threeHours ? 'nextThreeHours' : hours < WITHIN.sixHours ? 'nextSixHours' : 'none';
}

const QUARTER = 15 * MINUTE;
// Minute stretches from the next hour's readings, a rate for each minute from `now` (null where
// there is none), or else from the forecast's quarter hours, each ending at its time.
export function minuteSpans(
  series: readonly (number | null)[] | undefined,
  quarters: readonly { time: number; precipitation: number }[] | undefined,
  now: number,
): MinuteSpan[] {
  if (series?.some(rate => rate !== null))
    return series.flatMap((rate, minute) =>
      rate === null ? [] : [{ start: now + minute * MINUTE, end: now + (minute + 1) * MINUTE, wet: rate > 0 }],
    );
  return (quarters ?? []).flatMap(({ time, precipitation }) =>
    finite(precipitation) ? [{ start: time - QUARTER, end: time, wet: precipitation > 0 }] : [],
  );
}
