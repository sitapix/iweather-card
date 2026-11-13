import type { TileContext } from '../shared/context.ts';
import { finite } from '../../lib/values.ts';
import { header, scaleBar } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { uvLevel, UV, uvAdvice } from './rules.ts';
import { say } from '../../weather/words.ts';
export function uvTile(ctx: TileContext): string | null {
  const value = ctx.attrs.uv_index;
  if (!finite(value)) return null;
  return `${header(glyphs.uv, say('UV index'))}<div class="big">${ctx.fmt(value)}</div><div class="sub">${uvLevel(value)}</div>
      ${scaleBar(['#30d158', '#ffd600', '#ff9230', '#ff375f', '#db34f2'], value / UV.extreme)}<p>${uvAdvice(value, ctx.hourly, ctx.now, ctx.timeZone, ctx)}</p>`;
}
