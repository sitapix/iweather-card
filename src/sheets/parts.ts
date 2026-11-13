import { say } from '../weather/words.ts';
// What sheets are made of: their heading and close button, their notes and rows of readings.
// A section of a sheet: a heading, if it has one, over what it holds. From the foot of the screen
// what it holds stands in a panel of its own; elsewhere the panel is no box at all (see the
// styles). `kind` is its class beside the usual one; `under` stands under the heading, outside
// the panel; a `plain` section has no panel; and `pending` holds its place unseen.
export interface SectionLook {
  kind?: string;
  summary?: boolean;
  titleClass?: string;
  under?: string;
  plain?: boolean;
  pending?: boolean;
}
export const sheetPanel = (body: string): string => `<div class="detail-panel">${body}</div>`;
export function sheetSection(title: string, body: string, look: SectionLook = {}): string {
  const { kind, summary = false, titleClass, under = '', plain = false, pending = false } = look,
    classes = [summary ? 'detail-summary' : 'detail-compare', kind].filter(Boolean).join(' ');
  return `<section class="${classes}"${pending ? ' data-pending' : ''}>${title ? `<h3${titleClass ? ` class="${titleClass}"` : ''}>${title}</h3>` : ''}${under}${plain ? body : sheetPanel(body)}</section>`;
}
// A note's words, each in a table of its card and said as it is drawn.
export type About = readonly [title: string, text: string];
export const aboutMarkup = (about: About | undefined): string =>
  about ? sheetSection(say(about[0]), `<p>${say(about[1])}</p>`, { kind: 'detail-about' }) : '';
// A paragraph's last two words stay together, so that no line of one word is left over at its end.
// The tags inside these paragraphs have no attributes, so a space is always between words.
export const keepLastWords = (markup: string): string =>
  markup.replace(/<p>(.*?)<\/p>/gs, (_, text: string) => `<p>${text.replace(/ (?=[^ ]*$)/, '&nbsp;')}</p>`);
export const closeButton = (): string =>
  `<button type="button" data-close aria-label="${say('Close')}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7-7 7"/></svg></button>`;
// Tabs in a capsule, a thumb behind the one chosen (see carryOver, which slides it).
export const segmented = (label: string, tabs: readonly (readonly [value: string, name: string])[], chosen: string) =>
  `<div class="segmented" role="group" aria-label="${label}"><i class="thumb" style="--at:${tabs.findIndex(([value]) => value === chosen)}"></i>${tabs
    .map(
      ([value, name]) =>
        `<button type="button" data-variant="${value}" aria-pressed="${value === chosen}">${name}</button>`,
    )
    .join('')}</div>`;
export const sheetHeader = (glyph: string, title: string): string =>
  `<header><span class="detail-glyph">${glyph}</span><h2>${title}</h2>${closeButton()}</header>`;
export const rows = (list: readonly (readonly [label: string, value: string])[]) =>
  `<dl class="sheet-rows sun-rows">${list
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('')}</dl>`;
