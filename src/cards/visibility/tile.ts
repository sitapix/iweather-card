import type { TileContext } from '../shared/context.ts';
import { finite } from '../../lib/values.ts';
import { header } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { smallValueDigits } from '../../lib/formats.ts';
import { esc } from '../../lib/html.ts';
import { visibilityText } from './rules.ts';
import { say } from '../../weather/words.ts';
export function visibilityTile(ctx: TileContext): string | null {
  const { visibility: value, visibility_unit: unit } = ctx.attrs;
  if (!finite(value)) return null;
  return `${header(glyphs.visibility, say('Visibility'))}<div class="big">${ctx.fmt(value, smallValueDigits(value))} ${esc(unit ?? '')}</div><p>${visibilityText(value, unit, ctx.condition)}</p>`;
}
