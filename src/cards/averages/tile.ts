import type { TileContext } from '../shared/context.ts';
import { averageToday } from './rules.ts';
import { header, degrees } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { LINE_MIDDLE, WORDS, addedWords } from '../shared/light.ts';
import { say } from '../../weather/words.ts';
// The two rows at the foot, 15 px lines 2.5 px apart: their words add their light, the first's
// centre 7.5 px down and the second's 17.5 px on.
const ROWS = { first: 7.5, pitch: 17.5 } as const;
const rowLabels = (ctx: TileContext, labels: readonly string[]) =>
  addedWords(
    `${ctx.id}-averages`,
    'labels',
    labels.map((label, row) => `<text y="${ROWS.first + row * ROWS.pitch}" ${LINE_MIDDLE}>${label}</text>`).join(''),
    WORDS.label,
  );
export function averagesTile(ctx: TileContext): string | null {
  const average = averageToday(ctx);
  if (!average) return null;
  const sign = average.difference > 0 ? '+' : average.difference < 0 ? '−' : '',
    today = say('Today'),
    usual = say('Average');
  return `${header(glyphs.averages, say('Averages'))}<div class="big">${sign}${ctx.fmt(Math.abs(average.difference))}°</div><div class="sub">${average.label}</div>
      <p class="averages added">${rowLabels(ctx, [today, usual])}<span>${today}</span><b>${say('H:{value}', { value: degrees(average.high, ctx) })}</b><span>${usual}</span><b>${say('H:{value}', { value: degrees(average.normal.high, ctx) })}</b></p>`;
}
