import type { ConditionsContext } from '../forecast/conditions.ts';
import { dayAxis, type DetailDay } from '../../sheets/days.ts';
import { dateKey } from '../../weather/forecast-items.ts';
import {
  conditionPrecipitation,
  precipitationAmount,
  precipitationWords,
  type PrecipitationKind,
} from '../../weather/precipitation.ts';
import { dateFormat } from '../../lib/formats.ts';
import { detailSeries, earlierPoints } from '../../sheets/series.ts';
import { dayAmount, fallOf, hoursOf, lastDayFall, nextDay, nextWetDay, nextWetWords, totals } from './totals.ts';
import { finite } from '../../lib/values.ts';
import { esc } from '../../lib/html.ts';
import { UNITS } from '../../weather/units.ts';
import { chartMarkup } from '../../sheets/chart.ts';
import { HOURS_PER_DAY } from '../../lib/time.ts';
import { chanceChart, chanceHead, chanceNote } from './chance.ts';
import { aboutMarkup, sheetSection } from '../../sheets/parts.ts';
import type { SheetView } from '../card.ts';
import { chartPages } from '../../sheets/pages.ts';
import { dayHead, noHours } from '../../sheets/reading.ts';
import { glyphs } from '../shared/glyphs.ts';
import { precipitationSeries, precipitationLook, precipitationScale } from './looks.ts';
import { phrase, say, sayCount } from '../../weather/words.ts';
// A day's total in a whole sentence for each kind, as a word like "total" takes after its noun in
// many languages: today's, a day that is over, and a day to come.
const TOTALS: Readonly<Record<PrecipitationKind | 'any', { today: string; over: string; later: string }>> = {
  rain: {
    today: phrase('Today’s total rainfall will be {amount}.'),
    over: phrase('Yesterday, the total rainfall was {amount}.'),
    later: phrase('On {weekday}, the total rainfall will be {amount}.'),
  },
  snow: {
    today: phrase('Today’s total snowfall will be {amount}.'),
    over: phrase('Yesterday, the total snowfall was {amount}.'),
    later: phrase('On {weekday}, the total snowfall will be {amount}.'),
  },
  sleet: {
    today: phrase('Today’s total sleet will be {amount}.'),
    over: phrase('Yesterday, the total sleet was {amount}.'),
    later: phrase('On {weekday}, the total sleet will be {amount}.'),
  },
  hail: {
    today: phrase('Today’s total hail will be {amount}.'),
    over: phrase('Yesterday, the total hail was {amount}.'),
    later: phrase('On {weekday}, the total hail will be {amount}.'),
  },
  wintry_mix: {
    today: phrase('Today’s total wintry mix will be {amount}.'),
    over: phrase('Yesterday, the total wintry mix was {amount}.'),
    later: phrase('On {weekday}, the total wintry mix will be {amount}.'),
  },
  any: {
    today: phrase('Today’s total precipitation will be {amount}.'),
    over: phrase('Yesterday, the total precipitation was {amount}.'),
    later: phrase('On {weekday}, the total precipitation will be {amount}.'),
  },
};
// The Precipitation sheet for a day: its total, how hard it falls through the day, the chance
// of it, the totals, and what has fallen and is expected, or when the next comes.
export function precipitationBody(
  ctx: ConditionsContext,
  day: DetailDay,
  asking = false,
  days: readonly DetailDay[] = [day],
): string {
  const { attrs } = ctx,
    unit = attrs.precipitation_unit,
    daily = ctx.daily.find(item => dateKey(item.time, ctx.timeZone) === day.key),
    weekday = dateFormat(ctx.locale, { weekday: 'long', timeZone: ctx.timeZone }).format(day.time);
  const fall = fallOf(hoursOf(ctx, day)),
    total = (daily && dayAmount(ctx, day, daily)) ?? fall?.amount ?? null,
    kind = fall?.kind ?? conditionPrecipitation(daily?.condition),
    amount = precipitationAmount(total, unit, ctx.numbers),
    words = (value: number) => esc(precipitationWords(value, unit, ctx.numbers));
  const headline = unit === UNITS.inches ? esc(amount) : esc(amount).replace(/ (\S+)$/, ' <small>$1</small>');
  const hours = days.map(item => ({
      item,
      points: detailSeries(precipitationSeries, item.entries, attrs, ctx.now, ctx.timeZone, false),
      past: earlierPoints(precipitationSeries, item.key, ctx, undefined),
    })),
    page = (item: DetailDay) => {
      const { points = [], past = [] } = hours.find(hour => hour.item === item) ?? {};
      return `${chartMarkup({ ...precipitationLook, note: noHours(item, asking) }, points, precipitationScale(), ctx, dayAxis(item.time, ctx.timeZone), past, 'detail-reading')}${chanceChart(ctx, item)}`;
    };
  const charts = hours.some(({ points, past }) => points.length || past.length)
    ? chartPages(days, page, chanceHead(ctx, day, daily, weekday))
    : `<p class="detail-note">${noHours(day, asking)}</p>${chanceHead(ctx, day, daily, weekday)}`;
  const told = TOTALS[finite(total) && total > 0 && kind ? kind : 'any'];
  const sentences: string[] = [];
  if (day.today) {
    const last = lastDayFall(ctx),
      recent = ctx.recent ?? (last ? { hours: HOURS_PER_DAY, amount: last.amount } : null);
    if (recent)
      sentences.push(
        sayCount(
          'There has been {amount} of precipitation in the last {count} hour.',
          'There has been {amount} of precipitation in the last {count} hours.',
          recent.hours,
          { amount: (recent.partial ? '≥ ' : '') + words(recent.amount) },
        ),
      );
    if (finite(total)) sentences.push(say(told.today, { amount: words(total) }));
    // What the next 24 hours bring, or else when the next day with any comes and what it brings.
    const next = fallOf(nextDay(ctx)),
      wet = next && next.amount > 0 ? undefined : nextWetDay(ctx);
    if (next && next.amount > 0)
      sentences.push(
        say('In the next 24 hours, {amount} of precipitation is expected.', { amount: words(next.amount) }),
      );
    else if (wet) sentences.push(nextWetWords(ctx, wet.day, words(wet.amount)));
  } else if (finite(total))
    sentences.push(
      day.key < dateKey(ctx.now, ctx.timeZone)
        ? say(told.over, { amount: words(total) })
        : say(told.later, { weekday, amount: words(total) }),
    );
  return `<div class="detail-reading"><span class="detail-time"></span><div class="detail-headline">${headline}</div><div class="detail-sub">${finite(total) ? say('Total for the day') : ''}</div></div>
    ${charts}${chanceNote(ctx, day)}${totals(ctx, day, daily)}
    ${sentences.length ? sheetSection(say('Daily Summary'), `<p>${sentences.join(' ')}</p>`) : ''}${aboutMarkup(INTENSITY_ABOUT)}`;
}
export const INTENSITY_ABOUT = [
  phrase('About Precipitation Intensity'),
  phrase(
    'Intensity is worked out from how much rain or snow falls in an hour, to give a sense of how heavy it will feel, and sleet and wintry mix are rated the same way. A downpour or a snowstorm rates heavy, ordinary rain moderate, and drizzle light.',
  ),
] as const;
export const precipitationSheet = (view: SheetView): string =>
  view.day
    ? `${dayHead(view, glyphs.precipitation)}${precipitationBody(view.ctx, view.day, view.history === undefined && view.canAsk, view.days)}`
    : '';
