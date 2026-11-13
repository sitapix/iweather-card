// Where the popover goes: below, above, left or right of what it opened from, on the first side
// where all of it fits; else the side with the most room, shortened to fit and scrolling inside;
// else a bottom sheet. `anchor` is the pressed element's viewport rect; 'gone' means it has
// scrolled off screen.
type Side = 'below' | 'above' | 'left' | 'right';
export type AnchorRect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
export interface PopoverRequest {
  anchor: AnchorRect | null | undefined;
  width: number;
  height: number;
  vw: number;
  vh: number;
  gap?: number;
  edge?: number;
  minimum?: number;
}
export interface Placement {
  side: Side | 'gone' | 'sheet';
  left: number;
  top: number;
  maxHeight: number;
  arrowX?: number;
  arrowY?: number;
}
const ORDER: readonly Side[] = ['below', 'above', 'left', 'right'];
// The sheet's arrow keeps 30px from its corners.
const ARROW_INSET = 30;
export function placePopover({
  anchor,
  width,
  height,
  vw,
  vh,
  gap = 13,
  edge = 12,
  minimum = 320,
}: PopoverRequest): Placement {
  if (!anchor || anchor.bottom < 0 || anchor.top > vh || anchor.right < 0 || anchor.left > vw)
    return {
      side: anchor ? 'gone' : 'sheet',
      left: (vw - width) / 2,
      top: Math.max(edge, vh - height - edge),
      maxHeight: vh - 2 * edge,
    };
  const space: Record<Side, number> = {
    right: vw - anchor.right - gap - edge,
    left: anchor.left - gap - edge,
    below: vh - anchor.bottom - gap - edge,
    above: anchor.top - gap - edge,
  };
  const tall = vh - 2 * edge,
    wide = vw - 2 * edge,
    vertical = (side: Side) => side === 'below' || side === 'above';
  const room = (side: Side) => (vertical(side) ? (width <= wide ? space[side] : 0) : space[side] >= width ? tall : 0);
  let side = ORDER.find(side =>
    vertical(side) ? width <= wide && space[side] >= height : space[side] >= width && height <= tall,
  );
  side ??= ORDER.filter(side => room(side) >= minimum).sort((a, b) => room(b) - room(a))[0];
  if (!side)
    return {
      side: 'sheet',
      left: (vw - width) / 2,
      top: Math.max(edge, vh - Math.min(height, tall) - edge),
      maxHeight: tall,
    };
  const maxHeight = Math.min(tall, room(side)),
    shown = Math.min(height, maxHeight),
    clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  if (vertical(side)) {
    const middle = anchor.left + anchor.width / 2,
      left = clamp(middle - width / 2, edge, vw - width - edge);
    return {
      side,
      left,
      top: side === 'below' ? anchor.bottom + gap : anchor.top - gap - shown,
      maxHeight,
      arrowX: clamp(middle - left, ARROW_INSET, width - ARROW_INSET),
    };
  }
  const middle = anchor.top + anchor.height / 2,
    top = clamp(middle - shown / 2, edge, vh - shown - edge);
  return {
    side,
    left: side === 'right' ? anchor.right + gap : anchor.left - gap - width,
    top,
    maxHeight,
    arrowY: clamp(middle - top, ARROW_INSET, shown - ARROW_INSET),
  };
}

