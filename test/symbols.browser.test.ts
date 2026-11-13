import { expect, test } from 'vitest';
import { moonGlyph } from '../src/cards/moon/rules.ts';
import { airGlyph, glyphs } from '../src/cards/shared/glyphs.ts';
import { SYMBOLS } from '../src/weather/symbols.ts';

// What each drawing's ink measures on screen, read off a canvas rather than its markup. A tile's
// glyph stands in a box 13.5 px high (16 units) and a symbol in one of 19.5 px in the list and
// 24.5 px in the strip (32 units), all on a page zoomed by .8.
const ZOOM = 0.8,
  TOLERANCE = 0.5;
const GLYPH_PX = (13.5 * ZOOM) / 16,
  LIST_PX = (19.5 * ZOOM) / 32,
  STRIP_PX = (24.5 * ZOOM) / 32;
const GLYPH_INK: Readonly<Record<string, readonly [width: number, height: number]>> = {
  sun: [13, 10.5],
  sunset: [13, 10.5],
  uv: [11, 11],
  feels_like: [6.5, 11],
  averages: [11, 9.5],
  precipitation: [7, 10],
  map: [10, 11.5],
  wind: [10.5, 9],
  visibility: [13.5, 8.5],
  humidity: [11, 9],
  pressure: [10, 10],
  air_quality: [10.5, 12],
};
const LIST_INK = [
  ['sun', SYMBOLS.sun, [14, 14]],
  ['cloud', SYMBOLS.cloud, [15.5, 10]],
  ['rain', SYMBOLS.rain, [14.5, 15]],
] as const;
const STRIP_INK = [
  ['cloud', SYMBOLS.cloud, [19.5, 13]],
  ['cloud and sun', SYMBOLS['cloud-sun'], [23.5, 17]],
  ['moon', SYMBOLS.moon, [16, 17]],
  ['sunrise', SYMBOLS.sunrise, [21, 17]],
  ['sunset', SYMBOLS.sunset, [21, 17]],
] as const;
// Eight canvas pixels to a screen pixel, and room round a drawing for what runs past its box.
const RESOLUTION = 8,
  MARGIN = 8,
  OPAQUE = 128;

async function inkOf(svg: string, screenPerUnit: number): Promise<readonly [width: number, height: number]> {
  const box = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(svg);
  if (!box) throw new Error('No viewBox.');
  const [x, y, width, height] = box.slice(1).map(Number);
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    throw new Error('A short viewBox.');
  const across = (width + MARGIN * 2) * screenPerUnit * RESOLUTION,
    down = (height + MARGIN * 2) * screenPerUnit * RESOLUTION,
    picture = new Image();
  picture.src = `data:image/svg+xml,${encodeURIComponent(
    svg.replace(
      box[0],
      `xmlns="http://www.w3.org/2000/svg" color="#fff" width="${across}" height="${down}" viewBox="${x - MARGIN} ${y - MARGIN} ${width + MARGIN * 2} ${height + MARGIN * 2}"`,
    ),
  )}`;
  await picture.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(across);
  canvas.height = Math.ceil(down);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No canvas.');
  context.drawImage(picture, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const rows: number[] = [],
    columns: number[] = [];
  for (let row = 0; row < canvas.height; row++)
    for (let column = 0; column < canvas.width; column++)
      if ((data[(row * canvas.width + column) * 4 + 3] ?? 0) > OPAQUE) {
        rows.push(row);
        columns.push(column);
      }
  const span = (values: readonly number[]) => (Math.max(...values) - Math.min(...values) + 1) / RESOLUTION;
  return [span(columns), span(rows)];
}
const expectInk = async (
  svg: string,
  screenPerUnit: number,
  [width, height]: readonly [width: number, height: number],
) => {
  const [inkWidth, inkHeight] = await inkOf(svg, screenPerUnit);
  expect(Math.abs(inkWidth - width)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(inkHeight - height)).toBeLessThanOrEqual(TOLERANCE);
};

test.each(Object.entries(GLYPH_INK))('the %s glyph stands its size', async (id, ink) => {
  const glyph = Object.entries(glyphs).find(([each]) => each === id)?.[1];
  if (!glyph) throw new Error(`No ${id} glyph.`);
  await expectInk(glyph, GLYPH_PX, ink);
});
test('the air quality glyph keeps its hexagon, however dense', async () => {
  await expectInk(airGlyph('low'), GLYPH_PX, [10.5, 12]);
  await expectInk(airGlyph('high'), GLYPH_PX, [11, 12.5]);
});
test.each(LIST_INK)('in the list, the %s symbol stands its size', async (_, symbol, ink) => {
  await expectInk(symbol, LIST_PX, ink);
});
test.each(STRIP_INK)('in the strip, the %s symbol stands its size', async (_, symbol, ink) => {
  await expectInk(symbol, STRIP_PX, ink);
});

// The moon tile's symbol, drawn ten canvas pixels to a unit: how strongly each pixel across its
// middle is drawn, 0 to 1.
const MOON_PX = 10;
async function moonRow(phase: number, south = false): Promise<readonly number[]> {
  const size = 16 * MOON_PX,
    picture = new Image();
  picture.src = `data:image/svg+xml,${encodeURIComponent(
    moonGlyph(phase, south).replace(
      '<svg ',
      `<svg xmlns="http://www.w3.org/2000/svg" color="#fff" width="${size}" height="${size}" `,
    ),
  )}`;
  await picture.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No canvas.');
  context.drawImage(picture, 0, 0);
  const { data } = context.getImageData(0, size / 2, size, 1);
  return Array.from({ length: size }, (_, x) => (data[x * 4 + 3] ?? 0) / 255);
}
// How far a stretch of a row strays from a strength, at most.
const STRAYS = 0.02;
const strays = (row: readonly number[], from: number, to: number, strength: number) =>
  Math.max(...row.slice(Math.round(from * MOON_PX), Math.round(to * MOON_PX)).map(value => Math.abs(value - strength)));
test.each([
  // [phase, south, lit from, lit to, dark from, dark to], in units of the 16 across.
  ['waning crescent', 0.9, false, 0.5, 5, 6, 14],
  ['waxing crescent', 0.1, false, 11, 15.5, 2, 10],
  ['waning crescent in the south', 0.9, true, 11, 15.5, 2, 10],
  ['waning gibbous', 0.6, false, 0.5, 10.4, 11, 14],
  ['waxing gibbous', 0.4, false, 5.6, 15.5, 2, 5],
  ['last quarter', 0.75, false, 0.5, 7.8, 8.2, 14],
  ['first quarter', 0.25, false, 8.2, 15.5, 2, 7.8],
  ['new moon', 0, false, 0.5, 1.4, 1.8, 14],
] as const)(
  'the %s symbol is lit where its moon is, and dark at a quarter',
  async (_, phase, south, litFrom, litTo, darkFrom, darkTo) => {
    const row = await moonRow(phase, south);
    // Lit throughout, ring and lit part alike, with no line between them.
    expect(strays(row, litFrom + 0.3, litTo - 0.1, 1)).toBeLessThan(STRAYS);
    expect(strays(row, darkFrom + 0.1, darkTo - 0.1, 0.25)).toBeLessThan(STRAYS);
  },
);
test('the full moon symbol is the whole disc', async () => {
  expect(strays(await moonRow(0.5), 0.6, 15.4, 1)).toBeLessThan(STRAYS);
});
