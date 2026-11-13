// The rows of the hourly strip and the daily list, one element each, in the view the hourly
// panel shows.
import { CONDITION, type EntityAttributes } from '../../card/home-assistant.ts';
import { child } from '../../lib/dom.ts';
import { dateFormat } from '../../lib/formats.ts';
import { esc, percent } from '../../lib/html.ts';
import type { SheetId } from '../ids.ts';
import type { TextKey, WeatherText } from '../../weather/i18n.ts';
import { iconDetails, PRECIPITATION_GLYPHS, weatherIcon } from '../../weather/icons.ts';
import { dateKey, dayAsHour, type DailyItem, type StripItem } from '../../weather/forecast-items.ts';
import { finite } from '../../lib/values.ts';
import {
  conditionPrecipitation,
  precipitationAmount,
  precipitationIntensity,
  precipitationSymbol,
  roundChance,
} from '../../weather/precipitation.ts';
import { rangeStyles, type RangeBar } from '../../weather/temperature-colors.ts';
import { windDirection } from '../../lib/compass.ts';
import { LINE_MIDDLE, WORDS, addedLightBoxes, addedWords } from '../shared/light.ts';
import { rainPlot, windPlot } from './day-chart.ts';
import { dayChance, type DayDetail, dayRain } from './day-detail.ts';

// The hourly panel's views.
export const MODES = ['conditions', 'rain', 'wind'] as const;
export type Mode = (typeof MODES)[number];
export const isMode = (value: unknown): value is Mode => MODES.some(mode => mode === value);
export const MODE_TEXT: Readonly<Record<Mode, TextKey>> = {
  conditions: 'conditions',
  rain: 'precipitation',
  wind: 'wind',
};
// What pressing the panel or a row opens: the sheet of the view showing.
export const MODE_SHEET: Readonly<Record<Mode, SheetId>> = {
  conditions: 'conditions',
  rain: 'precipitation',
  wind: 'wind',
};
// An hour with its day period set tight against it: 3PM.
export const tightPeriod = (time: string): string => time.replace(/\s+(?=[AP]\.?M\.?$)/i, '');

// What both are written with.
// What the rows read of the entity: the units, and the readings that refine the icon of the hour or
// day under way and today's row.
export type RowAttributes = Pick<
  EntityAttributes,
  | 'cloud_coverage'
  | 'precipitation'
  | 'temperature'
  | 'wind_speed'
  | 'visibility'
  | 'temperature_unit'
  | 'wind_speed_unit'
  | 'precipitation_unit'
  | 'visibility_unit'
>;
export const rowAttributes = ({
  cloud_coverage,
  precipitation,
  temperature,
  wind_speed,
  visibility,
  temperature_unit,
  wind_speed_unit,
  precipitation_unit,
  visibility_unit,
}: EntityAttributes): RowAttributes => ({
  ...(cloud_coverage === undefined ? {} : { cloud_coverage }),
  ...(precipitation === undefined ? {} : { precipitation }),
  ...(temperature === undefined ? {} : { temperature }),
  ...(wind_speed === undefined ? {} : { wind_speed }),
  ...(visibility === undefined ? {} : { visibility }),
  ...(temperature_unit === undefined ? {} : { temperature_unit }),
  ...(wind_speed_unit === undefined ? {} : { wind_speed_unit }),
  ...(precipitation_unit === undefined ? {} : { precipitation_unit }),
  ...(visibility_unit === undefined ? {} : { visibility_unit }),
});
interface Rows {
  mode: Mode;
  t: WeatherText;
  locale: string | undefined;
  // The locale numbers are written in (see numberLocale).
  numbers: string | undefined;
  timeZone: string | undefined;
  attrs: RowAttributes;
  fmt: (value: number | null | undefined, digits?: number) => string;
}
export interface DailyRows extends Rows {
  // A condition's name as the card shows it (see workOut).
  named: (condition: string | undefined) => string;
  // Where now comes along today's segments, in a view that shows it (see placeInDay).
  now: number | null;
}
export interface HourlyRows extends Rows {
  type: 'hourly' | 'daily' | 'twice_daily';
  // What the precipitation view reads: the chance, or the amount.
  rain: 'precipitation_probability' | 'precipitation';
  // The view's unit, and whether it is dark now.
  unit: string | undefined;
  night: boolean;
  hour12: boolean | undefined;
  named: (condition: string | undefined) => string;
}

