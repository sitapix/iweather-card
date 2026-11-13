import { type PrecipitationKind, conditionPrecipitation, precipitationAmount } from '../../weather/precipitation.ts';
import { type DailyItem, type TimedEntry, dateKey, daysUntil, forecasts } from '../../weather/forecast-items.ts';
import { finite } from '../../lib/values.ts';
import type { TileContext } from '../shared/context.ts';
import type { ForecastEntry } from '../../card/home-assistant.ts';
import { HOUR, DAY } from '../../lib/time.ts';
import { esc } from '../../lib/html.ts';
import { dateFormat } from '../../lib/formats.ts';
import { sheetSection } from '../../sheets/parts.ts';
import type { DetailDay } from '../../sheets/days.ts';
import { dailyDetail, dayTotal } from '../forecast/day-detail.ts';
import { phrase, say } from '../../weather/words.ts';
// Precipitation by kind: its name and its colour in the totals and on a chart's bars, and the word a
// sentence uses.
export const KIND_NAMES: Readonly<Record<PrecipitationKind, string>> = {
  rain: phrase('Rain'),
  snow: phrase('Snow'),
  sleet: phrase('Sleet'),
  hail: phrase('Hail'),
  wintry_mix: phrase('Wintry Mix'),
};
export const KIND_COLORS: Readonly<Record<PrecipitationKind, string>> = {
  rain: '#3cd3fe',
  snow: '#fff',
  sleet: '#0091ff',
  hail: '#3cd3fe',
  wintry_mix: '#6d7cff',
};
// The kind that falls in most of the hours that bring any.
function mostlyFalls(entries: readonly TimedEntry[]): PrecipitationKind | undefined {
  const hours = new Map<PrecipitationKind, number>();
  for (const entry of entries) {
    const kind = conditionPrecipitation(entry.condition) ?? ((entry.precipitation ?? 0) > 0 ? 'rain' : undefined);
    if (kind) hours.set(kind, (hours.get(kind) ?? 0) + 1);
  }
  return [...hours].sort((a, b) => b[1] - a[1])[0]?.[0];
}
// A run of hours' precipitation: its amount and the kind most of it is.
export interface Fall {
  amount: number;
  kind: PrecipitationKind | undefined;
}
export const fallOf = (entries: readonly TimedEntry[]): Fall | null => {
  const amounts = entries.map(entry => entry.precipitation).filter(finite);
  return amounts.length ? { amount: amounts.reduce((sum, value) => sum + value, 0), kind: mostlyFalls(entries) } : null;
};
// A day's hours, those over up to its first in the forecast, and those.
export const hoursOf = (ctx: Pick<TileContext, 'pastHours' | 'timeZone'>, day: DetailDay): TimedEntry[] => [
  ...ctx.pastHours.filter(
    entry => dateKey(entry.time, ctx.timeZone) === day.key && entry.time < (day.entries[0]?.time ?? Infinity),
  ),
  ...day.entries,
];
// A listed day's total, as its row says it.
export const dayAmount = (
  ctx: Pick<TileContext, 'pastHours' | 'timeZone'> & { hourly: readonly ForecastEntry[] },
  day: Pick<DailyItem, 'time' | 'today'>,
  forecast: Pick<DailyItem, 'precipitation'>,
) =>
  dayTotal(
    forecast,
    dailyDetail([...ctx.pastHours, ...ctx.hourly], [day], ctx.timeZone).get(dateKey(day.time, ctx.timeZone)),
  );
// What fell over the last 24 hours: what a precipitation sensor recorded, which doesn't say what it
// was; or else the whole hours before the one under way, if the hours over go back that far.
export function lastDayFall(ctx: Pick<TileContext, 'lastDay' | 'pastHours' | 'now'>): Fall | null {
  if (finite(ctx.lastDay)) return { amount: ctx.lastDay, kind: undefined };
  const hours = ctx.pastHours.filter(entry => entry.time + HOUR > ctx.now - DAY);
  return (hours[0]?.time ?? Infinity) <= ctx.now + HOUR - DAY ? fallOf(hours) : null;
}
// What the next 24 hours bring, from the hour under way.
export const nextDay = (ctx: Pick<TileContext, 'now'> & { hourly: readonly ForecastEntry[] }) =>
  forecasts(ctx.hourly).filter(entry => entry.time + HOUR > ctx.now && entry.time < ctx.now + DAY);
