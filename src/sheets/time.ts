import type { TileContext } from '../cards/shared/context.ts';
import { clockFormat } from '../lib/formats.ts';
// A time as its hour or clock, with its day period small: 11AM, 4:24PM.
export const clockOf = (ctx: Pick<TileContext, 'locale' | 'timeZone' | 'hour12'>, minutes = true) => {
  const format = clockFormat(ctx, minutes);
  return (time: number) => ampm(format.format(time));
};
export const clockNow = (ctx: Pick<TileContext, 'locale' | 'timeZone' | 'hour12' | 'now'>): string =>
  clockOf(ctx)(ctx.now);

// A time of day with no date is formatted on a day of its own, in UTC: 1 January 2000.
export const REFERENCE_YEAR = 2000;
export const REFERENCE_DAY = Date.UTC(REFERENCE_YEAR, 0, 1);
// A time with its day period small: 6<small>AM</small>.
export const ampm = (text: string) => text.replace(/\s?([AP]M)/i, '<small>$1</small>');