// A row's quieter words add their light to the panel, as a title does, over the words that hold
// their place (see addedWords). `words` is plain text.
function addWords(node: HTMLElement, id: string, words: string, light: (typeof WORDS)[keyof typeof WORDS]) {
  const text = esc(words);
  node.classList.add('added');
  node.innerHTML = `${addedWords(id, 'words', `<text x="100%" y="50%" ${LINE_MIDDLE}>${text}</text>`, light)}<span>${text}</span>`;
}

// Bars for each stretch of the day, filled by how heavy it feels, with the amount and, if the list
// has them, the chance beside them. A day with no hours keeps its bars, empty, in their tint.
function fillRainDay(row: HTMLElement, day: DailyItem, info: DayDetail | undefined, label: string, rows: DailyRows) {
  const { t, numbers, fmt, now } = rows,
    rainUnit = rows.attrs.precipitation_unit,
    { total, chance, falling, drop } = dayRain(day, info),
    amount = precipitationAmount(total, rainUnit, numbers);
  row.dataset['precipitation'] = falling;
  row.innerHTML =
    '<span class="day-name"></span><span class="rain-segments" aria-hidden="true"></span><span class="day-amount"></span>';
  if (info)
    child(row, '.rain-segments').innerHTML = rainPlot(
      info.segments,
      info.segments.map(segment => precipitationIntensity(segment.amount, rainUnit, falling)),
      day.today ? now : null,
    );
  // The amount is as bright as the day is wet by its drop, so a 0″ beside a likely chance is too.
  const amountNode = child(row, '.day-amount');
  addWords(amountNode, `amount-${day.time}`, amount, drop ? WORDS.aside : WORDS.label);
  amountNode.dataset['zero'] = String(!drop);
  if (finite(chance)) {
    const chanceNode = document.createElement('span');
    chanceNode.className = 'day-rain-chance';
    if (drop) chanceNode.innerHTML = weatherIcon(PRECIPITATION_GLYPHS[falling]);
    chanceNode.append(`${fmt(roundChance(chance))}%`);
    row.append(chanceNode);
  }
  row.setAttribute(
    'aria-label',
    `${label}, ${t('precipitation')} ${amount}${finite(chance) ? `, ${t('chance_of_rain')} ${fmt(roundChance(chance))}%` : ''}`,
  );
}
// The wind through a day and its range over the day's hours, or with too few of them, the row's
// text alone, from the day's forecast.
function fillWindDay(row: HTMLElement, day: DailyItem, info: DayDetail | undefined, label: string, rows: DailyRows) {
  const { t, fmt, attrs, now } = rows,
    unit = attrs.wind_speed_unit,
    range = info?.range;
  row.innerHTML =
    '<span class="day-name"></span><span class="wind-spark" aria-hidden="true"></span><span class="day-wind"></span>';
  if (info && range)
    child(row, '.wind-spark').innerHTML = windPlot(day.time.toString(), info.segments, day.today ? now : null, unit);
  const speed = child(row, '.day-wind'),
    text = range ? `${fmt(range[0])} - ${fmt(range[1])}` : fmt(day.wind_speed);
  speed.textContent = text;
  if (unit) {
    const small = document.createElement('small');
    addWords(small, `unit-${day.time}`, unit, WORDS.label);
    speed.append(small);
  }
  row.setAttribute('aria-label', `${label}, ${t('wind')} ${text}${unit ? ` ${unit}` : ''}`);
}
function fillConditionsDay(
  row: HTMLElement,
  day: DailyItem,
  info: DayDetail | undefined,
  range: RangeBar | null | undefined,
  label: string,
  rows: DailyRows,
) {
  const { t, fmt, attrs, named } = rows;
  row.innerHTML =
    '<span class="day-name"></span><span class="day-icon"></span><span class="day-low"></span><span class="range-track"><span class="range-fill"></span><span class="range-current"></span></span><span class="day-high"></span>';
  child(row, '.day-icon').innerHTML = weatherIcon(
    day.sky.condition,
    day.sky.night,
    iconDetails(day.sky.hour ?? (day.today ? attrs : dayAsHour(day)), attrs),
  );
  // Whether a day shows its chance is for its condition to say: rain at 5% does, a cloudy 30% doesn't.
  const chance = dayChance(day, info);
  if (finite(chance) && conditionPrecipitation(day.sky.condition) !== undefined) {
    const small = document.createElement('small');
    small.className = 'day-chance';
    small.textContent = `${fmt(roundChance(chance))}%`;
    child(row, '.day-icon').append(small);
  }
  addWords(child(row, '.day-low'), `low-${day.time}`, finite(day.low) ? `${fmt(day.low)}°` : '—', WORDS.label);
  child(row, '.day-high').textContent = finite(day.high) ? `${fmt(day.high)}°` : '—';
  const fill = child(row, '.range-fill'),
    marker = child(row, '.range-current');
  child(row, '.range-track').hidden = !range;
  marker.hidden = !range || range.current === null;
  if (range) {
    const style = rangeStyles(range);
    fill.style.cssText = style.fill;
    if (style.dot) marker.style.cssText = style.dot;
  }
  row.setAttribute(
    'aria-label',
    `${label}, ${named(day.sky.condition)}, ${t('low')} ${fmt(day.low)}, ${t('high')} ${fmt(day.high)} ${attrs.temperature_unit ?? ''}${day.today && finite(attrs.temperature) ? `, ${t('current')} ${fmt(attrs.temperature)}` : ''}`,
  );
}
// What a press adds to a row: a light grey at 7%, all across it. The styles shape it by the row's
// place in the list, and it is drawn only while pressed.
const PRESSED = { rgb: [204, 204, 204], opacity: 0.07 } as const;
function pressLight(): string {
  const { lifts, marks } = addedLightBoxes([''], '<rect width="1" height="1"/>', PRESSED);
  return `<span class="day-press" aria-hidden="true">${lifts}<svg viewBox="0 0 1 1" preserveAspectRatio="none">${marks}</svg></span>`;
}
// A row of the daily list, with its hours (`info`) and its place on the shared range (`range`).
export function dayRow(
  day: DailyItem,
  info: DayDetail | undefined,
  range: RangeBar | null | undefined,
  rows: DailyRows,
) {
  const { mode, t, locale, timeZone } = rows,
    row = document.createElement('div');
  row.className = 'day';
  row.setAttribute('role', 'listitem');
  row.dataset['mode'] = mode;
  const label = day.today ? t.today : dateFormat(locale, { weekday: 'short', timeZone }).format(day.time);
  if (mode === 'rain') fillRainDay(row, day, info, label, rows);
  else if (mode === 'wind') fillWindDay(row, day, info, label, rows);
  else fillConditionsDay(row, day, info, range, label, rows);
  child(row, '.day-name').textContent = label;
  const key = dateKey(day.time, timeZone);
  row.dataset['key'] = key;
  row.tabIndex = 0;
  row.insertAdjacentHTML('beforeend', pressLight());
  return row;
}

