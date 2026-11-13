import { clamp, finite } from '../../lib/values.ts';
import { esc, percent } from '../../lib/html.ts';
import type { ClockContext, TileContext } from './context.ts';
import { LINE_MIDDLE, WORDS, addedLight, addedWords } from './light.ts';
import { clockFormat } from '../../lib/formats.ts';
export const header = (glyph: string, title: string) => `<header>${glyph}<span>${esc(title)}</span></header>`;
// A title starts 30 px into its header, past its symbol, which stands in the middle of a 30 by
// 13.5 px box in the header's 16.25 px row.
const TITLE_X = 30,
  SYMBOL_AT = 'translate(15 8.125) scale(.84375) translate(-8 -8)',
  SYMBOL_ATTRIBUTES = ['d', 'cx', 'cy', 'r'];
// A symbol's shapes, each placed in the header by itself, for a clip holds bare shapes and no groups,
// gathered by the opacity each is drawn at.
export function symbolShapes(symbol: Element | null | undefined): Map<number, string> {
  const kinds = new Map<number, string>();
  for (const shape of symbol?.querySelectorAll('path,circle') ?? []) {
    const held = SYMBOL_ATTRIBUTES.flatMap(name => {
        const value = shape.getAttribute(name);
        return value === null ? [] : [`${name}="${value}"`];
      }),
      opacity = Number(shape.getAttribute('opacity') ?? 1),
      strength = finite(opacity) ? opacity : 1;
    kinds.set(strength, `${kinds.get(strength) ?? ''}<${shape.localName} transform="${SYMBOL_AT}" ${held.join(' ')}/>`);
  }
  return kinds;
}
// A tile's title and its symbol add their light to the glass (see WORDS), under the words and the
// symbol the header holds for their place. Parts of the symbol drawn fainter are marks of their own,
// with a lift of their own, as under the title's they would be brightened as much as it is. The lifts
// stay out of the header, which a scrolling page fades: a lift can't see through anything fading
// above it, so the lifts fade with it instead (see PageScroll.animate).
export function lightTitle(content: Element, id: string) {
  const words = content.querySelector(':scope > header > span');
  if (!words?.textContent) return;
  const kinds = symbolShapes(content.querySelector(':scope > header > svg')),
    shapes = `${kinds.get(1) ?? ''}<text x="${TITLE_X}" y="50%">${esc(words.textContent)}</text>`,
    fainter = [...kinds].filter(([strength]) => strength !== 1),
    { lifts, marks } = addedLight(id, [
      { name: 'title', shapes, ...WORDS.label },
      ...fainter.map(([strength, faint], i) => ({
        name: `title-${i}`,
        shapes: faint,
        rgb: WORDS.label.rgb,
        opacity: WORDS.label.opacity * strength,
      })),
    ]);
  words.insertAdjacentHTML('afterend', `<svg class="title" aria-hidden="true">${marks}</svg>`);
  content.insertAdjacentHTML('afterbegin', lifts);
}
// A wide tile's rows of readings, shown beside its dial or picture only in the wide layout. The
// readings add their light, each centred on its row, and read their small parts as small.
export function factList(id: string, facts: readonly (readonly [label: string, value: string])[]): string {
  const readings = facts
    .map(([, value], row) => {
      const words = value.replaceAll('<small>', '<tspan class="small">').replaceAll('</small>', '</tspan>');
      return `<text x="100%" y="${percent((row + 1 / 2) / facts.length)}" ${LINE_MIDDLE}>${words}</text>`;
    })
    .join('');
  return `<dl class="facts added">${addedWords(id, 'readings', readings, WORDS.reading)}${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}
// A scale: its colours, and the reading's place along it (0–1), to three places.
const SCALE_DIGITS = 3;
export const scaleBar = (stops: readonly string[], at: number): string =>
  `<span class="scale" style="--scale:linear-gradient(90deg,${stops.join(',')});--p:${clamp(at).toFixed(SCALE_DIGITS)}"><i></i></span>`;

// Clock times as the card sets them: 3PM, with a smaller day period.
export function clock(time: number, ctx: ClockContext, minutes = true): string {
  const parts = clockFormat(ctx, minutes).formatToParts(time);
  // Spaces go (3PM, 7:30); separators stay, a colon or, as in Finnish, a point (17.30).
  return parts
    .filter(part => part.type !== 'literal' || !/^\s+$/.test(part.value))
    .map(part => (part.type === 'dayPeriod' ? `<small>${esc(part.value)}</small>` : esc(part.value)))
    .join('');
}
export const degrees = (value: number, ctx: Pick<TileContext, 'fmt'>) => `${ctx.fmt(value)}°`;

// The wide layouts' rows repeat the tile's caption, so they are left out of the label.
const DECODED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
export const tileText = (html: string): string =>
  html
    // A drawing with a name (the pressure trend) reads as its name; the rest are silent.
    .replace(/<svg[^>]*\saria-label="([^"]*)"[\s\S]*?<\/svg>/g, ' $1 ')
    .replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<dl class="facts[^>]*>[\s\S]*?<\/dl>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity, name: string) => DECODED[name] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
