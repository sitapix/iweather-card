import { type Normal, monthDay, normalRain } from './climate.ts';
import type { TileContext } from '../shared/context.ts';
import { type DailyItem, dateKey } from '../../weather/forecast-items.ts';
import { finite } from '../../lib/values.ts';
import { say } from '../../weather/words.ts';
// Today's forecast high against the climate normal for the date.
const LEAP_DAY = '02-29',
  DAY_BEFORE_LEAP = '02-28';
export interface AverageToday {
  high: number;
  normal: Normal;
  difference: number;
  label: string;
}
export function averageToday(
  ctx: Pick<TileContext, 'now' | 'timeZone' | 'climate'> & { daily: readonly Pick<DailyItem, 'today' | 'high'>[] },
): AverageToday | null {
  const today = ctx.daily.find(day => day.today),
    key = monthDay(dateKey(ctx.now, ctx.timeZone));
  // Leap day takes the day before's normal where the record has none of its own.
  const normal = ctx.climate?.normals[key] ?? ctx.climate?.normals[key === LEAP_DAY ? DAY_BEFORE_LEAP : key];
  if (!normal || !today || !finite(today.high)) return null;
  const difference = Math.round(today.high) - Math.round(normal.high);
  return {
    high: today.high,
    normal,
    difference,
    label: difference > 0 ? say('above average daily high') : say('from average daily high'),
  };
}
// The last 30 days' precipitation against what usually falls over the same days.
export function averageRain(ctx: Pick<TileContext, 'climate' | 'recentRain'>): {
  total: number;
  normal: number;
  difference: number;
} | null {
  const recent = ctx.recentRain,
    normal = recent ? normalRain(ctx.climate, recent.dates) : null;
  return recent && normal !== null ? { total: recent.total, normal, difference: recent.total - normal } : null;
}
