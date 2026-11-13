// One drawing fading into the next. What a box showed is held over it as a picture, a copy of the
// box set where it is, out of the pointer's way and hidden from assistive technology, while what it
// shows now is drawn under it. Each piece that changed fades, the old out over the first half and
// the new in over the second, so the two never show at once; a piece drawn the same in the same
// place stays as it is, so it neither dims nor doubles. Pieces fade on
// their own, never a box as a whole: a box fading as one would cut the lights in it off from the
// glass behind them (see light.ts) until it was done.
export interface Fade {
  readonly duration: number;
  readonly easing: string;
}
const pictures = new WeakMap<HTMLElement, HTMLElement>();
const FADE_ID = 'cross-fade';
// Drawn whole, and faded whole: a drawing, an image, a light.
const WHOLE = 'svg, img, canvas, .lift';
// A piece fades in from nothing to its own opacity, and out from its own to nothing: one its styles
// hold out of sight stays so.
const IN: Keyframe[] = [{ opacity: 0, offset: 0 }];
const OUT: Keyframe[] = [{ opacity: 0, offset: 1 }];
const WORDS_IN: Keyframe[] = [{ color: 'transparent', offset: 0 }];
const WORDS_OUT: Keyframe[] = [{ color: 'transparent', offset: 1 }];
let copies = 0;

const CLEAR = 'rgba(0, 0, 0, 0)';
const NO_CONTENT = new Set(['none', 'normal']);

