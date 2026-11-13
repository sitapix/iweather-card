import type { SummaryContext } from '../../sheets/reading.ts';
import { type ChartContext, type ChartLook, chartMarkup } from '../../sheets/chart.ts';
import { dayAxis, type DetailDay } from '../../sheets/days.ts';
import type { ForecastEntry } from '../../card/home-assistant.ts';
import type { TileContext } from '../shared/context.ts';
import { detailSeries } from '../../sheets/series.ts';
import { finite } from '../../lib/values.ts';
import { roundChance } from '../../weather/precipitation.ts';
import { chanceSeries, chanceLook, chanceScale } from './looks.ts';
import { hoursOf } from './totals.ts';
import { say } from '../../weather/words.ts';
type ChanceContext = SummaryContext & ChartContext & Pick<TileContext, 'pastHours'>;
// A day's hours with a chance of precipitation.
const hoursWithChance = (ctx: ChanceContext, day: DetailDay) =>
  detailSeries(chanceSeries, hoursOf(ctx, day), ctx.attrs, ctx.now, ctx.timeZone, false);
// The chance of precipitation through the day, under the day's own chance (which tends to be
// higher than any hour's), read like the main chart in place of its heading. A chance nobody gave
// isn't none, so with no chance for the day there's nothing here. With only the day's there is no
// chart.
export function chanceHead(
  ctx: ChanceContext,
  day: DetailDay,
  daily: ForecastEntry | undefined,
  weekday: string,
): string {
  const hours = hoursWithChance(ctx, day),
    chance = finite(daily?.precipitation_probability)
      ? daily.precipitation_probability
      : hours.length
        ? Math.max(...hours.map(point => point.value))
        : null;
  if (!finite(chance)) return '';
  const shown = `${ctx.fmt(roundChance(chance))}%`;
  return `<section class="detail-chance"><div class="detail-reading chance-reading"><span class="detail-time"></span><h4>${say('Chance of Precipitation')}</h4><p class="detail-sub">${day.today ? say('Today’s chance: {chance}', { chance: shown }) : say('{weekday}’s chance: {chance}', { weekday, chance: shown })}</p></div></section>`;
}
// The line runs, and is read, from now on only, and a day that is over has none; the sheet holding
// it can ask for it to be read `alone` too.
export function chanceChart(ctx: ChanceContext, day: DetailDay, reading: Pick<ChartLook, 'alone'> = {}): string {
  const hours = hoursWithChance(ctx, day),
    first = day.entries[0]?.time ?? Infinity;
  return hours.length
    ? chartMarkup(
        { ...chanceLook, ...reading },
        hours.filter(point => point.time >= first),
        chanceScale(),
        ctx,
        dayAxis(day.time, ctx.timeZone),
        hours.filter(point => point.time < first),
        'chance-reading',
      )
    : '';
}
export const chanceNote = (ctx: ChanceContext, day: DetailDay): string =>
  hoursWithChance(ctx, day).length
    ? `<p class="detail-note">${say('A day’s chance of precipitation usually runs above any single hour’s.')}</p>`
    : '';
