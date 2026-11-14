// Bakes the cloud sprites into seven grey images, assets/clouds-0.avif to clouds-6.avif, each a
// grid of every sprite: 0–5 hold the light from +x, −x, +y, −y, +z and −z, and 6 the coverage.
// The daylight storm uses its downward plane for diffuse sky light (see lightStorm).
// Grey images keep a lossy encoder from bleeding one map into another, as its colour subsampling
// would. AVIF at quality 70 keeps every map closer to the bake than WebP at quality 90 did, at 37%
// of the size. They are seven files rather than one tall one so each decodes on its own, small
// enough for any browser, and the GPU copies them a map at a time (see clouds-gl.ts).
// Slow (a few minutes); run after changing src/sky/clouds.ts:
// node scripts/clouds.ts (needs avifenc, from libavif).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { lightStorm } from './storm-light.ts';
import {
  ATLAS_WIDTH,
  BLANKETS,
  CLOUD_SPRITES,
  PLANE_HEIGHT,
  bakeCloud,
  spriteDepth,
  spriteRect,
} from '../src/sky/clouds.ts';

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = (table[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(4),
    body = Buffer.concat([Buffer.from(type), data]),
    tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};
// An 8-bit greyscale PNG.
function greyPng(width: number, height: number, grey: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(grey.buffer, y * width, width).copy(raw, y * (width + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const width = ATLAS_WIDTH,
  plane = PLANE_HEIGHT,
  planes = Array.from({ length: 7 }, () => new Uint8ClampedArray(width * plane).fill(255));
// The singles, then the overcast blankets below them.
[...CLOUD_SPRITES, ...BLANKETS].forEach(([kind, seed], index) => {
  const { left, top, width: w, height: h } = spriteRect(index),
    sprite = bakeCloud(kind, seed, w, h, spriteDepth(kind));
  if (kind === 'isolatedStorm') lightStorm(sprite);
  const { maps } = sprite;
  for (const [k, image] of planes.entries())
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) image[(top + y) * width + left + x] = (maps[(y * w + x) * 7 + k] ?? 0) * 255;
  console.log(`${kind} ${seed}`);
});
const dir = mkdtempSync(join(tmpdir(), 'clouds-'));
for (const [k, image] of planes.entries()) {
  const png = join(dir, `clouds-${k}.png`);
  writeFileSync(png, greyPng(width, plane, image));
  execFileSync('avifenc', ['-q', '70', '-s', '2', '-j', 'all', '-d', '8', '-y', '420', png, `assets/clouds-${k}.avif`]);
}
rmSync(dir, { recursive: true });
console.log('Wrote assets/clouds-0.avif to clouds-6.avif');