// The hour's label: the hour at full size with a smaller day period, 3AM.
function fillHourLabel(entry: HTMLElement, item: StripItem, rows: HourlyRows) {
  const { type, t, locale, timeZone, hour12 } = rows,
    timeOptions: Intl.DateTimeFormatOptions =
      type === 'hourly'
        ? { hour: 'numeric', ...(item.sun ? { minute: '2-digit' } : {}), timeZone, hour12 }
        : { weekday: 'short', timeZone };
  const hourLabel = child(entry, '.hour-label');
  hourLabel.textContent = item.now
    ? t.now
    : tightPeriod(dateFormat(locale, timeOptions).format(item.time)) +
      (type === 'twice_daily' ? ` ${t(item.is_daytime === false ? 'night' : 'day')}` : '');
  if (item.now || type !== 'hourly') return;
  const parts = dateFormat(locale, timeOptions).formatToParts(item.time);
  if (parts.some(part => part.type === 'dayPeriod'))
    hourLabel.replaceChildren(
      ...parts
        .filter(part => part.type !== 'literal' || part.value === ':')
        .map(part => {
          if (part.type !== 'dayPeriod') return part.value;
          const period = document.createElement('span');
          period.className = 'period';
          period.textContent = part.value;
          return period;
        }),
    );
}
// Whether an hour is dark, which sets its symbol and its bar's tint: by the time it starts where
// the sun or the place tells that, as a forecast can name its clear hours once for all of them.
// Otherwise by what the forecast says, and now by the weather now.
export const hourNight = (item: StripItem, night: boolean): boolean =>
  item.night ?? (item.condition === CONDITION.clearNight || item.is_daytime === false || (Boolean(item.now) && night));
