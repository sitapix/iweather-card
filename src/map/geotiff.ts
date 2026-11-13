// A GeoTIFF of readings, read as far as map services send them: one band of 32- or 64-bit floats,
// uncompressed, in strips or tiles, either byte order, placed on longitude and latitude by its tie
// point and pixel size.

export interface GeoGrid {
  cols: number;
  rows: number;
  // The middle of the north-west pixel, and the degrees between pixels' middles.
  north: number;
  west: number;
  stepX: number;
  stepY: number;
  // Row by row from the north, each from the west; NaN where the file marks none.
  values: Float32Array;
}

const LITTLE = 0x49_49,
  BIG = 0x4d_4d,
  MAGIC = 42,
  HEADER = { magic: 2, directory: 4 } as const,
  ENTRY = { size: 12, tag: 0, type: 2, count: 4, value: 8 } as const,
  COUNT_SIZE = 2,
  TAG = {
    width: 256,
    height: 257,
    bits: 258,
    compression: 259,
    stripOffsets: 273,
    stripCounts: 279,
    tileWidth: 322,
    tileHeight: 323,
    tileOffsets: 324,
    tileCounts: 325,
    sampleFormat: 339,
    pixelScale: 33_550,
    tiePoint: 33_922,
    noData: 42_113,
  } as const,
  // The size of each field type, by number: byte, ASCII, short, long, rational, …, double.
  TYPE_SIZE: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 },
  SHORT = 3,
  LONG = 4,
  DOUBLE = 12,
  INLINE = 4,
  UNCOMPRESSED = 1,
  FLOAT_FORMAT = 3,
  FLOAT32 = 32,
  FLOAT64 = 64,
  BYTE = 8,
  // A tie point is (column, row, 0, longitude, latitude, 0): the place at that pixel's corner.
  TIE = { col: 0, row: 1, x: 3, y: 4 } as const;

export function readGeoTiff(buffer: ArrayBuffer): GeoGrid {
  const view = new DataView(buffer),
    order = view.getUint16(0);
  if (order !== LITTLE && order !== BIG) throw new Error('Not a TIFF');
  const little = order === LITTLE;
  if (view.getUint16(HEADER.magic, little) !== MAGIC) throw new Error('Not a classic TIFF');
  const directory = view.getUint32(HEADER.directory, little),
    count = view.getUint16(directory, little),
    tags = new Map<number, number[]>();
  for (let k = 0; k < count; k++) {
    const entry = directory + COUNT_SIZE + k * ENTRY.size,
      tag = view.getUint16(entry + ENTRY.tag, little),
      type = view.getUint16(entry + ENTRY.type, little),
      many = view.getUint32(entry + ENTRY.count, little),
      size = (TYPE_SIZE[type] ?? 1) * many,
      at = size <= INLINE ? entry + ENTRY.value : view.getUint32(entry + ENTRY.value, little),
      read = (i: number) =>
        type === SHORT
          ? view.getUint16(at + i * (TYPE_SIZE[SHORT] ?? 2), little)
          : type === LONG
            ? view.getUint32(at + i * (TYPE_SIZE[LONG] ?? INLINE), little)
            : type === DOUBLE
              ? view.getFloat64(at + i * BYTE, little)
              : (new Uint8Array(buffer)[at + i] ?? 0);
    tags.set(
      tag,
      Array.from({ length: many }, (_, i) => read(i)),
    );
  }
  const one = (tag: number, fallback = 0) => tags.get(tag)?.[0] ?? fallback,
    cols = one(TAG.width),
    rows = one(TAG.height),
    bits = one(TAG.bits);
  if (one(TAG.compression, UNCOMPRESSED) !== UNCOMPRESSED) throw new Error('Compressed TIFF');
  if (one(TAG.sampleFormat) !== FLOAT_FORMAT || (bits !== FLOAT32 && bits !== FLOAT64))
    throw new Error('TIFF of no floats');
  const bytes = bits / BYTE,
    sample = (at: number) => (bits === FLOAT64 ? view.getFloat64(at, little) : view.getFloat32(at, little)),
    values = new Float32Array(cols * rows),
    tileWidth = one(TAG.tileWidth),
    tileHeight = one(TAG.tileHeight);
  if (tileWidth > 0 && tileHeight > 0) {
    const across = Math.ceil(cols / tileWidth),
      offsets = tags.get(TAG.tileOffsets) ?? [];
    offsets.forEach((offset, tile) => {
      const left = (tile % across) * tileWidth,
        top = Math.floor(tile / across) * tileHeight;
      for (let y = 0; y < tileHeight && top + y < rows; y++)
        for (let x = 0; x < tileWidth && left + x < cols; x++)
          values[(top + y) * cols + left + x] = sample(offset + (y * tileWidth + x) * bytes);
    });
  } else {
    // Strips follow one another down the picture, each a run of whole rows.
    let next = 0;
    const lengths = tags.get(TAG.stripCounts) ?? [];
    (tags.get(TAG.stripOffsets) ?? []).forEach((offset, strip) => {
      const pixels = Math.min(Math.floor((lengths[strip] ?? 0) / bytes), cols * rows - next);
      for (let i = 0; i < pixels; i++) values[next + i] = sample(offset + i * bytes);
      next += pixels;
    });
  }
  const noData = Number.parseFloat(String.fromCharCode(...(tags.get(TAG.noData) ?? [])).replace('\0', ''));
  if (Number.isFinite(noData)) for (let i = 0; i < values.length; i++) if (values[i] === noData) values[i] = Number.NaN;
  const scale = tags.get(TAG.pixelScale) ?? [],
    tie = tags.get(TAG.tiePoint) ?? [],
    stepX = scale[0] ?? 1,
    stepY = scale[1] ?? 1;
  return {
    cols,
    rows,
    stepX,
    stepY,
    west: (tie[TIE.x] ?? 0) + ((tie[TIE.col] ?? 0) * -1 + 1 / 2) * stepX,
    north: (tie[TIE.y] ?? 0) - ((tie[TIE.row] ?? 0) * -1 + 1 / 2) * stepY,
    values,
  };
}
