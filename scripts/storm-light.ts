import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { SPRITE_HEIGHT, SPRITE_WIDTH, type BakedSprite } from '../src/sky/clouds.ts';

// Build-time artwork, at the single sprite's resolution. R is exposure to the upper
// light, G is the diffuse sky light, and B is the coverage of the cloud and its haze.
const light = gunzipSync(readFileSync(new URL('./art/isolated-storm.rgb.gz', import.meta.url)));
if (light.length !== SPRITE_WIDTH * SPRITE_HEIGHT * 3) throw new Error('Invalid isolated storm light map size.');

export function lightStorm({ width, height, maps }: BakedSprite): void {
  for (let y = 0; y < height; y++) {
    const row = Math.floor(((y + 0.5) * SPRITE_HEIGHT) / height);
    for (let x = 0; x < width; x++) {
      const column = Math.floor(((x + 0.5) * SPRITE_WIDTH) / width),
        source = (row * SPRITE_WIDTH + column) * 3,
        at = (y * width + x) * 7,
        sun = (light[source] ?? 0) / 255,
        sky = (light[source + 1] ?? 0) / 255,
        cover = (light[source + 2] ?? 0) / 255;
      let mean = 0;
      for (let k = 0; k < 6; k++) mean += (maps[at + k] ?? 0) / 6;
      // Keep the relief of the volume within the exposed folds. The downward map
      // carries the diffuse term for this overhead-lit sprite, even in deep shadow.
      for (let k = 0; k < 6; k++) maps[at + k] = sun * (0.79 + 0.21 * (maps[at + k] ?? 0));
      maps[at + 3] = sky * (0.94 + 0.06 * mean);
      maps[at + 6] = Math.max(cover, (maps[at + 6] ?? 0) * 0.5);
    }
  }
}
