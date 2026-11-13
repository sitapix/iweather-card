import { REFERENCE_YEAR } from '../../sheets/time.ts';
import { type ChartContext, chartMarkup, W, H, tickDigits, type ChartLook, valueGradient } from '../../sheets/chart.ts';
import { smoothPath } from '../../sheets/curve.ts';
import { type ChartMark, pointsAttribute, timeSelector } from '../../sheets/chart-scrub.ts';
import type { TileContext } from '../shared/context.ts';
import { type PlotPoint, withEarlier, historyPoints, detailSeries, attributeSeries } from '../../sheets/series.ts';
import { type DayBand, monthOf, type Climate, RAIN_DAYS, type RecentRain, normalFor, monthDay } from './climate.ts';
import { dateFormat } from '../../lib/formats.ts';
import { finite } from '../../lib/values.ts';
import { dateKey } from '../../weather/forecast-items.ts';
import {
  rangeStyles,
  temperatureColor,
  temperatureGradient,
  temperatureRange,
} from '../../weather/temperature-colors.ts';
import { precipitationAmount } from '../../weather/precipitation.ts';
import { averageToday, averageRain } from './rules.ts';
import { percent, esc, PERCENT } from '../../lib/html.ts';
import { DAY } from '../../lib/time.ts';
import { UNITS } from '../../weather/units.ts';
import { type ChartScale, ceilTo, niceScale, steppedScale } from '../../sheets/scale.ts';
import { dayAxis } from '../../sheets/days.ts';
import { KIND_COLORS } from '../precipitation/totals.ts';
import type { SheetView } from '../card.ts';
import { segmented, sheetHeader, sheetSection } from '../../sheets/parts.ts';
import { glyphs } from '../shared/glyphs.ts';
import { say, sayCount } from '../../weather/words.ts';
// The averages sheet, on its Temperature or Precipitation tab. Temperature: today's high against
// the date's average high, the date's normal range, and each month's average low and high.
// Precipitation: the last 30 days' total against what usually falls over the same days, building
// up day by day, and each month's average total. Months are named by their middle, in a year of
// their own; a dry year's bars stand on a hundredth.
const MID_MONTH = 15;
const midMonth = (month: number) => Date.UTC(REFERENCE_YEAR, month, MID_MONTH);
const RAIN_FLOOR = 0.01;
// The scale steps by 3° in Celsius and 5° otherwise, reaches two steps past the highest of today's
// line and the normal band, and ends a step above its highest label.
const AVERAGE_STEP = { celsius: 3, usual: 5 } as const;
export function averagesScale(values: readonly number[], unit: string | undefined) {
  const step = unit === UNITS.celsius ? AVERAGE_STEP.celsius : AVERAGE_STEP.usual,
    top = ceilTo(Math.max(...values) + 2 * step, step);
  return steppedScale(ceilTo(Math.min(...values) - step, step), top, step, top - step);
}
type AveragesContext = ChartContext &
  Pick<TileContext, 'daily' | 'now' | 'timeZone' | 'climate' | 'fmt' | 'locale' | 'attrs' | 'recentRain'>;
// Today's temperatures, earlier ones from history with the forecast's, and the normal range at each
// hour of the date (see dayBand): null without one, undefined while it loads.
export interface AveragesInputs {
  today: readonly PlotPoint[];
  band: DayBand | null | undefined;
}
// Today's temperatures drawn over the normal range at each hour, with today's high at the top left,
// all in one rounded frame. Each of the two runs through the temperature scale from its own lowest
// to its own highest, laid over the whole height of the chart's scale, so a mild day keeps a short
// stretch of the colours, and the line and the band differ where they cross.
const BAND_STRENGTH = 0.5,
  SHADE_EVERY = 2;
const spread =
  (values: readonly number[], { min, max }: ChartScale) =>
  (value: number, { attrs }: ChartContext) => {
    const low = Math.min(...values);
    return temperatureColor(low + ((Math.max(...values) - low) * (value - min)) / (max - min), attrs.temperature_unit);
  };
const averageLook = (line: readonly number[], band: readonly number[]): ChartLook => ({
  id: 'average',
  tall: true,
  flush: true,
  framed: true,
  lifted: true,
  ranged: true,
  whole: true,
  highest: true,
  shade: chart => ({
    defs: `${valueGradient(chart, 'fill', spread(band.length ? band : line, chart.scale), SHADE_EVERY, BAND_STRENGTH)}${valueGradient(chart, 'line', spread(line, chart.scale), SHADE_EVERY)}`,
    stroke: `url(#line-${chart.uid})`,
  }),
  tickSuffix: () => '°',
  peak: (highest, ctx) => `<span class="chart-peak">${say('Today’s High')}<b>${ctx.fmt(highest)}°</b></span>`,
  reads: ({ ctx, value }) => `${ctx.fmt(value)}°`,
  notes: ({ ctx, range }) =>
    range ? say('Normal range: {low}° to {high}°', { low: ctx.fmt(range[0]), high: ctx.fmt(range[1]) }) : '',
});
// A legend's dot shows a reading's colours, hottest at the top.
const hotToCold = (values: readonly number[], unit: string | undefined) =>
  `background:linear-gradient(in oklab,${temperatureGradient(Math.max(...values), Math.min(...values), unit)})`;
