import type { TileContext } from '../shared/context.ts';
import { degrees, header } from '../shared/tile.ts';
import { temperatureColor } from '../../weather/temperature-colors.ts';
import { esc } from '../../lib/html.ts';
import { feelsLike, fahrenheit, FEELS_APART } from './rules.ts';
import { finite } from '../../lib/values.ts';
import { glyphs } from '../shared/glyphs.ts';
import { LINE_MIDDLE, WORDS, addedWords } from '../shared/light.ts';
import { say } from '../../weather/words.ts';
// The feels-like tile, when the two are far enough apart, sets them side by side: the actual
// temperature named, then a white tick for it at one end of a faint groove, and the colours
// from it to the feels-like running toward the other end, further the further apart they are
// (all the way at 15 °F), swelling there into a pill that names the difference. A cooler
// feels-like runs left, a warmer one right; the pill's flare is drawn here, the rest in CSS.
const FEELS_SPAN = 15,
  FEELS_RATIO_DIGITS = 3,
  FEELS_FLARE =
    '<svg class="feels-flare" viewBox="0 0 14.0625 18.75" aria-hidden="true"><path d="M0 6.875C5.625 6.875 5.625 0 14.0625 0V18.75C5.625 18.75 5.625 11.875 0 11.875Z"/></svg>';
function feelsBar(feels: number, actual: number, apart: number, ctx: TileContext): string {
  const unit = ctx.attrs.temperature_unit,
    cooler = apart < 0,
    label = `${cooler ? '↓' : '↑'}${ctx.fmt(Math.abs(Math.round(feels) - Math.round(actual)))}°`,
    ratio = Math.min(1, Math.abs(apart) / FEELS_SPAN).toFixed(FEELS_RATIO_DIGITS);
  const reading = say('Actual: {temperature}', { temperature: degrees(actual, ctx) });
  return `<div class="feels-actual added">${addedWords(`${ctx.id}-feels`, 'actual', `<text y="50%" ${LINE_MIDDLE}>${reading}</text>`, WORDS.aside)}<span>${reading}</span></div><div class="feels-bar"${cooler ? '' : ' data-warmer'} style="--ratio:${ratio};--from:${temperatureColor(feels, unit)};--to:${temperatureColor(actual, unit)}" aria-hidden="true"><span class="feels-track"><span class="feels-fill"><b>${esc(label)}</b>${FEELS_FLARE}<i></i></span></span><i class="feels-tick"></i></div>`;
}

// Warmer reads hotter from a feels-like of 92 °F, cooler reads colder below 40 °F.
const FEELS = { hotter: 92, cooler: 40 } as const;

export function feelsLikeTile(ctx: TileContext): string | null {
  const result = feelsLike(ctx.attrs);
  if (!result) return null;
  // The same once both are rounded is "similar";
  // warmer turns "hotter" from a feels-like of 92 °F, cooler turns "colder" below 40 °F.
  const felt = fahrenheit(result.value, ctx.attrs.temperature_unit);
  const difference = Math.round(result.value) - Math.round(ctx.attrs.temperature ?? Number.NaN);
  // Without the actual temperature there is nothing to compare it with.
  const text = !finite(difference)
    ? ''
    : difference === 0
      ? say('Similar to the actual temperature.')
      : difference > 0
        ? felt >= FEELS.hotter
          ? say('It feels hotter than the actual temperature.')
          : say('It feels warmer than the actual temperature.')
        : felt >= FEELS.cooler
          ? say('Wind is making it feel cooler.')
          : say('Wind is making it feel colder.');
  const actual = ctx.attrs.temperature,
    apart = finite(actual) ? felt - fahrenheit(actual, ctx.attrs.temperature_unit) : 0;
  return `${header(glyphs.feels_like, say('Feels like'))}<div class="big">${degrees(result.value, ctx)}</div>${finite(actual) && Math.abs(apart) >= FEELS_APART ? feelsBar(result.value, actual, apart, ctx) : ''}<p>${text}${result.estimated ? `<small class="note">${say('Estimated from temperature, humidity and wind.')}</small>` : ''}</p>`;
}
