import { afterEach, beforeEach, expect, test } from 'vitest';
import { crossFade } from '../src/lib/cross-fade.ts';

const FADE = { duration: 250, easing: 'linear' } as const;
let root: HTMLElement, box: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  root.style.position = 'relative';
  box = document.createElement('div');
  box.style.cssText = 'display:flex;gap:10px;width:300px;height:40px';
  root.append(box);
  document.body.append(root);
});
afterEach(() => {
  root.remove();
});

const picture = () => root.querySelector<HTMLElement>(':scope > [inert]');
const own = (selector: string) => {
  const found = box.querySelector(selector);
  if (!found) throw new Error(`No ${selector}.`);
  return found;
};
const pictured = (selector: string) => {
  const found = picture()?.querySelector(selector);
  if (!found) throw new Error(`No ${selector} in the picture.`);
  return found;
};
const fading = (element: Element) => element.getAnimations().length > 0;
const animates = (element: Element, property: string) =>
  element
    .getAnimations()
    .some(
      animation =>
        animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(key => property in key),
    );
const frame = () => new Promise(requestAnimationFrame);

test('what changed fades out and in, what is drawn the same in the same place stays, and the picture goes when done', async () => {
  box.innerHTML = '<span class="time">Now</span><span class="reading">74°</span>';
  crossFade(
    [box],
    () => {
      box.innerHTML = '<span class="time">Now</span><span class="reading">0%</span>';
    },
    FADE,
    false,
  );
  // The picture stands where the box is, out of reach.
  const held = picture();
  expect(held?.getAttribute('aria-hidden')).toBe('true');
  expect(held?.style.pointerEvents).toBe('none');
  expect(held?.getBoundingClientRect().toJSON()).toEqual(box.getBoundingClientRect().toJSON());
  // The same words in the same place neither fade nor show twice.
  expect(fading(own('.time'))).toBe(false);
  expect(getComputedStyle(pictured('.time')).visibility).toBe('hidden');
  // A reading that changed fades out of the picture and into the box.
  expect(fading(own('.reading'))).toBe(true);
  expect(fading(pictured('.reading'))).toBe(true);
  for (const animation of document.getAnimations()) animation.finish();
  await frame();
  expect(picture()).toBeNull();
});

test('a piece of what holds a light is never faded whole: its light and words fade on their own, and what it paints is left to the new one', () => {
  const row = (value: string) =>
    `<div class="row" style="border-bottom:1px solid #fff"><span class="value">${value}<i class="lift"></i></span></div>`;
  box.innerHTML = row('0″');
  crossFade(
    [box],
    () => {
      box.innerHTML = row('6 - 9');
    },
    FADE,
    false,
  );
  // Fading a box whole would cut its light off from what is behind it.
  for (const whole of ['.row', '.value']) {
    expect(animates(own(whole), 'opacity')).toBe(false);
  }
  expect(fading(own('.lift'))).toBe(true);
  // Its own words fade by their colour.
  expect(animates(own('.value'), 'color')).toBe(true);
  // Its rule is drawn once, by the new row.
  expect(getComputedStyle(pictured('.row')).borderBottomColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(own('.row')).borderBottomColor).toBe('rgb(255, 255, 255)');
});

test('a piece its styles hold out of sight stays so as it fades in', () => {
  box.innerHTML = '<span>Now</span>';
  crossFade(
    [box],
    () => {
      box.innerHTML = '<span class="hidden" style="opacity:0">Heavy</span>';
    },
    FADE,
    false,
  );
  const [animation] = own('.hidden').getAnimations();
  animation?.pause();
  if (animation) animation.currentTime = (FADE.duration * 3) / 4;
  expect(getComputedStyle(own('.hidden')).opacity).toBe('0');
});

// Every animation the fade set going, held at a moment of it.
const at = (ms: number) => {
  for (const animation of document.getAnimations()) {
    if (animation.id !== 'cross-fade') continue;
    animation.pause();
    animation.currentTime = ms;
  }
};
test('the old fades out over the first half and the new in over the second, so the two never show at once', () => {
  box.innerHTML = '<span class="reading">74°</span>';
  crossFade(
    [box],
    () => {
      box.innerHTML = '<span class="reading">0%</span>';
    },
    FADE,
    false,
  );
  const opacity = (element: Element) => Number(getComputedStyle(element).opacity);
  at(FADE.duration / 4);
  expect(opacity(pictured('.reading'))).toBeCloseTo(0.5, 1);
  expect(opacity(own('.reading'))).toBe(0);
  at(FADE.duration / 2);
  expect(opacity(pictured('.reading'))).toBe(0);
  expect(opacity(own('.reading'))).toBe(0);
  at((FADE.duration * 3) / 4);
  expect(opacity(pictured('.reading'))).toBe(0);
  expect(opacity(own('.reading'))).toBeCloseTo(0.5, 1);
});

test('words drawn where they were stay, though the box round them widens', () => {
  const styles = document.createElement('style');
  styles.textContent = '.wide .name{min-width:80px}';
  root.append(styles);
  box.innerHTML = '<span class="name">Today</span>';
  crossFade(
    [box],
    () => {
      box.classList.add('wide');
      box.innerHTML = '<span class="name">Today</span>';
    },
    FADE,
    false,
  );
  expect(own('.name').getBoundingClientRect().width).toBe(80);
  expect(fading(own('.name'))).toBe(false);
  expect(getComputedStyle(pictured('.name')).visibility).toBe('hidden');
});

test('a copy has ids of its own, and what it draws points at them', () => {
  const drawing = (shape: string) =>
    `<svg width="40" height="40"><defs><clipPath id="words"><rect width="${shape}" height="9"/></clipPath></defs><rect width="40" height="40" clip-path="url(#words)"/></svg><i class="lift" style="clip-path:url(#words)"></i>`;
  box.innerHTML = drawing('9');
  crossFade(
    [box],
    () => {
      box.innerHTML = drawing('20');
    },
    FADE,
    false,
  );
  const id = pictured('clipPath').id;
  expect(id).toMatch(/^words-was\d+$/);
  expect(pictured('svg > rect').getAttribute('clip-path')).toBe(`url(#${id})`);
  expect(pictured('.lift').getAttribute('style')).toContain(`#${id}`);
  expect(own('clipPath').id).toBe('words');
});

test('a fade under way gives way to the next at once, and still it only draws', () => {
  box.innerHTML = '<span>a</span>';
  const draw = (words: string) => () => {
    box.innerHTML = `<span>${words}</span>`;
  };
  crossFade([box], draw('b'), FADE, false);
  crossFade([box], draw('c'), FADE, false);
  expect(root.querySelectorAll(':scope > [inert]')).toHaveLength(1);
  expect(picture()?.textContent).toBe('b');
  crossFade([box], draw('d'), FADE, true);
  expect(picture()).toBeNull();
  expect(box.textContent).toBe('d');
  expect(
    document.getAnimations().filter(animation => animation.id === 'cross-fade' && animation.playState === 'running'),
  ).toHaveLength(0);
});
