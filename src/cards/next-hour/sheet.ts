import { INTENSITY_LEVELS, precipitationIntensity } from '../../weather/precipitation.ts';
import { forecastSummary } from '../../weather/summary.ts';
import { hoursToTell } from '../../weather/forecast-items.ts';
import { type ChartContext, W, H } from '../../sheets/chart.ts';
import type { SummaryContext } from '../../sheets/reading.ts';
import { MINUTES_PER_HOUR, MINUTE } from '../../lib/time.ts';
import { clockOf } from '../../sheets/time.ts';
import { percent, esc, PERCENT } from '../../lib/html.ts';
import { pointsAttribute, timeSelector } from '../../sheets/chart-scrub.ts';
import { aboutMarkup, sheetHeader, sheetSection } from '../../sheets/parts.ts';
import { INTENSITY_ABOUT } from '../precipitation/sheet.ts';
import type { SheetCard } from '../card.ts';
import { glyphs } from '../shared/glyphs.ts';
import type { NextHour } from './rules.ts';
import { phrase, say } from '../../weather/words.ts';
// The next hour's precipitation, minute by minute: the panel's title over "Precipitation
// Intensity", a bar each minute as hard as it falls (light, moderate and heavy a third each),
// read like the day's charts, the time and how hard; then the forecast, the panel's sentence and
// how the rest of the day goes; and what intensity means.
const MINUTE_TICKS = 6,
  MINUTE_BAR = 0.6;
export function nextHourDetail(
  ctx: ChartContext & SummaryContext,
  next: NextHour,
  named: (condition: string) => string,
): string {
  const levels = INTENSITY_LEVELS.length,
    count = next.series.length || MINUTES_PER_HOUR,
    step = W / count,
    clock = clockOf(ctx),
    level = (value: number) => precipitationIntensity(value, next.unit, next.felt);
  const word = (value: number) =>
    value > 0 ? say(INTENSITY_LEVELS[Math.min(levels - 1, Math.floor(level(value) * levels))] ?? '') : say('None');
  const bars = next.series
    .map((value, i) => {
      if (value === null) return '';
      const height = level(value) * H;
      return height
        ? `<rect x="${(i * step + (step * (1 - MINUTE_BAR)) / 2).toFixed(2)}" y="${(H - height).toFixed(1)}" width="${(step * MINUTE_BAR).toFixed(2)}" height="${height.toFixed(1)}" rx="${((step * MINUTE_BAR) / 2).toFixed(2)}"/>`
        : '';
    })
    .join('');
  const grid = Array.from(
      { length: levels },
      (_, band) => `<path d="M0 ${((band * H) / levels).toFixed(1)}H${W}" class="grid"/>`,
    ).join(''),
    axis = Array.from(
      { length: MINUTE_TICKS },
      (_, tick) =>
        `<span style="left:${percent(tick / MINUTE_TICKS)}">${tick ? say('{minutes}m', { minutes: (tick * MINUTES_PER_HOUR) / MINUTE_TICKS }) : say('Now')}</span>`,
    ).join('');
  const marks = pointsAttribute(
    next.series.map((value, i) => [
      ((i + 1 / 2) / count) * PERCENT,
      (1 - level(value ?? 0)) * PERCENT,
      `${clock(ctx.now + i * MINUTE)}\n${value === null ? '—' : word(value)}\n`,
    ]),
  );
  // How the rest of today goes, as the hourly forecast's summary tells it: what falls and when,
  // or how the sky changes.
  const later = forecastSummary(hoursToTell(ctx.hourly, ctx.now), 'conditions', {
    text: condition => esc(named(condition)),
    clock: clockOf(ctx, false),
    timeZone: ctx.timeZone,
    unit: ctx.attrs.precipitation_unit,
  });
  const sentence = say('{sentence}.', { sentence: next.text });
  return `<div class="detail-reading"><span class="detail-time"></span><div class="detail-headline named">${esc(next.title)}</div><div class="detail-sub">${say('Precipitation Intensity')}</div></div>
    <div class="chart minute-chart" data-precipitation="${next.felt ?? 'rain'}" data-readout="detail-reading" data-points="${marks}"><div class="chart-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid}<g>${bars}</g></svg></div><div class="chart-x" aria-hidden="true">${axis}</div>${timeSelector(0, next.series.length - 1)}</div>
    ${sheetSection(say('Forecast'), `<p>${esc(sentence)}${later ? ` ${later}` : ''}</p>`, { summary: true })}${aboutMarkup(INTENSITY_ABOUT)}`;
}
export const nextHourCard: SheetCard = {
  id: 'next_hour',
  title: phrase('Next-Hour Precipitation'),
  sheet: ({ ctx, title, nextHour, named }) =>
    nextHour ? `${sheetHeader(glyphs.precipitation, title)}${nextHourDetail(ctx, nextHour, named)}` : '',
};
