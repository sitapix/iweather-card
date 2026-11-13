import type { TileContext } from '../shared/context.ts';
import { finite } from '../../lib/values.ts';
import { header, degrees } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { say } from '../../weather/words.ts';
export function humidityTile(ctx: TileContext): string | null {
  if (!finite(ctx.attrs.humidity)) return null;
  return `${header(glyphs.humidity, say('Humidity'))}<div class="big">${ctx.fmt(ctx.attrs.humidity)}%</div><p>${finite(ctx.attrs.dew_point) ? say('The dew point is {dew} right now.', { dew: degrees(ctx.attrs.dew_point, ctx) }) : ''}</p>`;
}
