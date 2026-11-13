import type { TileContext } from '../shared/context.ts';
import { airBand, airGlyphFor, airIsSignificant, airNow, airSentence, airShare } from './rules.ts';
import { esc } from '../../lib/html.ts';
import { header, scaleBar } from '../shared/tile.ts';
import { say } from '../../weather/words.ts';
import { AIR_SCALES } from './scales.ts';
// Air that matters leads with its band and needs no heading; otherwise the tile is headed as any
// other, with the reading large, or the band where the scale has no numbers.
export function airQualityTile(ctx: TileContext): string | null {
  const air = airNow(ctx);
  // On its way, the tile holds its room under its heading, so its coming moves nothing else.
  if (!air) return ctx.airAwaited ? header(airGlyphFor(Number.NaN), esc(say(AIR_SCALES.us.title))) : null;
  const { value, scale } = air,
    band = esc(say(airBand(scale, value).name)),
    shown = ctx.fmt(value),
    bar = scaleBar(scale.stops, airShare(scale, value)),
    text = esc(airSentence(scale, shown, value, air.yesterday));
  if (airIsSignificant(value, scale))
    return `<div class="air-headline">${scale.numeric ? `${shown} - ` : ''}${band}</div>${bar}<p>${text}</p>`;
  const reading = scale.numeric
    ? `<div class="big">${shown}</div><div class="sub">${band}</div>`
    : `<div class="big">${band}</div>`;
  return `${header(airGlyphFor(value, scale), esc(say(scale.title)))}${reading}${bar}<p>${text}</p>`;
}
