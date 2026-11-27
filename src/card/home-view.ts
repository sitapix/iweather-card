import type { TileContext } from '../cards/shared/context.ts';
import type { HomeviewRow } from './config.ts';
import type { TileId } from '../cards/ids.ts';
import { airGlyphFor, airNow } from '../cards/air-quality/rules.ts';
import type { WeatherAlert } from '../cards/alerts/rules.ts';
import { alertTitle } from '../cards/alerts/sheet.ts';
import { type NextHour, POSSIBLE } from '../cards/next-hour/rules.ts';
import { glyphs } from '../cards/shared/glyphs.ts';
import { CONDITION } from './home-assistant.ts';
import { CHANNEL_MAX, rgb } from '../lib/canvas.ts';
import { clockFormat, dateFormat } from '../lib/formats.ts';
import { esc, percent } from '../lib/html.ts';
import { DAY, HOUR, MINUTES_PER_HOUR } from '../lib/time.ts';
import { finite } from '../lib/values.ts';
import { dateKey, dayAsHour, daysUntil } from '../weather/forecast-items.ts';
import { alertIcon, alertLevel, iconDetails, weatherIcon } from '../weather/icons.ts';
import { conditionPrecipitation, frozenPrecipitation, precipitationIntensity, wet } from '../weather/precipitation.ts';
import { say } from '../weather/words.ts';

// The home view: the weather now, to be read from across a room. Over the sky stand the condition
// with today's high and low, the time, and the temperature as large as the card allows; at its
// foot, four columns, which are the days ahead or the readings now. An alert that is more than
// minor takes the condition's place, under a warning sign, and the next hour takes the columns'
// while rain or snow falls or is due within it.
const COLUMNS = 4;
// A column of the foot, as markup: a day's name, symbol, high and low, or a reading's symbol,
// value and name.
export interface HomeColumn {
  key: string;
  html: string;
  // What it says, for a reader who can't see it.
  label: string;
  // The tile whose sheet a press opens; without one, a day, whose own sheet it opens.
  tile?: TileId;
}
export interface HomeView {
  // The time where the weather is, without its day period: 7:06.
  clock: string;
  // The weather's symbol, beside its name, or the warning sign beside an alert's.
  symbol: string;
  // The alerts' title, where one stands for the weather's name: "Winter Storm Watch".
  alert: string | undefined;
  // The row showing, and what a swipe turns it to, if there is anything to turn to.
  row: HomeviewRow;
  other: HomeviewRow | undefined;
  columns: readonly HomeColumn[];
  // The next hour, shown in the row's place while it lasts.
  next: HomeNext | undefined;
}
export interface HomeNext {
  html: string;
  label: string;
}

const column = (
  key: string,
  parts: readonly (readonly [name: string, html: string])[],
  label: string,
  tile?: TileId,
): HomeColumn => ({
  key,
  ...(tile ? { tile } : {}),
  html: parts.map(([name, html]) => `<span class="home-${name}">${html}</span>`).join(''),
  label,
});

// The days after today, each under its weekday.
function days(ctx: TileContext): HomeColumn[] {
  const weekday = dateFormat(ctx.locale, { weekday: 'short', timeZone: ctx.timeZone }),
    long = dateFormat(ctx.locale, { weekday: 'long', timeZone: ctx.timeZone });
  return ctx.daily
    .filter(day => !day.today)
    .slice(0, COLUMNS)
    .map(day => {
      const high = finite(day.high) ? `${ctx.fmt(day.high)}°` : '—',
        low = finite(day.low) ? `${ctx.fmt(day.low)}°` : '—';
      return column(
        dateKey(day.time, ctx.timeZone),
        [
          ['name', esc(weekday.format(day.time))],
          ['symbol', weatherIcon(day.sky.condition, false, iconDetails(dayAsHour(day), ctx.attrs))],
          ['value', high],
          ['low', low],
        ],
        `${long.format(day.time)}: ${high}, ${low}`,
      );
    });
}

// How long until something falls: none of the wait left, whole hours within a day, else days. The
// hours say first, then the days after today, where a chance worth naming counts too.
function precipitationAhead(ctx: TileContext): { wait: string; snow: boolean } | undefined {
  const falling = conditionPrecipitation(ctx.condition);
  if (falling !== undefined || ctx.rainOutlook === 'now')
    return { wait: say('Now'), snow: frozenPrecipitation(falling) };
  const hour = ctx.hourly.find(entry => entry.time + HOUR > ctx.now && wet(entry));
  if (hour && hour.time - ctx.now < DAY) {
    const snow = frozenPrecipitation(conditionPrecipitation(hour.condition));
    if (hour.time <= ctx.now) return { wait: say('Now'), snow };
    return { wait: say('In {count}h', { count: Math.max(1, Math.trunc((hour.time - ctx.now) / HOUR)) }), snow };
  }
  const day = ctx.daily.find(
    each =>
      !each.today &&
      ((each.precipitation ?? 0) > 0 ||
        (each.precipitation_probability ?? 0) >= POSSIBLE ||
        conditionPrecipitation(each.condition) !== undefined),
  );
  return day
    ? {
        wait: say('In {count}d', { count: Math.max(1, daysUntil(day.time, ctx.now, ctx.timeZone)) }),
        snow: frozenPrecipitation(conditionPrecipitation(day.condition)),
      }
    : undefined;
}