// An hour's precipitation as the strip shows it: what it brings, how full its bar is, and under
// the bar its chance, or failing that its amount, with nothing at all rather than a stand-in for
// a reading it hasn't got.
export function rainReading(item: StripItem, { rain, attrs, numbers, fmt }: HourlyRows) {
  const rainUnit = attrs.precipitation_unit,
    falling = precipitationSymbol(item),
    value = item[rain],
    chance = rain === 'precipitation_probability',
    shown = finite(value) && chance ? roundChance(value) : value,
    text = !finite(shown) ? '' : chance ? `${fmt(shown)}%` : precipitationAmount(shown, rainUnit, numbers);
  return {
    falling,
    share: precipitationIntensity(item.precipitation, rainUnit, falling),
    text,
    none: finite(shown) && shown <= 0,
  };
}
// Each hour by its own kind: its colours follow what falls, and its bar is as full as it feels
// heavy; a glyph of what falls goes beside any chance above none.
function fillRainHour(
  entry: HTMLElement,
  symbol: HTMLElement,
  valueNode: HTMLElement,
  { falling, share, text, none }: ReturnType<typeof rainReading>,
) {
  entry.dataset['precipitation'] = falling;
  symbol.innerHTML = '<span class="precip-bar" aria-hidden="true"><span></span></span>';
  child(symbol, '.precip-bar span').style.height = percent(share);
  valueNode.textContent = text;
  if (text && !none)
    valueNode.insertAdjacentHTML(
      'afterbegin',
      `<span class="falling">${weatherIcon(PRECIPITATION_GLYPHS[falling])}</span>`,
    );
  valueNode.dataset['zero'] = String(none);
}
// An entry of the hourly strip, an hour or a sunrise or sunset.
export function hourEntry(item: StripItem, rows: HourlyRows): HTMLElement {
  const { mode, rain, attrs, t, locale, timeZone, hour12, fmt, unit, named } = rows,
    entry = document.createElement('div');
  entry.className = 'hour';
  entry.setAttribute('role', 'listitem');
  entry.dataset['mode'] = mode;
  const night = hourNight(item, rows.night);
  entry.dataset['night'] = String(night);
  if (item.sun) entry.dataset['sun'] = item.sun;
  entry.innerHTML = '<span class="hour-label"></span><span class="hour-symbol"></span><span class="hour-value"></span>';
  fillHourLabel(entry, item, rows);
  const symbol = child(entry, '.hour-symbol'),
    valueNode = child(entry, '.hour-value');
  const value = item.sun
    ? null
    : mode === 'conditions'
      ? item.temperature
      : mode === 'wind'
        ? item.wind_speed
        : item[rain];
  if (item.sun) {
    symbol.innerHTML = weatherIcon(item.sun);
    valueNode.textContent = t(item.sun);
  } else if (mode === 'rain') fillRainHour(entry, symbol, valueNode, rainReading(item, rows));
  else if (mode === 'wind') {
    symbol.innerHTML = '<span class="wind-value"><b></b><small></small></span>';
    child(symbol, 'b').textContent = fmt(value);
    child(symbol, 'small').textContent = finite(value) ? (attrs.wind_speed_unit ?? '') : '';
  } else {
    // Refined by the hour's own numbers (cloud, rain rate, temperature, wind); now by the current reading.
    symbol.innerHTML = weatherIcon(item.condition, night, iconDetails(item.now ? attrs : item, attrs));
    // Under the symbol, the hour's chance of rain, as the daily list shows it: whether it shows is
    // for its condition to say, and a chance it hasn't got is left out.
    if (finite(item.precipitation_probability) && conditionPrecipitation(item.condition) !== undefined)
      symbol.insertAdjacentHTML(
        'beforeend',
        `<small class="hour-chance">${fmt(roundChance(item.precipitation_probability))}%</small>`,
      );
    valueNode.textContent = finite(value) ? `${fmt(value)}°` : '—';
  }
  const bearing = mode === 'wind' ? windDirection(item.wind_bearing, t.compass) : '';
  const fullTime = item.now
    ? t.now
    : dateFormat(locale, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: item.sun ? '2-digit' : undefined,
        timeZone,
        hour12,
        timeZoneName: 'short',
      }).format(item.time);
  entry.setAttribute(
    'aria-label',
    item.sun
      ? `${fullTime}, ${t(item.sun)}`
      : `${fullTime}, ${mode === 'conditions' ? `${named(item.condition)}, ` : ''}${finite(value) ? `${fmt(value, 2)} ${unit ?? ''}` : '—'}${bearing ? `, ${bearing}` : ''}`,
  );
  return entry;
}
