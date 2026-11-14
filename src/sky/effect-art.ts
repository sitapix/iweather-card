import { EFFECT_ATLASES } from './effect-atlases.ts';

type Effect = keyof typeof EFFECT_ATLASES;
const dimensions = {
  wind: [504, 800],
  frost: [512, 512],
  near: [120, 240],
  falling: [396, 560],
  rain: [64, 68],
  noise: [696, 696],
  fringe: [768, 512],
} as const;
const images = new Map<Effect, HTMLImageElement>();
const loading = new Map<Effect, Promise<boolean>>();

export const effectImage = (effect: Effect): HTMLImageElement | undefined => images.get(effect);

// A missing optional sheet leaves the procedural drawing in place. Cards share the first request.
export function loadEffectArt(effect: Effect): Promise<boolean> | undefined {
  const url = EFFECT_ATLASES[effect];
  if (!url || images.has(effect)) return undefined;
  const pending = loading.get(effect);
  if (pending) return pending;
  const promise = new Promise<boolean>(resolve => {
    const image = new Image(),
      [width, height] = dimensions[effect];
    image.onload = () => {
      if (image.naturalWidth === width && image.naturalHeight === height) images.set(effect, image);
      resolve(images.has(effect));
    };
    image.onerror = () => resolve(false);
    image.src = url;
  });
  loading.set(effect, promise);
  return promise;
}