const hasWords = (element: Element) =>
  [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
// Whether an element paints anything of its own: a background, a border, a shadow, or a ::before
// or ::after.
function paints(element: Element): boolean {
  const own = getComputedStyle(element);
  return (
    own.backgroundColor !== CLEAR ||
    own.backgroundImage !== 'none' ||
    own.boxShadow !== 'none' ||
    ['top', 'right', 'bottom', 'left'].some(
      side => Number.parseFloat(own.getPropertyValue(`border-${side}-width`)) > 0,
    ) ||
    ['::before', '::after'].some(pseudo => !NO_CONTENT.has(getComputedStyle(element, pseudo).content))
  );
}
// The pieces a box is drawn from, in order: what is drawn whole, and what has no light inside it
// and has words of its own, paints something itself or has nothing in it. Anything else is only the
// sum of its pieces, as fading it whole would cut the light inside it off from the glass, apart from
// what it paints itself, which can't fade (`held`), and its own words, which fade by their colour
// (`worded`).
interface Pieces {
  pieces: Element[];
  held: Element[];
  worded: Element[];
}
function piecesOf(box: Element): Pieces {
  const found: Pieces = { pieces: [], held: [], worded: [] };
  const visit = (element: Element) => {
    for (const child of element.children) {
      const lit = child.querySelector('.lift') !== null;
      if (child.matches(WHOLE) || (!lit && (child.childElementCount === 0 || hasWords(child) || paints(child))))
        found.pieces.push(child);
      else {
        if (paints(child)) found.held.push(child);
        if (hasWords(child)) found.worded.push(child);
        visit(child);
      }
    }
  };
  visit(box);
  return found;
}
// What the picture's held elements paint themselves goes, leaving the box's own under it: a row's
// rule drawn twice would show as one, brighter, until the picture went.
function unpaint(element: Element) {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
  Object.assign(element.style, { background: 'none', borderColor: 'transparent', boxShadow: 'none' });
}
// A piece as drawn: what it is and where it stands in its box, to the pixel. Words alone go by where
// they are drawn, not by their box, which a view can widen round them without moving them.
function looks(piece: Element, box: DOMRect): string {
  const words = piece.childElementCount === 0 && hasWords(piece) ? document.createRange() : null;
  words?.selectNodeContents(piece);
  const { left, top, width, height } = (words ?? piece).getBoundingClientRect();
  return `${[left - box.left, top - box.top, width, height].map(Math.round).join(',')} ${piece.outerHTML}`;
}

// A copy's ids, and whatever in it points at them, renamed: a copy's drawings would otherwise find
// the box's own, which is drawn again under it.
function ownIds(copy: HTMLElement) {
  const suffix = `-was${++copies}`,
    named = [...copy.querySelectorAll('[id]')].map(element => element.id);
  if (named.length === 0) return;
  for (const element of copy.querySelectorAll('[id]')) element.id += suffix;
  const pointing = new RegExp(`#(${named.map(id => id.replace(/[^\w-]/g, '\\$&')).join('|')})(?=[)"'\\s]|$)`, 'g');
  for (const element of [copy, ...copy.querySelectorAll('*')])
    for (const { name, value } of element.attributes)
      if (value.includes('#')) element.setAttribute(name, value.replace(pointing, `#$1${suffix}`));
}

// A picture of the box, set over it, or nothing if the box isn't laid out.
function pictureOf(box: HTMLElement): HTMLElement | undefined {
  const copy = box.cloneNode(true);
  if (!(copy instanceof HTMLElement) || !box.offsetWidth || !box.offsetHeight) return undefined;
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  for (const name of ['id', 'role', 'tabindex', 'aria-label', 'aria-describedby']) copy.removeAttribute(name);
  ownIds(copy);
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${box.offsetLeft}px`,
    top: `${box.offsetTop}px`,
    width: `${box.offsetWidth}px`,
    height: `${box.offsetHeight}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  box.after(copy);
  // Set by the box's own place, so it must stand in the same box the box is measured from.
  if (copy.offsetParent !== box.offsetParent) {
    copy.remove();
    return undefined;
  }
  copy.scrollLeft = box.scrollLeft;
  copy.scrollTop = box.scrollTop;
  return copy;
}

// Draw, fading each box from what it showed into what it shows now. A fade under way ends at once
// for the next. Still, it only draws.
export function crossFade(boxes: readonly HTMLElement[], draw: () => void, fade: Fade, still: boolean) {
  for (const box of boxes) {
    pictures.get(box)?.remove();
    pictures.delete(box);
    for (const animation of box.getAnimations({ subtree: true })) if (animation.id === FADE_ID) animation.finish();
  }
  if (still) {
    draw();
    return;
  }
  const held = boxes.flatMap(box => {
    const frame = box.getBoundingClientRect(),
      before = piecesOf(box).pieces.map(piece => looks(piece, frame)),
      picture = pictureOf(box);
    return picture ? [{ box, picture, before }] : [];
  });
  draw();
  // Every box is measured before any fade begins: a fade changes nothing's place, but starting one
  // leaves the page to be laid out again before the next piece can be measured.
  const measured = held.map(({ box, picture, before }) => {
    const frame = box.getBoundingClientRect(),
      drawn = piecesOf(box);
    return { box, picture, before, ...piecesOf(picture), drawn, after: drawn.pieces.map(piece => looks(piece, frame)) };
  });
  for (const { box, picture, before, pieces: old, held: stuck, worded: oldWords, drawn, after } of measured) {
    const waiting = new Map<string, Element[]>();
    // The picture is cut into the same pieces as the box was; should it not be, a hover say, nothing
    // is taken for the same, and everything fades.
    const matched = old.length === before.length;
    old.forEach((piece, index) => {
      const drawn = matched ? (before[index] ?? '') : `${index}`;
      waiting.set(drawn, [...(waiting.get(drawn) ?? []), piece]);
    });
    const timing = { ...fade, id: FADE_ID },
      half = fade.duration / 2,
      out: KeyframeAnimationOptions = { ...timing, duration: half, fill: 'forwards' },
      // Held out of sight until its half begins.
      into: KeyframeAnimationOptions = { ...timing, duration: half, delay: half, fill: 'backwards' };
    for (const element of stuck) unpaint(element);
    for (const element of oldWords) element.animate(WORDS_OUT, out);
    for (const element of drawn.worded) element.animate(WORDS_IN, into);
    for (const [index, piece] of drawn.pieces.entries()) {
      const same = waiting.get(after[index] ?? '')?.shift();
      if (same instanceof HTMLElement || same instanceof SVGElement) same.style.visibility = 'hidden';
      else {
        piece.animate(IN, into);
        same?.animate(OUT, out);
      }
    }
    for (const pieces of waiting.values()) for (const piece of pieces) piece.animate(OUT, out);
    pictures.set(box, picture);
    const gone = () => {
        picture.remove();
        if (pictures.get(box) === picture) pictures.delete(box);
      },
      done = picture.animate([], timing);
    done.addEventListener('finish', gone);
    done.addEventListener('cancel', gone);
  }
}
