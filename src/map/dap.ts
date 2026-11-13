// OPeNDAP's binary answer (DAP2 `.dods`), read as far as a grid of readings needs: a text header
// naming each array and its shape, then each array in that order as its length twice and its
// values, big-endian, every integer in four bytes.

const DATA_MARK = '\nData:\n',
  // A declared array: its type, its name, and its dimensions in brackets.
  DECLARATION = /(Float32|Float64|Int32|UInt32|Int16|UInt16)\s+(\w+)((?:\[[^\]]+\])+);/g,
  DIMENSION = /\[[^=\]]*=\s*(\d+)\]/g,
  SIZE: Readonly<Record<string, number>> = { Float64: 8, Float32: 4, Int32: 4, UInt32: 4, Int16: 4, UInt16: 4 },
  WORD = 4,
  LENGTHS = 2,
  RADIX = 10;

export interface DapArray {
  shape: number[];
  values: Float64Array;
}

export function readDap(buffer: ArrayBuffer): Map<string, DapArray> {
  // One character a byte, so where the header ends is where the data starts.
  const header = new TextDecoder('latin1').decode(buffer),
    mark = header.indexOf(DATA_MARK);
  if (mark < 0) throw new Error('No OPeNDAP data');
  const view = new DataView(buffer),
    arrays = new Map<string, DapArray>();
  let at = mark + DATA_MARK.length;
  for (const [, type = '', name = '', dimensions = ''] of header.slice(0, mark).matchAll(DECLARATION)) {
    const shape = [...dimensions.matchAll(DIMENSION)].map(([, size = '0']) => Number.parseInt(size, RADIX)),
      count = view.getUint32(at),
      size = SIZE[type] ?? WORD;
    at += WORD * LENGTHS;
    const values = new Float64Array(count);
    for (let k = 0; k < count; k++, at += size)
      values[k] =
        type === 'Float64'
          ? view.getFloat64(at)
          : type === 'Float32'
            ? view.getFloat32(at)
            : type === 'Int32' || type === 'Int16'
              ? view.getInt32(at)
              : view.getUint32(at);
    arrays.set(name, { shape, values });
  }
  return arrays;
}