const monthName = (ctx: Pick<TileContext, 'locale'>, month: number, width: 'short' | 'long') =>
  dateFormat(ctx.locale, { month: width, timeZone: 'UTC' }).format(midMonth(month));
const aboutSection = (title: string, text: string) => sheetSection(title, `<p>${text}</p>`, { kind: 'detail-about' });
// How far a reading stands from its average, each way a phrase of its own.
function fromAverage(difference: number, shown: (value: number) => string): string {
  const sign = difference > 0 ? '+' : difference < 0 ? '−' : '',
    value = `${sign}${shown(Math.abs(difference))}`;
  return difference > 0 ? say('{value} above average', { value }) : say('{value} from average', { value });
}
const NO_INPUTS: AveragesInputs = { today: [], band: null };
export function averagesDetail(ctx: AveragesContext, tab = 'temperature', inputs = NO_INPUTS): string {
  const climate = ctx.climate;
  if (!climate) return `<p class="detail-text">${say('Averages appear when the forecast has a high for today.')}</p>`;
  // Precipitation has a tab where the record has amounts.
  const rainy = climate.months.some(month => finite(month?.precipitation)),
    current = monthOf(dateKey(ctx.now, ctx.timeZone)) - 1;
  const tabs = rainy
    ? segmented(
        say('Averages'),
        [
          ['temperature', say('Temperature')],
          ['precipitation', say('Precipitation')],
        ],
        tab === 'precipitation' ? tab : 'temperature',
      )
    : '';
  return `${tabs}${rainy && tab === 'precipitation' ? rainAverages(ctx, climate, current) : temperatureAverages(ctx, climate, current, inputs)}`;
}
function temperatureAverages(
  ctx: AveragesContext,
  climate: Climate,
  current: number,
  { today, band }: AveragesInputs,
): string {
  const average = averageToday(ctx),
    deg = (value: number) => `${ctx.fmt(value)}°`,
    unit = ctx.attrs.temperature_unit,
    date = dateFormat(ctx.locale, { month: 'long', day: 'numeric', timeZone: ctx.timeZone }).format(ctx.now);
  // Each month's average low to high on one scale, colored as the 10-day list's ranges are.
  const months = climate.months,
    bars = temperatureRange(
      months.map(month => month ?? { low: null, high: null }),
      unit,
      undefined,
    );
  const rowsOf = months
    .map((month, i) => {
      const bar = bars[i];
      return month && bar
        ? `<div${i === current ? ' aria-current="true"' : ''}><span>${monthName(ctx, i, 'short')}</span><b class="low">${deg(month.low)}</b><span class="range-track"><span class="range-fill" style="${rangeStyles(bar).fill}"></span></span><b>${deg(month.high)}</b></div>`
        : '';
    })
    .join('');
  const thisMonth = months[current];
  const monthly = sheetSection(
    say('Monthly Averages'),
    `<p>${thisMonth ? say('For {month}, the average daily low is {low}, and the average daily high is {high}.', { month: monthName(ctx, current, 'long'), low: deg(thisMonth.low), high: deg(thisMonth.high) }) : ''}</p><div class="sheet-rows month-rows">${rowsOf}</div>`,
  );
  // The normal range: the band's lowest to highest through the day, or the date's own lows and
  // highs until it comes.
  const [from, to] = band ? [Math.min(...band.low), Math.max(...band.high)] : (average?.normal.span ?? [0, 0]);
  const line = today.map(point => point.value),
    range = band ? [...band.low, ...band.high] : [],
    scale = averagesScale([...line, ...range], unit);
  const chart = today.length
    ? `${chartMarkup(averageLook(line, range), today, scale, ctx, dayAxis(ctx.now, ctx.timeZone), [], 'detail-reading', band)}
    <p class="chart-legend"><span><i style="${hotToCold(line, unit)}"></i>${say('Today')}</span>${band ? `<span><i class="band" style="${hotToCold(range, unit)}"></i>${say('Normal Range ({low} to {high})', { low: deg(from), high: deg(to) })}</span>` : ''}</p>`
    : '';
  const head = average
    ? `<div class="detail-reading"><span class="detail-time"></span><div class="detail-headline named">${fromAverage(average.difference, deg)}</div><div class="detail-sub">${say('Average high: {value}', { value: deg(average.normal.high) })}</div></div>
    ${chart}${sheetSection(say('Summary'), `<p>${say('For {date}, the normal temperature range is {low} to {high}, and the average high is {average}.', { date, low: deg(from), high: deg(to), average: deg(average.normal.high) })} ${say('Today’s high temperature is {value}.', { value: deg(average.high) })}</p>`, { summary: true })}`
    : `<p class="detail-text">${say('Today’s average appears when the forecast has a high for today.')}</p>`;
  return `${head}${monthly}
    ${aboutSection(say('About the Normal Range'), say('The normal range shows the most common temperatures for {date} since {since}, about 80% of them: at each hour, from the lowest tenth of that hour’s temperatures, a week either side of the date, to the highest tenth. Where today’s line is below the range, it is among the coldest tenth for its time of day; where it is above, among the warmest.', { date, since: climate.since }))}
    ${aboutSection(say('About Average Temperatures'), say('The average high is the mean high temperature for {date}, taken over a week either side, in every year since {since}. Monthly averages are the mean daily lows and highs of each month in those years.', { date, since: climate.since }))}`;
}
function rainAverages(ctx: AveragesContext, climate: Climate, current: number): string {
  const unit = ctx.attrs.precipitation_unit,
    amount = (value: number) => esc(precipitationAmount(value, unit, ctx.numbers)),
    rain = averageRain(ctx),
    recent = ctx.recentRain,
    day = (date: string) =>
      dateFormat(ctx.locale, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(date));
  const first = recent?.dates[0],
    last = recent?.dates.at(-1);
  const head =
    rain && recent && first && last
      ? `<div class="detail-reading"><span class="detail-time"></span><div class="detail-headline named">${fromAverage(rain.difference, amount)}</div><div class="detail-sub">${say('{days}-day average: {amount}', { days: RAIN_DAYS, amount: amount(rain.normal) })}</div></div>
    ${rainChart(ctx, climate, recent)}
    ${sheetSection(say('Summary'), `<p>${say('Historically, the average total precipitation for {from} through {to} is {amount}.', { from: day(first), to: day(last), amount: amount(rain.normal) })} ${sayCount('Today, the total for the last {count} days is {amount}.', 'Today, the total for the last {count} days is {amount}.', recent.dates.length, { amount: amount(rain.total) })}</p>`, { summary: true })}`
      : '';
  const months = climate.months,
    most = Math.max(...months.map(month => month?.precipitation ?? 0), RAIN_FLOOR),
    thisMonth = months[current]?.precipitation;
  const rowsOf = months
    .map((month, i) =>
      finite(month?.precipitation)
        ? `<div${i === current ? ' aria-current="true"' : ''}><span>${monthName(ctx, i, 'short')}</span><span class="range-track"><span class="range-fill rain" style="width:${percent(month.precipitation / most)}"></span></span><b>${amount(month.precipitation)}</b></div>`
        : '',
    )
    .join('');
  const monthly = sheetSection(
    say('Monthly Averages'),
    `<p>${finite(thisMonth) ? say('For {month}, the average total precipitation is {amount}.', { month: monthName(ctx, current, 'long'), amount: amount(thisMonth) }) : ''}</p><div class="sheet-rows month-rows rain">${rowsOf}</div>`,
  );
  return `${head}${monthly}${aboutSection(say('About Average Precipitation'), say('Precipitation averages are based on precipitation since {since}. Snow counts as the water it would melt to, not its depth. Monthly averages are each month’s mean total over those years.', { since: climate.since }))}`;
}
// The last days' precipitation added up day by day (solid), against the average for the same
// days carried ten days past today (dashed), each total large at the top: the average's at the
// left, the last days' at today. The top of the plot is kept clear for those totals, so the scale
// starts below them. The rules fall ten days apart counting from today, and the last one ends the
// chart. Lines run straight between days; the average's dashes round off to 15 on and 5 off.
const DAYS_AFTER = 10,
  RULE_EVERY = 10,
  RAIN_PLOT = 275,
  RAIN_CLEAR = 75,
  RAIN_LINE = 5,
  PLACE_DIGITS = 3,
  AVERAGE_DASH = '10 10',
  USUAL_LINE = 'rgb(38 146 255/.25)';
