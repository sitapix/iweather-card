// The element under `parent` matching `selector`. The card's own markup always has it,
// so a missing one is a fault, reported as one.
export function child(parent: ParentNode, selector: string): HTMLElement {
  const node = parent.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`iWeather: no ${selector} element.`);
  return node;
}
// The canvas under `parent` matching `selector`.
export function canvasIn(parent: ParentNode, selector: string): HTMLCanvasElement {
  const node = child(parent, selector);
  if (!(node instanceof HTMLCanvasElement)) throw new Error(`iWeather: ${selector} is not a canvas.`);
  return node;
}
// The element an event happened in, or its nearest ancestor, that matches `selector`.
export function targetOf(event: Event, selector: string): HTMLElement | null {
  const target = event.target,
    found = target instanceof Element ? target.closest(selector) : null;
  return found instanceof HTMLElement ? found : null;
}
// Calls `end` once if the page is hidden before the returned function is called. A page suspended
// in the middle of a press hears no end to it, not even a cancel, so this ends what is held.
export function onHidden(end: () => void): () => void {
  const stop = () => {
      document.removeEventListener('visibilitychange', changed);
      removeEventListener('pagehide', gone);
    },
    gone = () => {
      stop();
      end();
    },
    changed = () => {
      if (document.hidden) gone();
    };
  document.addEventListener('visibilitychange', changed);
  addEventListener('pagehide', gone);
  return stop;
}
// Sets a node's text, leaving it untouched when it already reads so.
export function setText(node: HTMLElement, value: string) {
  if (node.textContent !== value) node.textContent = value;
}