// An element's box as it lies at rest: pressing shrinks a tile, or the list a row is in, about its
// middle (see press), and a sheet opens while that goes on. It shouldn't be placed by it, or move
// once the press has let go.
export function restingBox(element: Element): AnchorRect {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  for (let node: Element | null = element; node; node = node.parentElement) {
    const scale = new DOMMatrixReadOnly(getComputedStyle(node).transform).a;
    if (scale === 1 || scale === 0) continue;
    const box = node.getBoundingClientRect(),
      x = box.left + box.width / 2,
      y = box.top + box.height / 2;
    left = x + (left - x) / scale;
    right = x + (right - x) / scale;
    top = y + (top - y) / scale;
    bottom = y + (bottom - y) / scale;
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// A sheet's shape, in its own px: a rounded rectangle `width` by `height` with a tail toward what it
// opened from, `at` along that edge and kept clear of the corners. The tail is `depth` deep: straight
// flanks at 45° from a small curve at the base to a round tip. A sheet over the middle of the screen
// has none. The rectangle stands `depth` in from the path's origin on every side, so the box the
// glass is cut from holds the tail whichever way it points.
export const SHEET_TAIL = { depth: 13.75, radius: 25, tip: 5, fillet: 7.5 } as const;
// How much longer a 45° flank's corners run than their radius: the tangent of 22.5°.
const CORNER_REACH = Math.SQRT2 - 1;
const { depth, radius, tip, fillet } = SHEET_TAIL,
  // Where the flanks would meet, past the round tip; how far the base's curve starts from where
  // they'd reach the edge; and half the tail's width at the base.
  apex = depth + tip * CORNER_REACH,
  reach = fillet * CORNER_REACH,
  halfBase = apex + reach,
  // Where each flank leaves the base's curve and meets the tip's, along the edge and out from it.
  foot = [apex - reach / Math.SQRT2, reach / Math.SQRT2] as const,
  crown = [tip / Math.SQRT2, depth - tip + tip / Math.SQRT2] as const;
const xy = (x: number, y: number) => `${+x.toFixed(2)} ${+y.toFixed(2)}`;
// The tail, drawn going round the sheet clockwise, whichever edge it's on. `at` turns a place along
// the edge and out from it into the sheet's own.
const tail = (at: (along: number, out: number) => string) =>
  [
    `L${at(-halfBase, 0)}`,
    `A${fillet} ${fillet} 0 0 0 ${at(-foot[0], foot[1])}`,
    `L${at(-crown[0], crown[1])}`,
    `A${tip} ${tip} 0 0 1 ${at(crown[0], crown[1])}`,
    `L${at(foot[0], foot[1])}`,
    `A${fillet} ${fillet} 0 0 0 ${at(halfBase, 0)}`,
  ].join('');
export function sheetOutline(side: Side | 'sheet', width: number, height: number, at: number): string {
  const left = depth,
    top = depth,
    right = left + width,
    bottom = top + height,
    along = (length: number) => depth + Math.max(radius + halfBase, Math.min(length - radius - halfBase, at)),
    corner = (x: number, y: number) => `A${radius} ${radius} 0 0 1 ${xy(x, y)}`,
    x = along(width),
    y = along(height);
  return [
    `M${xy(left + radius, top)}`,
    side === 'below' ? tail((on, out) => xy(x + on, top - out)) : '',
    `L${xy(right - radius, top)}${corner(right, top + radius)}`,
    side === 'left' ? tail((on, out) => xy(right + out, y + on)) : '',
    `L${xy(right, bottom - radius)}${corner(right - radius, bottom)}`,
    side === 'above' ? tail((on, out) => xy(x - on, bottom + out)) : '',
    `L${xy(left + radius, bottom)}${corner(left, bottom - radius)}`,
    side === 'right' ? tail((on, out) => xy(left - out, y - on)) : '',
    `L${xy(left, top + radius)}${corner(left + radius, top)}Z`,
  ].join('');
}

// What is drawn round a sheet's shape, as one picture. Outside it, a shadow that is .18 at the
// edge, half its strength there, and gone 25 px out, and a fine dark line; inside it, a thin rim of
// light, brightest along the top, fainter along the foot, and faint down the sides. Glass can't
// carry these: the shape cuts off whatever lies outside it, and a filter would blind the glass.
const SHADOW = { strength: 0.36, blur: 12.5, reach: 40 } as const,
  LINE = { width: 1.25, strength: 0.87 } as const,
  RIM = { width: 2.5, top: 0.38, side: 0.12, foot: 0.27 } as const,
  STOP_DIGITS = 4;
export function sheetEdge(outline: string, width: number, height: number): string {
  const { reach: out, strength, blur } = SHADOW,
    wide = width + 2 * depth + 2 * out,
    tall = height + 2 * depth + 2 * out,
    bend = radius / height,
    stop = (offset: number, opacity: number) =>
      `<stop offset="${+offset.toFixed(STOP_DIGITS)}" stop-color="#fff" stop-opacity="${opacity}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-out} ${-out} ${wide} ${tall}"><defs><path id="p" d="${outline}"/><clipPath id="in"><use href="#p"/></clipPath><clipPath id="out"><path clip-rule="evenodd" d="M${-out} ${-out}h${wide}v${tall}h${-wide}Z${outline}"/></clipPath><filter id="soft" filterUnits="userSpaceOnUse" x="${-out}" y="${-out}" width="${wide}" height="${tall}"><feGaussianBlur stdDeviation="${blur}"/></filter><linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="0" y1="${depth}" x2="0" y2="${depth + height}">${stop(0, RIM.top)}${stop(bend, RIM.side)}${stop(1 - bend, RIM.side)}${stop(1, RIM.foot)}</linearGradient></defs><g clip-path="url(#out)"><use href="#p" fill-opacity="${strength}" filter="url(#soft)"/><use href="#p" fill="none" stroke="#000" stroke-opacity="${LINE.strength}" stroke-width="${LINE.width}"/></g><g clip-path="url(#in)"><use href="#p" fill="none" stroke="url(#rim)" stroke-width="${RIM.width}"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
