// Small files in the formats forecast models send, for tests and stand-ins: a Zarr chunk in Blosc,
// a GeoTIFF of floats, and an OPeNDAP answer of one grid with its coordinates.

// A Blosc buffer holding float32 values as they are, uncompressed: what a Zarr chunk stores when
// its values wouldn't compress.
export function bloscStored(values: ArrayLike<number>): ArrayBuffer {
  const size = values.length * 4,
    out = new ArrayBuffer(16 + size),
    view = new DataView(out);
  view.setUint8(0, 2);
  view.setUint8(1, 1);
  view.setUint8(2, 0x02);
  view.setUint8(3, 4);
  view.setUint32(4, size, true);
  view.setUint32(8, size, true);
  view.setUint32(12, 16 + size, true);
  for (let i = 0; i < values.length; i++) view.setFloat32(16 + i * 4, values[i] ?? 0, true);
  return out;
}

// A GeoTIFF of 32-bit floats, little-endian, in one strip, its north-west pixel's corner at
// `west`, `north`, `step` degrees a pixel; or of 64-bit floats, big-endian, with no place at all.
export function geoTiff(options: {
  cols: number;
  rows: number;
  values: readonly number[];
  north?: number;
  west?: number;
  step?: number;
  wide?: boolean;
}): ArrayBuffer {
  const { cols, rows, values, north = 0, west = 0, step = 1, wide = false } = options,
    little = !wide,
    size = wide ? 8 : 4,
    placed = !wide,
    entries = placed ? 11 : 9,
    directory = 8,
    extra = directory + 2 + entries * 12 + 4,
    doubles = placed ? (3 + 6) * 8 : 0,
    pixels = extra + doubles,
    out = new ArrayBuffer(pixels + cols * rows * size),
    view = new DataView(out);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, directory, little);
  view.setUint16(directory, entries, little);
  let entry = directory + 2;
  const tag = (id: number, type: number, count: number, value: number) => {
    view.setUint16(entry, id, little);
    view.setUint16(entry + 2, type, little);
    view.setUint32(entry + 4, count, little);
    if (type === 3 && count === 1) view.setUint16(entry + 8, value, little);
    else view.setUint32(entry + 8, value, little);
    entry += 12;
  };
  tag(256, 4, 1, cols);
  tag(257, 4, 1, rows);
  tag(258, 3, 1, size * 8);
  tag(259, 3, 1, 1);
  tag(262, 3, 1, 1);
  tag(273, 4, 1, pixels);
  tag(278, 4, 1, rows);
  tag(279, 4, 1, cols * rows * size);
  tag(339, 3, 1, 3);
  if (placed) {
    tag(33_550, 12, 3, extra);
    tag(33_922, 12, 6, extra + 3 * 8);
    [step, step, 0, 0, 0, 0, west, north, 0].forEach((value, i) => {
      view.setFloat64(extra + i * 8, value, little);
    });
  }
  values.forEach((value, i) => {
    if (wide) view.setFloat64(pixels + i * 8, value, little);
    else view.setFloat32(pixels + i * 4, value, little);
  });
  return out;
}

// An OPeNDAP answer of one grid of Float32 readings over time, height, y and x, with its maps.
export function dapGrid(options: {
  name: string;
  times: readonly number[];
  ys: readonly number[];
  xs: readonly number[];
  values: readonly number[];
}): ArrayBuffer {
  const { name, times, ys, xs, values } = options,
    header = `Dataset {\n    Grid {\n     ARRAY:\n        Float32 ${name}[time = ${times.length}][height0 = 1][y = ${ys.length}][x = ${xs.length}];\n     MAPS:\n        Float64 time[time = ${times.length}];\n        Float32 height0[height0 = 1];\n        Float32 y[y = ${ys.length}];\n        Float32 x[x = ${xs.length}];\n    } ${name};\n} test;\n\nData:\n`,
    arrays: [readonly number[], number][] = [
      [values, 4],
      [times, 8],
      [[0], 4],
      [ys, 4],
      [xs, 4],
    ],
    length = header.length + arrays.reduce((sum, [list, size]) => sum + 8 + list.length * size, 0),
    out = new ArrayBuffer(length),
    view = new DataView(out),
    bytes = new Uint8Array(out);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  let at = header.length;
  for (const [list, size] of arrays) {
    view.setUint32(at, list.length);
    view.setUint32(at + 4, list.length);
    at += 8;
    for (const value of list) {
      if (size === 8) view.setFloat64(at, value);
      else view.setFloat32(at, value);
      at += size;
    }
  }
  return out;
}

// An S3 bucket listing of the keys under `prefix`, each with its size: what a Zarr archive answers
// when asked what a run holds.
export const bucketListing = (prefix: string, sizes: Readonly<Record<string, number>>): string =>
  `<ListBucketResult><Prefix>${prefix}</Prefix>${Object.entries(sizes)
    .map(
      ([key, size]) =>
        `<Contents><Key>${prefix}${key}</Key><LastModified>2026-11-03T14:02:13.000Z</LastModified><ETag>"x"</ETag><Size>${size}</Size></Contents>`,
    )
    .join('')}</ListBucketResult>`;

// Every tile of HRRR's grid, each `size` bytes, and its array's metadata.
export const hrrrSizes = (size: number): Record<string, number> => ({
  '.zarray': 371,
  ...Object.fromEntries(Array.from({ length: 8 * 12 }, (_, k) => [`0.${Math.floor(k / 12)}.${k % 12}`, size])),
});
