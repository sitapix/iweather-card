import { type EditedPart, editing, follow } from './editing.ts';

// The card Home Assistant's editor previews shows the part being edited (see editing.ts): it
// scrolls there where the preview scrolls apart from the form, as beside it on a wide screen,
// and rings it for a moment. Under the form, as on a phone, it stays put, so the field being
// edited stays where it is.

// The editor's dialog, which holds the preview card. Cards on the dashboard behind it are
// previews too while it is being edited, but show nothing.
const DIALOG = 'HUI-DIALOG-EDIT-CARD';
// The ring holds, then fades (ms).
const RING = { hold: 900, fade: 700 } as const;
const RING_TIME = RING.hold + RING.fade;

export interface PreviewHost extends HTMLElement {
  // The element showing a part, when the card is showing it.
  partElement(part: EditedPart): HTMLElement | null;
}

// The next node out: across a shadow root to its host, and into the slot a node is placed in.
function outward(node: Node): Node | null {
  if (node instanceof Element && node.assignedSlot) return node.assignedSlot;
  return node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
}
function holds(outer: Node, node: Node): boolean {
  for (let at: Node | null = node; at; at = outward(at)) if (at === outer) return true;
  return false;
}
function inDialog(node: Node): boolean {
  for (let at = outward(node); at; at = outward(at)) if (at instanceof Element && at.tagName === DIALOG) return true;
  return false;
}
function scrolls(element: Element): boolean {
  const { overflowY } = getComputedStyle(element);
  return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight;
}

export class EditPreview {
  private stop: (() => void) | undefined;
  private ringed: HTMLElement | undefined;
  private fade: Animation | undefined;
  private timer: number | undefined;
  private frame = 0;
  private readonly host: PreviewHost;
  constructor(host: PreviewHost) {
    this.host = host;
  }
  connect() {
    if (this.stop || !inDialog(this.host)) return;
    this.stop = follow(() => this.show());
    // A card built for the last change carries on showing what the one before it showed, once
    // it is laid out.
    const now = editing();
    if (now && performance.now() - now.at < RING_TIME) this.frame = requestAnimationFrame(() => this.show());
  }
  disconnect() {
    this.stop?.();
    this.stop = undefined;
    cancelAnimationFrame(this.frame);
    this.clear();
  }
  show() {
    this.clear();
    const now = editing();
    const elapsed = now ? performance.now() - now.at : RING_TIME;
    if (!now || elapsed >= RING_TIME) return;
    let element: HTMLElement | null = null;
    for (const part of now.parts) {
      element = this.host.partElement(part);
      if (element) break;
    }
    if (!element) return;
    this.scrollTo(element, now.editor);
    this.ring(element, elapsed);
  }
  // The first box around the part that scrolls, unless it holds the form too; only as far as
  // brings the part into view, centred, or its top where it is taller than the box.
  scrollTo(element: HTMLElement, editor: Element) {
    for (let at = outward(element); at; at = outward(at)) {
      if (!(at instanceof Element) || !scrolls(at)) continue;
      if (holds(at, editor)) return;
      const box = at.getBoundingClientRect(),
        part = element.getBoundingClientRect();
      if (part.top >= box.top && part.bottom <= box.bottom) return;
      const offset =
        part.height > box.height ? part.top - box.top : part.top - box.top - (box.height - part.height) / 2;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      at.scrollTo({ top: at.scrollTop + offset, behavior: still ? 'instant' : 'smooth' });
      return;
    }
  }
  // The ring, from where it was `elapsed` ms in: the outline the styles give `data-editing`,
  // fading to nothing.
  ring(element: HTMLElement, elapsed: number) {
    this.ringed = element;
    element.setAttribute('data-editing', '');
    try {
      this.fade = element.animate([{ outlineColor: 'transparent' }], {
        delay: RING.hold,
        duration: RING.fade,
        easing: 'ease-in',
        fill: 'forwards',
      });
      this.fade.currentTime = elapsed;
    } catch {
      // A browser that can't fade from the outline as it is shows it until the time is up.
      this.fade = undefined;
    }
    this.timer = window.setTimeout(() => this.clear(), RING_TIME - elapsed);
  }
  clear() {
    window.clearTimeout(this.timer);
    this.fade?.cancel();
    this.fade = undefined;
    this.ringed?.removeAttribute('data-editing');
    this.ringed = undefined;
  }
}