// The readings now, in the order they are offered: the first four the weather has.
function details(ctx: TileContext): HomeColumn[] {
  const { attrs } = ctx,
    reading = (key: TileId, symbol: string, value: string, name: string) =>
      column(
        key,
        [
          ['symbol', symbol],
          ['value', esc(value)],
          ['label', esc(name)],
        ],
        `${name}: ${value}`,
        key,
      ),
    ahead = precipitationAhead(ctx),
    air = airNow(ctx),
    found: HomeColumn[] = [];
  if (ahead)
    found.push(
      reading(
        'precipitation',
        weatherIcon(ahead.snow ? CONDITION.snowy : CONDITION.rainy),
        ahead.wait,
        ahead.snow ? say('Snow') : say('Rain'),
      ),
    );
  if (finite(attrs.wind_speed))
    found.push(
      reading(
        'wind',
        glyphs.wind,
        [ctx.fmt(attrs.wind_speed), attrs.wind_speed_unit ?? ''].filter(Boolean).join(' '),
        say('Wind'),
      ),
    );
  if (finite(attrs.humidity))
    found.push(reading('humidity', glyphs.humidity, `${ctx.fmt(attrs.humidity)}%`, say('Humidity')));
  if (air) found.push(reading('air_quality', airGlyphFor(air.value, air.scale), ctx.fmt(air.value), say('AQI')));
  if (finite(attrs.uv_index)) found.push(reading('uv', glyphs.uv, ctx.fmt(attrs.uv_index), say('UV Index')));
  return found.slice(0, COLUMNS);
}

// The next hour: its title, then a bar for every two minutes from now, as tall as it falls hard, on
// a line with now at one end and an hour on at the other.
const BAR_MINUTES = 2;
function nextHourShown({ title, text, series, unit, felt }: NextHour): HomeNext {
  const bars = Array.from({ length: MINUTES_PER_HOUR / BAR_MINUTES }, (_, bar) => {
    const level = Math.min(
      1,
      Math.max(
        0,
        ...series
          .slice(bar * BAR_MINUTES, (bar + 1) * BAR_MINUTES)
          .map(value => (value === null ? 0 : precipitationIntensity(value, unit, felt))),
      ),
    );
    return level > 0 ? `<i style="height:${percent(level)}"></i>` : '<i></i>';
  }).join('');
  return {
    html: `<span class="home-next-title">${esc(title)}</span><span class="home-bars">${bars}</span><span class="home-axis"><span>${esc(say('Now'))}</span><span>${esc(say('{minutes}m', { minutes: MINUTES_PER_HOUR }))}</span></span>`,
    label: say('{title}. {text}', { title, text }),
  };
}

// The home view as one update has it. `chosen` is the row a swipe picked, and the settings' until
// one has; a row with nothing to show gives way to the other.
export function homeView(
  ctx: TileContext,
  night: boolean,
  chosen: HomeviewRow | undefined,
  alerts: readonly WeatherAlert[] = [],
  nextHour?: NextHour,
): HomeView {
  const alert = alerts.some(each => alertLevel(each.severity) !== 'green') ? alertTitle(alerts) : undefined,
    next = nextHour && nextHourShown(nextHour),
    rows = { days: days(ctx), details: details(ctx) },
    wanted = chosen ?? ctx.config.homeview_row,
    spare: HomeviewRow = wanted === 'days' ? 'details' : 'days',
    row = rows[wanted].length > 0 ? wanted : spare;
  return {
    clock: clockFormat(ctx)
      .formatToParts(ctx.now)
      .filter(part => part.type !== 'dayPeriod' && (part.type !== 'literal' || part.value.trim() !== ''))
      .map(part => part.value)
      .join(''),
    symbol:
      alert === undefined
        ? weatherIcon(ctx.condition, night, iconDetails(ctx.attrs, ctx.attrs))
        : alertIcon(alerts.map(each => each.severity)),
    alert,
    row,
    other: next === undefined && row === wanted && rows[spare].length > 0 ? spare : undefined,
    columns: rows[row],
    next,
  };
}

// The temperature takes the sky's own hue, lighter and fuller than the sky behind it, and the high
// and low a paler one: 70% and 92% light, or over a pale sky 12 points lighter than it and 8 more,
// short of white; with the sky's saturation raised by 1.6 and a tenth, 90% at most. A grey sky so
// gives grey figures, and a blue one blue.
const TINT = { light: 70, pale: 92, over: 12, paler: 8, lightest: 96, gain: 1.6, lift: 0.1, most: 0.9 } as const;
const SEXTANTS = 6,
  SEXTANT = 60,
  GREEN_AT = 2,
  BLUE_AT = 4,
  PERCENT = 100;
export function homeTints(sky: string): { tint: string; pale: string } {
  const [red, green, blue] = rgb(sky),
    [r, g, b] = [red / CHANNEL_MAX, green / CHANNEL_MAX, blue / CHANNEL_MAX],
    most = Math.max(r, g, b),
    spread = most - Math.min(r, g, b),
    light = most - spread / 2,
    sextant =
      spread === 0
        ? 0
        : most === r
          ? (((g - b) / spread) % SEXTANTS) + (g < b ? SEXTANTS : 0)
          : most === g
            ? (b - r) / spread + GREEN_AT
            : (r - g) / spread + BLUE_AT,
    saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * light - 1)),
    hue = Math.round(sextant * SEXTANT),
    full = Math.round(Math.min(TINT.most, saturation * TINT.gain + TINT.lift) * PERCENT),
    strong = Math.max(TINT.light, Math.round(light * PERCENT) + TINT.over),
    colour = (lightness: number) => `hsl(${hue} ${spread === 0 ? 0 : full}% ${Math.min(TINT.lightest, lightness)}%)`;
  return { tint: colour(strong), pale: colour(Math.max(TINT.pale, strong + TINT.paler)) };
}
