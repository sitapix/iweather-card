import type { SheetView } from '../cards/card.ts';
import { dateFormat } from '../lib/formats.ts';
import { closeButton, type About, aboutMarkup, sheetSection } from './parts.ts';
import {
  detailSeries,
  lightSeries,
  earlierPoints,
  withEarlier,
  type ChartPoint,
  type Series,
  type Reach,
  range,
  reachOf,
} from './series.ts';
import type { ChartScale } from './scale.ts';
import { comparisonMarkup, type Compare, compareDays } from './compare.ts';
import { chartMarkup, type ChartLook } from './chart.ts';
import { dayAxis, type DetailDay } from './days.ts';
import { chartPages } from './pages.ts';
import { clockNow } from './time.ts';
import { dateKey } from '../weather/forecast-items.ts';
import type { TileContext } from '../cards/shared/context.ts';
import type { EntityAttributes, ForecastEntry } from '../card/home-assistant.ts';
import { phrase, say } from '../weather/words.ts';
// Title, day picker and date row, shared by the day-based sheets, and from the foot of the screen
// the menu that turns to another (see switcher.ts).
export function dayHead({ ctx, title, day, days, switcher = '' }: SheetView, glyph: string): string {
  const format = (options: Intl.DateTimeFormatOptions) => (time: number) =>
    dateFormat(ctx.locale, { ...options, timeZone: ctx.timeZone }).format(time);
  const date = format({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    weekday = format({ weekday: 'narrow' }),
    dayNumber = format({ day: 'numeric' }),
    index = day ? days.indexOf(day) : -1;
  return `<header><span class="detail-glyph">${glyph}</span><h2>${title}</h2>${closeButton()}</header>
      <div class="detail-days" role="group" aria-label="${say('Day')}">${days.map(item => `<button type="button" data-day="${item.key}" data-tense="${item.past ? 'past' : item.today ? 'today' : 'later'}" aria-pressed="${item === day}"${item.today ? ' aria-current="date"' : ''}><span>${weekday(item.time)}</span><b>${dayNumber(item.time)}</b></button>`).join('')}</div>
      ${day ? `<div class="detail-date"><button type="button" data-step="-1" aria-label="${say('Previous day')}"${index <= 0 ? ' disabled' : ''}><svg viewBox="0 0 7.5 13.75" aria-hidden="true"><path d="M6.9.55.9 6.875l6 6.325"/></svg></button><span>${date(day.time)}</span><button type="button" data-step="1" aria-label="${say('Next day')}"${index >= days.length - 1 ? ' disabled' : ''}><svg viewBox="0 0 7.5 13.75" aria-hidden="true"><path d="M.6.55l6 6.325-6 6.325"/></svg></button></div>${switcher}` : ''}`;
}
// What a sheet's summary reads: the entity, the hourly forecast, the locale and the
// reading three hours ago.
export type SummaryContext = Pick<TileContext, 'attrs' | 'fmt' | 'now' | 'timeZone' | 'locale' | 'numbers' | 'hour12'> &
  Partial<Pick<TileContext, 'earlier'>> & { hourly: readonly ForecastEntry[] };
export interface DetailSummary {
  headline: string;
  sub: string;
  text: string;
}
// Which of its three forms a sentence about a day takes: today, a day that is over, a day to come.
export type Tense = 'today' | 'over' | 'later';
// A day's readings, as a card's summary sentences read them.
export interface DayReadings {
  ctx: SummaryContext;
  today: boolean;
  // The forecast from now; the whole day, earlier today included; and that day's values.
  points: readonly ChartPoint[];
  day: readonly ChartPoint[];
  values: readonly number[];
  // How its sentences begin, "Today", "Yesterday" or "On Friday", and how they say "is" and "are"
  // of that day. A day that is over has its past tense; `tense` is which of the three a sentence
  // takes, and `weekday` the day's name for one that names it.
  over: boolean;
  tense: Tense;
  weekday: string;
  low: number;
  high: number;
  // The reading now, today.
  current: ChartPoint | null;
}
// What a reading's sheet asks of its card.
export interface ReadingSpec {
  glyph: string;
  about?: About;
  // A section of its own between its two notes.
  table?: (ctx: Pick<TileContext, 'attrs' | 'fmt'>) => string;
  alsoAbout?: About;
  series: Series;
  chart: ChartLook;
  // Its scale from the reach of its whole series, in the unit shown.
  scale: (reach: Reach, attrs: EntityAttributes) => ChartScale;
  summary: (readings: DayReadings) => DetailSummary;
  // How today compares with yesterday; a card without it has no comparison.
  compare?: Compare;
  // Its summary is headed by the time now, and on another day by the date.
  headedByNow?: boolean;
  // Today, a section of its own after the summary.
  todaySection?: (ctx: TileContext) => string;
}
// What a day without hours says: the forecast doesn't reach it, or it's yesterday, and its record
// is on its way or there is none.
const NO_HOURS = {
  values: {
    ahead: phrase('The forecast has no hourly values for this day.'),
    gone: phrase('Home Assistant has no record of yesterday’s values.'),
  },
  temperatures: {
    ahead: phrase('The forecast has no hourly temperatures for this day.'),
    gone: phrase('Home Assistant has no record of yesterday’s temperatures.'),
  },
} as const;
export const noHours = (day: DetailDay | undefined, asking: boolean, what: keyof typeof NO_HOURS = 'values') =>
  !day?.past ? say(NO_HOURS[what].ahead) : asking ? say('Looking up yesterday’s readings.') : say(NO_HOURS[what].gone);
// Headline, subtitle and summary sentences for the chosen day. They read the whole day, `past` (what
// is over of it) with the forecast from now.
export function summarize(
  summary: ReadingSpec['summary'],
  points: readonly ChartPoint[],
  ctx: SummaryContext,
  today: boolean,
  past: readonly ChartPoint[] = [],
  none = say(NO_HOURS.values.ahead),
): DetailSummary {
  const day = withEarlier(past, points),
    [first] = day;
  if (!first) return { headline: '—', sub: '', text: none };
  const over = !today && dateKey(first.time, ctx.timeZone) < dateKey(ctx.now, ctx.timeZone),
    values = day.map(point => point.value),
    [low, high] = range(values),
    current = today ? (points.find(point => point.now) ?? points[0] ?? first) : null,
    tense = today ? 'today' : over ? 'over' : 'later',
    weekday = dateFormat(ctx.locale, { weekday: 'long', timeZone: ctx.timeZone }).format(first.time);
  return summary({ ctx, today, points, day, values, over, tense, weekday, low, high, current });
}
// Yesterday's date.
export const dayBefore = ({ now, timeZone }: Pick<TileContext, 'now' | 'timeZone'>): string =>
  dateKey(dayAxis(now, timeZone).start - 1, timeZone);
// A reading's sheet, over the day: its headline, its chart, a summary and, for today, how it
// compares with yesterday.
export const readingSheet =
  ({
    glyph,
    about,
    table,
    alsoAbout,
    series,
    chart,
    scale: scaled,
    summary,
    compare,
    headedByNow,
    todaySection,
  }: ReadingSpec) =>
  (view: SheetView): string => {
    const { ctx, day, days, history, canAsk } = view;
    const today = Boolean(day?.today);
    const pointsOf = (item: DetailDay) =>
      detailSeries(series, item.entries, ctx.attrs, ctx.now, ctx.timeZone, item.today);
    const points = day ? pointsOf(day) : [];
    const past = day ? earlierPoints(series, day.key, ctx, history) : [];
    const none = noHours(day, history === undefined && canAsk),
      // A day with no hours reads what its daily forecast has: one value for the day, so its sentence
      // still says the hours are missing rather than telling of them.
      forecast =
        day?.daily && !points.length && !past.length
          ? detailSeries(series, [{ ...day.daily, time: day.time }], ctx.attrs, ctx.now, ctx.timeZone, false)
          : [],
      told = forecast.length
        ? { ...summarize(summary, forecast, ctx, false, [], none), text: none }
        : summarize(summary, points, ctx, today, past, none);
    // A day with nothing to chart keeps its frame while another day has something, and its summary
    // says why.
    const lit = lightSeries(ctx);
    const page = (item: DetailDay) => {
      const hours = pointsOf(item),
        earlier = earlierPoints(series, item.key, ctx, history),
        reach = view.reach ?? reachOf([...earlier, ...hours].map(point => point.value));
      return reach
        ? chartMarkup(
            chart,
            chart.weather ? lit(hours) : hours,
            scaled(reach, ctx.attrs),
            ctx,
            dayAxis(item.time, ctx.timeZone),
            chart.weather ? lit(earlier) : earlier,
            'detail-reading',
          )
        : '';
    };
    // While yesterday is loading, hold its place so what follows doesn't move when it comes.
    const loading = today && history === undefined && canAsk,
      yesterday = today && !loading ? earlierPoints(series, dayBefore(ctx), ctx, history) : [],
      compared = today ? compareDays(compare, withEarlier(past, points), yesterday, ctx) : null,
      pending = loading && !compared && Boolean(compare);
    // The headline gives way to the chart's reading while it is read (see chart-scrub). UV's summary
    // is headed by the time now, and on another day by the date.
    const heading = !headedByNow
      ? ''
      : today
        ? say('Now, {time}', { time: clockNow(ctx) })
        : day
          ? dateFormat(ctx.locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: ctx.timeZone }).format(
              day.time,
            )
          : '';
    return `${dayHead(view, glyph)}
      <div class="detail-reading"><span class="detail-time"></span><div class="detail-headline">${told.headline}</div><div class="detail-sub">${told.sub}</div></div>
      ${day && (view.reach || points.length || past.length) ? chartPages(days, page) : ''}
      ${sheetSection(heading || say('Daily Summary'), `<p>${told.text}</p>`, { summary: true, titleClass: heading ? 'detail-now' : '', plain: Boolean(heading) })}${today ? (todaySection?.(ctx) ?? '') : ''}
      ${compared || pending ? sheetSection(say('Daily Comparison'), comparisonMarkup(compared ?? { text: say('Comparing today with yesterday.'), today: 1, yesterday: 1, shown: ['', ''] }), { pending }) : ''}${aboutMarkup(about)}${table?.(ctx) ?? ''}${aboutMarkup(alsoAbout)}`;
  };