function rainChart(ctx: AveragesContext, climate: Climate, recent: RecentRain): string {
  const unit = ctx.attrs.precipitation_unit,
    last = recent.dates.at(-1) ?? '',
    after = Array.from({ length: DAYS_AFTER }, (_, i) => dateKey(Date.parse(last) + (i + 1) * DAY, 'UTC')),
    usual = [...recent.dates, ...after].map(date => normalFor(climate, monthDay(date))?.rain ?? 0);
  const build = (amounts: readonly number[]) =>
    amounts.reduce<number[]>(
      (sums, value) => {
        sums.push((sums.at(-1) ?? 0) + value);
        return sums;
      },
      [0],
    );
  const actual = build(recent.amounts),
    normal = build(usual),
    days = recent.dates.length,
    span = days + DAYS_AFTER,
    scale = niceScale([...actual, ...normal]);
  const clear = RAIN_CLEAR / RAIN_PLOT,
    down = (value: number) => clear + (1 - clear) * (1 - (value - scale.min) / (scale.max - scale.min)),
    x = (i: number) => (i / span) * W,
    y = (value: number) => H * down(value),
    line = (sums: readonly number[]) =>
      smoothPath(
        sums.map((value, i) => [x(i), y(value)]),
        'straight',
      ),
    top = (value: number) => (down(value) * PERCENT).toFixed(1);
  const today = percent(days / span),
    end = actual.at(-1) ?? 0,
    usualNow = normal[days] ?? 0,
    plain = (value: number) => esc(precipitationAmount(value, unit, ctx.numbers)),
    amount = (value: number) => plain(value).replace(/ (\S+)$/, ' <small>$1</small>');
  // Read, a day shows the totals as it began, over the chart: the last days' with the average's
  // under it, and past today the average's alone.
  const start = Date.parse(recent.dates[0] ?? last),
    dayName = dateFormat(ctx.locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    marks = normal.map((usualThen, i): ChartMark => {
      const then = actual[i],
        when = i === days ? say('Today') : esc(dayName.format(start + i * DAY)),
        label =
          then === undefined
            ? `${when}\n${amount(usualThen)}\n${say('Average')}`
            : `${when}\n${amount(then)}\n${say('Average: {amount}', { amount: plain(usualThen) })}`;
      return [(i / span) * PERCENT, down(then ?? usualThen) * PERCENT, label];
    });
  const rules = Array.from({ length: Math.ceil(days / RULE_EVERY) - 1 }, (_, i) => days - (i + 1) * RULE_EVERY)
    .map(place => `<i class="chart-hour" style="left:${percent(place / span)}"></i>`)
    .join('');
  const ticks = scale.ticks
    .map(
      (tick, i) =>
        `<span style="top:${top(tick)}%">${ctx.fmt(tick, tickDigits(scale.ticks[1] ?? 1))}${i ? '' : ` ${esc(unit ?? '')}`}</span>`,
    )
    .join('');
  return `<div class="chart rain-chart" data-size="tall" data-flush data-framed data-readout="detail-reading" data-points="${pointsAttribute(marks)}" style="--low-x:${today};--low-y:${down(end).toFixed(PLACE_DIGITS)};--high-x:${today};--high-y:${down(usualNow).toFixed(PLACE_DIGITS)}"><div class="chart-face">${rules}<i class="chart-hour" data-last style="left:100%"></i><div class="chart-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${scale.ticks.map(tick => `<path d="M0 ${y(tick).toFixed(1)}H${W}" class="grid"/>`).join('')}<path d="${line(normal)}" fill="none" stroke="${USUAL_LINE}" stroke-width="${RAIN_LINE}" stroke-dasharray="${AVERAGE_DASH}" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${line(actual)}" fill="none" stroke="${KIND_COLORS.rain}" stroke-width="${RAIN_LINE}" stroke-linecap="butt" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/></svg></div><div class="chart-x" aria-hidden="true"><span style="left:0">${sayCount('{count}d ago', '{count}d ago', days)}</span><span style="left:${today}">${say('Today')}</span></div></div><div class="chart-marks"><i class="chart-rule" style="left:${today}"></i><i class="chart-dot" style="left:${today};top:${top(end)}%"></i><i class="chart-dot usual" style="left:${today};top:${top(usualNow)}%"></i><b class="rain-total">${amount(usualNow)}</b><b class="rain-total" style="left:${today}">${amount(end)}</b></div>
    <div class="chart-y" aria-hidden="true">${ticks}</div>${timeSelector(0, marks.length - 1)}</div>
    <p class="chart-legend"><span><i class="rain"></i>${sayCount('Last {count} days', 'Last {count} days', days)}</span><span><i></i>${say('Average')}</span></p>`;
}
export const averagesSheet = ({ ctx, title, day, variant, history, dayBand }: SheetView): string =>
  `${sheetHeader(glyphs.averages, title)}${averagesDetail(ctx, variant, {
    today:
      day?.today === true
        ? withEarlier(
            historyPoints(attributeSeries('temperature'), history?.today, ctx.timeZone),
            detailSeries(attributeSeries('temperature'), day.entries, ctx.attrs, ctx.now, ctx.timeZone, true),
          )
        : [],
    band: dayBand,
  })}`;
