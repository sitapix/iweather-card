import type { DetailDay } from './days.ts';
// A sheet's charts page from day to day, one strip of pages a sheet's width each, from yesterday
// on: a page is a day's charts. What stays put between two charts stands in the strip too, held at
// its left edge (see the styles), so that it keeps its own height with no measuring.
export function chartPages(days: readonly DetailDay[], page: (day: DetailDay) => string, held = ''): string {
  const pages = days.map(
    (day, i) => `<div class="chart-page" data-day="${day.key}" style="--page:${i + 1}">${page(day)}</div>`,
  );
  return `<div class="chart-pages" style="--pages:${days.length}">${pages.join('')}${held ? `<div class="chart-held"><div>${held}</div></div>` : ''}</div>`;
}
const stripIn = (parent: ParentNode): Element | undefined =>
  [...parent.children].find(child => child.matches('.chart-pages'));
export const stripOf = (sheet: HTMLElement): HTMLElement | null => sheet.querySelector(':scope > .chart-pages');
// Whether two strips show the same days.
const sameDays = (a: Element, b: Element) =>
  a.children.length === b.children.length &&
  a.firstElementChild?.getAttribute('data-day') === b.firstElementChild?.getAttribute('data-day');
// Draws a sheet again, its strip of pages left where it is: a slide under way carries on, and only
// the pages that changed are drawn. Says whether the strip stayed.
export function drawKeepingPages(sheet: HTMLElement, markup: string): boolean {
  const strip = stripOf(sheet),
    drawn = document.createElement('template');
  drawn.innerHTML = markup;
  const fresh = stripIn(drawn.content);
  if (!strip || !fresh || !sameDays(strip, fresh)) {
    sheet.replaceChildren(drawn.content);
    return false;
  }
  const pages = [...fresh.children],
    around = [...drawn.content.childNodes],
    place = around.indexOf(fresh);
  [...strip.children].forEach((page, i) => {
    const next = pages[i];
    if (next) next.toggleAttribute('inert', page.hasAttribute('inert'));
    if (next && !page.isEqualNode(next)) page.replaceWith(next);
  });
  while (strip.previousSibling) strip.previousSibling.remove();
  while (strip.nextSibling) strip.nextSibling.remove();
  strip.before(...around.slice(0, place));
  strip.after(...around.slice(place + 1));
  return true;
}
