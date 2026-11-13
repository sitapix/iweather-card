import { DAY, HOUR } from '../../lib/time.ts';
import type { TileContext } from '../shared/context.ts';
import { finite } from '../../lib/values.ts';
import { esc } from '../../lib/html.ts';
import {
  precipitationAmount,
  roundChance,
  dominantPrecipitation,
  conditionPrecipitation,
  traceAmount,
} from '../../weather/precipitation.ts';
import { daysUntil } from '../../weather/forecast-items.ts';
import { POSSIBLE } from '../next-hour/rules.ts';
import { dayAmount, nextWetWords, wetDayName } from './totals.ts';
import { header } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { say, sayCount } from '../../weather/words.ts';
// The next wet day: one with some forecast, or a chance worth naming; named by weekday within
// the week ahead, else by date.

export function precipitationTile(ctx: TileContext): string | null {
  const days = ctx.daily.filter(day => finite(day.precipitation) || finite(day.precipitation_probability)),
    [first] = days;
  if (!first) return null;
  const unit = ctx.attrs.precipitation_unit,
    amount = (value: number) => esc(precipitationAmount(value, unit, ctx.numbers));
  const today = first.today ? first : null,
    next = days.find(
      day => !day.today && ((day.precipitation ?? 0) > 0 || (day.precipitation_probability ?? 0) >= POSSIBLE),
    );
  // A precipitation sensor's own record comes first: "0.65″ in last 6h".
  const recent = ctx.recent,
    todayAmount = today && dayAmount(ctx, today, today);
  const big = recent
    ? (recent.partial ? '≥ ' : '') + amount(recent.amount)
    : finite(todayAmount)
      ? amount(todayAmount)
      : today && finite(today.precipitation_probability)
        ? `${ctx.fmt(roundChance(today.precipitation_probability))}%`
        : '—';
  // "Snow today" when today is mostly snow.
  const snowy = today && dominantPrecipitation(ctx.condition, today.condition) === 'snow';
  // The next 24 hours' total from the hourly forecast, named snow when most of its wet
  // hours are snowy, unless it's a trace, which says less than the day it leads to; else the next
  // wet day: tomorrow, a weekday, or a date past the week, snow by name; else none.
  const coming = ctx.hourly.filter(entry => entry.time + HOUR > ctx.now && entry.time < ctx.now + DAY),
    total = coming.reduce((sum, entry) => sum + (finite(entry.precipitation) ? entry.precipitation : 0), 0),
    wet = coming.filter(entry => (entry.precipitation ?? 0) > 0),
    snowing = wet.filter(entry => conditionPrecipitation(entry.condition) === 'snow').length > wet.length / 2;
  const nextSnow = next && conditionPrecipitation(next.condition) === 'snow',
    nextAmount = next && finite(next.precipitation) && next.precipitation > 0 ? amount(next.precipitation) : null,
    nextChance = next ? `${ctx.fmt(roundChance(next.precipitation_probability ?? 0))}%` : '',
    tomorrow = next && daysUntil(next.time, ctx.now, ctx.timeZone) === 1;
  const footer =
    total > 0 && !traceAmount(total, unit)
      ? snowing
        ? say('{amount} snow in next 24h.', { amount: amount(total) })
        : say('{amount} expected in next 24h.', { amount: amount(total) })
      : !next
        ? days.length > 2
          ? sayCount('None expected in next {count} day.', 'None expected in next {count} days.', days.length - 1)
          : days.length === 2
            ? say('None expected tomorrow.')
            : say('None expected today.')
        : nextAmount
          ? nextWetWords(ctx, next, nextAmount)
          : tomorrow
            ? nextSnow
              ? say('{chance} chance of snow tomorrow.', { chance: nextChance })
              : say('{chance} chance tomorrow.', { chance: nextChance })
            : nextSnow
              ? say('{chance} chance of snow {day}.', { chance: nextChance, day: esc(wetDayName(ctx, next.time)) })
              : say('Next expected is {chance} {day}.', { chance: nextChance, day: esc(wetDayName(ctx, next.time)) });
  return `${header(glyphs.precipitation, say('Precipitation'))}<div class="big">${big}</div><div class="sub">${recent ? say('in last {hours}h', { hours: recent.hours }) : snowy ? say('Snow today') : say('Today')}</div>
      <p>${footer}</p>`;
}
