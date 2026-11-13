// Blosc, the container Zarr arrays are often compressed in, read as far as forecast archives use it:
// LZ4 blocks, with or without the bytes of each value shuffled together, or the bytes stored as they
// are. A 16-byte header, a table of where each block starts, then each block in one or more pieces
// (one per byte of the value, when split), each piece its compressed length and its bytes.

const HEADER = { flags: 2, typeSize: 3, size: 4, blockSize: 8, compressed: 12, length: 16 } as const,
  FLAG = { shuffle: 0x01, stored: 0x02, bitShuffle: 0x04, delta: 0x08, unsplit: 0x10 } as const,
  CODEC_SHIFT = 5,
  LZ4 = 1,
  // Blocks are split into one piece per byte of the value, unless the value is wider than this, or
  // a piece would be smaller than this.
  MOST_SPLITS = 16,
  LEAST_SPLIT = 128,
  WORD = 4,
  // LZ4: a token's two lengths, each 15 or more going on in bytes that follow until one is under
  // 255; a match at least 4 long, from an offset of two bytes behind.
  NIBBLE = 4,
  LOW_NIBBLE = 0x0f,
  LONGER = 15,
  ANOTHER = 255,
  MIN_MATCH = 4,
  BYTE = 8;

// One LZ4 block, without a frame, from `source` between `start` and `end`, into `target` at `at`.
function lz4(source: Uint8Array, start: number, end: number, target: Uint8Array, at: number, size: number) {
  let read = start,
    write = at;
  const length = (initial: number) => {
    let total = initial;
    if (initial === LONGER) {
      let more = ANOTHER;
      while (more === ANOTHER) {
        more = source[read++] ?? 0;
        total += more;
      }
    }
    return total;
  };
  while (read < end) {
    const token = source[read++] ?? 0,
      literals = length(token >>> NIBBLE);
    target.set(source.subarray(read, read + literals), write);
    read += literals;
    write += literals;
    // The last sequence carries literals alone.
    if (read >= end) break;
    const offset = (source[read] ?? 0) | ((source[read + 1] ?? 0) << BYTE);
    read += 2;
    const match = length(token & LOW_NIBBLE) + MIN_MATCH;
    // Byte by byte, as a match may overlap what it is writing.
    for (let k = 0; k < match; k++, write++) target[write] = target[write - offset] ?? 0;
  }
  if (write - at !== size) throw new Error('Broken LZ4 block');
}

// The bytes of each value back together: shuffled, every value's first byte came first, then every
// value's second, and so on.
function unshuffle(source: Uint8Array, target: Uint8Array, at: number, size: number, width: number) {
  const values = Math.floor(size / width);
  for (let byte = 0; byte < width; byte++)
    for (let value = 0; value < values; value++) target[at + value * width + byte] = source[byte * values + value] ?? 0;
  for (let k = values * width; k < size; k++) target[at + k] = source[k] ?? 0;
}

export function readBlosc(input: Uint8Array): Uint8Array {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength),
    flags = input[HEADER.flags] ?? 0,
    width = input[HEADER.typeSize] ?? 1,
    size = view.getUint32(HEADER.size, true),
    blockSize = view.getUint32(HEADER.blockSize, true);
  if (input.length < HEADER.length || view.getUint32(HEADER.compressed, true) !== input.length)
    throw new Error('Cut-off Blosc data');
  const out = new Uint8Array(size);
  if ((flags & FLAG.stored) !== 0) {
    out.set(input.subarray(HEADER.length, HEADER.length + size));
    return out;
  }
  if (flags >>> CODEC_SHIFT !== LZ4 || (flags & (FLAG.bitShuffle | FLAG.delta)) !== 0)
    throw new Error(`Blosc encoding ${flags} isn't read`);
  const shuffled = (flags & FLAG.shuffle) !== 0,
    scratch = new Uint8Array(blockSize),
    blocks = Math.ceil(size / blockSize);
  for (let block = 0; block < blocks; block++) {
    const start = block * blockSize,
      length = Math.min(blockSize, size - start),
      split =
        (flags & FLAG.unsplit) === 0 && length === blockSize && width <= MOST_SPLITS && length / width >= LEAST_SPLIT,
      pieces = split ? width : 1,
      piece = Math.floor(length / pieces),
      target = shuffled ? scratch : out;
    let read = view.getUint32(HEADER.length + block * WORD, true),
      write = shuffled ? 0 : start;
    for (let k = 0; k < pieces; k++) {
      const compressed = view.getInt32(read, true);
      read += WORD;
      // A piece that wouldn't compress is stored as it is.
      if (compressed === piece) target.set(input.subarray(read, read + compressed), write);
      else lz4(input, read, read + compressed, target, write, piece);
      read += compressed;
      write += piece;
    }
    if (shuffled) unshuffle(scratch, out, start, length, width);
  }
  return out;
}
