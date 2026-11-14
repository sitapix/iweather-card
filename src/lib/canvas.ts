// What every canvas layer shares: its 2D context, colours as channels, and a hash that gives
// each sprite, star and bead the same random look on every frame and every card.

// A canvas's 2D context. Every browser the card supports has one; one that doesn't fails
// loudly rather than drawing nothing.
export function context2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', options);
  if (!ctx) throw new Error('iWeather: no 2D canvas context.');
  return ctx;
}
// A repeatable value from 0 to 1 for a pair of whole numbers: a 32-bit integer hash (primes
// to mix, shifts to fold the high bits down) over the largest unsigned 32-bit value.
const MIX_X = 374761393,
  MIX_Y = 668265263,
  MIX = 1274126177,
  FOLD = 13,
  HALF_WORD = 16,
  UINT32_MAX = 0xffffffff;
export const hash = (x: number, y: number): number => {
  let n = Math.imul(x, MIX_X) + Math.imul(y, MIX_Y);
  n = Math.imul(n ^ (n >>> FOLD), MIX);
  return ((n ^ (n >>> HALF_WORD)) >>> 0) / UINT32_MAX;
};

// A colour as #rrggbb: three channels of two hex digits each, 0 to 255.
export type RGB = readonly [red: number, green: number, blue: number];
export const CHANNEL_MAX = 255;
const HEX = 16,
  DIGITS = 2,
  CHANNELS = [0, 1, 2] as const;
const ALPHA_START = 1 + CHANNELS.length * DIGITS;
export const colorAlpha = (color: string): number =>
  color.length === ALPHA_START + DIGITS ? Number.parseInt(color.slice(ALPHA_START), HEX) / CHANNEL_MAX : 1;
export const alphaHex = (alpha: number): string =>
  Math.round(Math.max(0, Math.min(1, alpha)) * CHANNEL_MAX)
    .toString(HEX)
    .padStart(DIGITS, '0');
export const rgb = (color: string): RGB => {
  const [red, green, blue] = CHANNELS.map(channel =>
    Number.parseInt(color.slice(1 + channel * DIGITS, 1 + (channel + 1) * DIGITS), HEX),
  );
  return [red ?? 0, green ?? 0, blue ?? 0];
};
// Channels back to #rrggbb, each rounded and kept within 0 to 255.
export const toHex = (channels: readonly number[]): string =>
  `#${channels
    .map(value =>
      Math.round(Math.max(0, Math.min(CHANNEL_MAX, value)))
        .toString(HEX)
        .padStart(DIGITS, '0'),
    )
    .join('')}`;

export const mix = (a: string, b: string, amount: number): string => {
  const to = rgb(b);
  return toHex(rgb(a).map((value, index) => value + ((to[index] ?? value) - value) * amount));
};
