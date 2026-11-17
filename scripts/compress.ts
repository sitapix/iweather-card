// `pnpm compress`: a `.gz` and a `.br` beside each script and style in `dist/`, for a manual install.
// Home Assistant serves a file's compressed twin where one stands beside it, and the card's own file
// is then a quarter of its size on the way to the browser. Installers that write a `.gz` themselves
// need none of this.
//
// A twin is served in place of its file, so one left behind by an older copy would be served for a
// newer file of the same name: run this on every build that is copied, and copy the whole folder.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = 'dist',
  // Text the browser asks for, which compresses; the pictures are compressed already.
  TEXT = /\.(?:js|css)$/u,
  GZIP_LEVEL = 9,
  BROTLI_QUALITY = 11;

let before = 0,
  gzipped = 0,
  brotli = 0;
for (const name of readdirSync(DIST).filter(file => TEXT.test(file))) {
  const path = join(DIST, name),
    source = readFileSync(path),
    gz = gzipSync(source, { level: GZIP_LEVEL }),
    br = brotliCompressSync(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    });
  writeFileSync(`${path}.gz`, gz);
  writeFileSync(`${path}.br`, br);
  before += source.length;
  gzipped += gz.length;
  brotli += br.length;
}
console.log(`${DIST}: ${before} bytes of scripts and styles, ${gzipped} as gzip, ${brotli} as Brotli.`);