// A day after today by name: within the week ahead by its short weekday ("Fri"), a later one by
// its date ("Nov 6").
const WEEK_AHEAD = 6.5 * DAY;
export const wetDayName = (ctx: Pick<TileContext, 'locale' | 'now' | 'timeZone'>, time: number) =>
  dateFormat(
    ctx.locale,
    time - ctx.now < WEEK_AHEAD
      ? { weekday: 'short', timeZone: ctx.timeZone }
      : { month: 'short', day: 'numeric', timeZone: ctx.timeZone },
  ).format(time);
// The first day after today with some precipitation, and its total as its row says it.
export function nextWetDay(
  ctx: Pick<TileContext, 'daily' | 'now' | 'pastHours' | 'timeZone'> & { hourly: readonly ForecastEntry[] },
): { day: DailyItem; amount: number } | undefined {
  for (const day of ctx.daily) {
    const amount = day.today || day.time < ctx.now ? undefined : dayAmount(ctx, day, day);
    if (finite(amount) && amount > 0) return { day, amount };
  }
  return undefined;
}
// A wet day's amount in a sentence: tomorrow's by that word, a later day's by its name, and snow by
// name.
export function nextWetWords(
  ctx: Pick<TileContext, 'locale' | 'now' | 'timeZone'>,
  day: Pick<DailyItem, 'time' | 'condition'>,
  amount: string,
): string {
  const snow = conditionPrecipitation(day.condition) === 'snow';
  if (daysUntil(day.time, ctx.now, ctx.timeZone) === 1)
    return snow ? say('{amount} snow tomorrow.', { amount }) : say('{amount} expected tomorrow.', { amount });
  const named = esc(wetDayName(ctx, day.time));
  return snow
    ? say('Next snow is {amount} {day}.', { amount, day: named })
    : say('Next expected is {amount} {day}.', { amount, day: named });
}
// The totals: by kind, each with a dot in its colour and its amount in it, under a heading for
// each span (Last 24 Hours, Next 24 Hours) when there are spans.
function totalsMarkup(
  title: string,
  groups: readonly (readonly [heading: string, fall: Fall])[],
  ctx: Pick<TileContext, 'attrs' | 'numbers'>,
): string {
  const unit = ctx.attrs.precipitation_unit,
    row = ({ amount, kind }: Fall) => {
      const color = amount > 0 ? KIND_COLORS[kind ?? 'rain'] : '';
      return `<dd><span>${color ? `<i style="background:${color}"></i>` : ''}${color && kind ? say(KIND_NAMES[kind]) : say('Precipitation')}</span><b${color ? ` style="color:${color}"` : ''}>${esc(precipitationAmount(amount, unit, ctx.numbers))}</b></dd>`;
    };
  return groups.length
    ? sheetSection(
        title,
        `<dl class="sheet-rows">${groups.map(([heading, fall]) => `<div>${heading ? `<dt>${heading}</dt>` : ''}${row(fall)}</div>`).join('')}</dl>`,
        { kind: 'detail-totals' },
      )
    : '';
}
// Today: the last 24 hours and the next 24; another day: its total.
export function totals(
  ctx: Pick<TileContext, 'attrs' | 'numbers' | 'now' | 'lastDay' | 'pastHours' | 'timeZone'> & {
    hourly: readonly ForecastEntry[];
  },
  day: DetailDay,
  daily: ForecastEntry | undefined,
): string {
  if (!day.today) {
    const fall = fallOf(hoursOf(ctx, day)),
      amount = (daily && dayAmount(ctx, day, daily)) ?? fall?.amount;
    return finite(amount)
      ? totalsMarkup(
          say('Precipitation Total'),
          [['', { amount, kind: fall?.kind ?? conditionPrecipitation(daily?.condition) }]],
          ctx,
        )
      : '';
  }
  const last = lastDayFall(ctx),
    next = fallOf(nextDay(ctx));
  return totalsMarkup(
    say('Precipitation Totals'),
    [
      ...(last ? [[say('Last 24 Hours'), last] as const] : []),
      ...(next ? [[say('Next 24 Hours'), next] as const] : []),
    ],
    ctx,
  );
}
