import { hatch, rainReading } from './coverage.ts';
import { HALF_TURN } from '../lib/compass.ts';
import { tilePlace, tilePoint, gridAt, type ScalarField } from './sources.ts';
import type { MapCentre } from './wind.ts';
import type { Corners } from './gl.ts';
import { phrase } from '../weather/words.ts';

// Colours for readings on the map: stops of a value and its colour (#RRGGBBAA), the colour
// between two blended from both and held at the ends. Some stops carry a label for the map's
// key, which spaces them evenly whatever their values.
export interface Stop {
  value: number;
  colour: string;
  label?: string;
}
// Temperature in °C, from deep violet at -40 °F through blues, teal, a yellow-green near 60 °F,
// yellow, orange and red, to a dark red at 130 °F; labelled for °F, and a second set for °C.
export const TEMPERATURE_F: readonly Stop[] = [
  { value: -40, colour: '#30004DFF', label: '-40' },
  { value: -23.33, colour: '#5856D6FF' },
  { value: -17.78, colour: '#2C68EAFF', label: '0' },
  { value: -12.22, colour: '#007AFFFF' },
  { value: -1.11, colour: '#5AC8FAFF', label: '30' },
  { value: 10, colour: '#66D4CFFF' },
  { value: 15.56, colour: '#B3D067FF', label: '60' },
  { value: 21.11, colour: '#FFCC00FF' },
  { value: 26.67, colour: '#FF9500FF' },
  { value: 32.22, colour: '#FF3B30FF', label: '90' },
  { value: 54.44, colour: '#770700FF', label: '130' },
];
export const TEMPERATURE_C: readonly Stop[] = [
  { value: -40, colour: '#30004DFF', label: '-40' },
  { value: -23.33, colour: '#5856D6FF' },
  { value: -20, colour: '#3E61E2FF', label: '-20' },
  { value: -12.22, colour: '#007AFFFF' },
  { value: -1.11, colour: '#5AC8FAFF' },
  { value: 0, colour: '#5BC9F6FF', label: '0' },
  { value: 10, colour: '#66D4CFFF', label: '10' },
  { value: 20, colour: '#F0CD15FF', label: '20' },
  { value: 21.11, colour: '#FFCC00FF' },
  { value: 26.67, colour: '#FF9500FF' },
  { value: 30, colour: '#FF5F1DFF', label: '30' },
  { value: 32.22, colour: '#FF3B30FF' },
  { value: 55, colour: '#770700FF', label: '55' },
];
// The US AQI, green to 25, yellow by 75, orange, red, magenta at 200, violet, and maroon from 350.
export const AQI_US: readonly Stop[] = [
  { value: 0, colour: '#04DE71FF', label: '0' },
  { value: 25, colour: '#04DE71FF' },
  { value: 75, colour: '#FFE620FF' },
  { value: 100, colour: '#FFBE10FF', label: '100' },
  { value: 125, colour: '#FF9500FF' },
  { value: 175, colour: '#FA114FFF' },
  { value: 200, colour: '#DF0B8AFF', label: '200' },
  { value: 250, colour: '#AA00FFFF' },
  { value: 300, colour: '#950C95FF', label: '300' },
  { value: 350, colour: '#80172BFF' },
  { value: 400, colour: '#80172BFF', label: '400' },
  { value: 500, colour: '#80172BFF', label: '500' },
];
// Precipitation in mm an hour: clear below a hundredth, a faint sky blue growing to blue by
// 0.6 (light), violet by 1.65 (moderate), yellow by 8 (heavy) and white at its extreme.
export const PRECIPITATION: readonly Stop[] = [
  { value: 0.01, colour: '#32ADEB00' },
  { value: 0.15, colour: '#32ADEB14' },
  { value: 0.32, colour: '#32ADEB8C' },
  { value: 0.47, colour: '#1791F6B4' },
  { value: 0.6, colour: '#007AFFFF', label: phrase('Light') },
  { value: 1.65, colour: '#AF52DEFF', label: phrase('Moderate') },
  { value: 8, colour: '#FFFF00FF', label: phrase('Heavy') },
  { value: 205, colour: '#FFFFFFFF', label: phrase('Extreme') },
];
// Rain on the radar by reflectivity (dBZ), in the forecast's colours: clear below 5, a faint sky
// blue growing to full by 16 (light), blue by 22, violet by 27 (moderate), yellow by 50 (heavy)
// and white by 55 (extreme). The radar's tiles are recoloured to it (see radarRecolour).
export const RADAR: readonly Stop[] = [
  { value: 5, colour: '#5AC8FA00' },
  { value: 5.1, colour: '#5AC8FA19' },
  { value: 11, colour: '#5AC8FA7A' },
  { value: 16, colour: '#5AC8FAFF', label: phrase('Light') },
  { value: 22, colour: '#007AFFC8' },
  { value: 27, colour: '#AF52DEDC', label: phrase('Moderate') },
  { value: 50, colour: '#FFFF00FF', label: phrase('Heavy') },
  { value: 55, colour: '#FFFFFFFF', label: phrase('Extreme') },
];
// Rain on the small map: the forecast's colours by reflectivity (dBZ), where the radar's echoes
// fall as its soft forecast would, blue from 20, violet by 30 and yellow only by 46; after dark,
// darker colours for its grey ground.
const STILL_DBZ = [5, 10.6, 15.1, 17.8, 19.5, 30, 46, 58],
  stillRadar = (colours: readonly string[]): readonly Stop[] =>
    STILL_DBZ.map((value, i) => ({ value, colour: colours[i] ?? '#00000000' }));
export const RADAR_STILL = stillRadar(PRECIPITATION.map(({ colour }) => colour)),
  RADAR_STILL_NIGHT = stillRadar([
    '#45668A00',
    '#45668A30',
    '#45668AA0',
    '#3B5C9EE0',
    '#2B4ACAFF',
    '#7C43A8FF',
    '#D4D443FF',
    '#FFFFFFFF',
  ]);
// The online radar's own colours by reflectivity (dBZ), the one scheme its free tiles come in:
// cyan to deep blue for light to moderate rain, yellow and orange, red to a dark red for heavy,
// then pink at its extreme. Labelled as the forecast's are, for the key over its frames where
// they aren't recoloured (on the card's own tiles).
export const RADAR_COLOURS: readonly Stop[] = [
  { value: 15, colour: '#88DDEEFF' },
  { value: 16, colour: '#6CD1EBFF', label: phrase('Light') },
  { value: 20, colour: '#00A3E0FF' },
  { value: 27, colour: '#00699CFF', label: phrase('Moderate') },
  { value: 34, colour: '#004768FF' },
  { value: 35, colour: '#FFEE00FF' },
  { value: 44, colour: '#FF8100FF' },
  { value: 45, colour: '#FF4400FF' },
  { value: 50, colour: '#C10000FF', label: phrase('Heavy') },
  { value: 54, colour: '#5D0000FF' },
  { value: 55, colour: '#FFAAFFFF', label: phrase('Extreme') },
];

type Rgba = [red: number, green: number, blue: number, alpha: number];
const HEX = 16,
  BYTE = 255,
  CHANNELS = 4,
  ALPHA_DIGITS = 3,
  PERCENT = 100;
const rgba = (colour: string): Rgba => {
  const [red = 0, green = 0, blue = 0, alpha = BYTE] = (colour.slice(1).match(/../g) ?? []).map(pair =>
    Number.parseInt(pair, HEX),
  );
  return [red, green, blue, alpha];
};
// The colour of `value` on a scale, its channels 0-255; nothing for no reading.
export function scaleColour(stops: readonly Stop[], value: number): Rgba {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  const next = stops.findIndex(stop => stop.value >= value),
    upper = stops[next],
    lower = stops[next - 1];
  if (!upper) return rgba(stops.at(-1)?.colour ?? '#00000000');
  if (!lower) return rgba(upper.colour);
  const share = (value - lower.value) / (upper.value - lower.value || 1),
    [red, green, blue, alpha] = rgba(lower.colour),
    [toRed, toGreen, toBlue, toAlpha] = rgba(upper.colour),
    mix = (from: number, to: number) => from + (to - from) * share;
  return [mix(red, toRed), mix(green, toGreen), mix(blue, toBlue), mix(alpha, toAlpha)];
}
export const css = ([red, green, blue, alpha]: Rgba): string =>
  `rgb(${Math.round(red)} ${Math.round(green)} ${Math.round(blue)} / ${(alpha / BYTE).toFixed(ALPHA_DIGITS)})`;

// The online radar's colour at each dBZ from -10 (clear below) to 65 (white above): grey to beige
// while too faint for rain, then as RADAR_COLOURS.
const PROVIDER_RADAR = {
  from: -10,
  colours: `
    63615914 66635a19 69665c1e 6c685d24 6f6b5f29 726e612e 75706234 78736439 7c75653e
    7f786744 827b6949 857d6a4e 88806c54 8b826d59 8e856f5e 92887164 9e93756e aa9e7978
    b6a97e82 c2b4828c cec08796 d2c48ba0 d6c88faa dacc93b4 ded097be 88ddeeff 6cd1ebff
    51c5e8ff 36bae5ff 1baee2ff 00a3e0ff 009ad5ff 0091caff 0088bfff 007fb4ff 0077aaff
    0070a3ff 00699cff 006295ff 005b8eff 005588ff 005180ff 004e78ff 004a70ff 004768ff
    ffee00ff ffe000ff ffd200ff ffc500ff ffb700ff ffaa00ff ff9f00ff ff9500ff ff8b00ff
    ff8100ff ff4400ff f23600ff e62800ff d91b00ff cd0d00ff c10000ff a80000ff 8f0000ff
    760000ff 5d0000ff ffaaffff ff9fffff ff95ffff ff8bffff ff81ffff ff77ffff ff6cffff
    ff62ffff ff58ffff ff4effff ffffffff`
    .trim()
    .split(/\s+/u)
    .map(colour => rgba(`#${colour}`)),
};
// Recolours the online radar's pixels (RGBA, in place) to `stops`: each colour read as the dBZ of
// the nearest of its own (its faintest come a shade off once decoded), and each worked out once.
const ALPHA = 3,
  LEVELS = 256;
const radarDbz = (seen: Rgba): number => {
  let nearest = 0,
    best = Number.POSITIVE_INFINITY;
  PROVIDER_RADAR.colours.forEach((colour, i) => {
    const distance = colour.reduce((sum, channel, k) => sum + (channel - (seen[k] ?? 0)) ** 2, 0);
    if (distance < best) {
      best = distance;
      nearest = i;
    }
  });
  return PROVIDER_RADAR.from + nearest;
};
const colourKey = (seen: Rgba) => seen.reduce((sum, channel) => sum * LEVELS + channel, 0);
export function radarRecolour(stops: readonly Stop[]): (pixels: Uint8ClampedArray) => void {
  const found = new Map<number, number[]>();
  const recolour = (seen: Rgba) => {
    const colour = scaleColour(stops, radarDbz(seen)).map(Math.round);
    return (colour[ALPHA] ?? 0) > 0 ? colour : [0, 0, 0, 0];
  };
  return pixels => {
    for (let i = 0; i < pixels.length; i += CHANNELS) {
      const alpha = pixels[i + ALPHA] ?? 0;
      if (!alpha) continue;
      const seen: Rgba = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, alpha],
        key = colourKey(seen);
      let to = found.get(key);
      if (!to) {
        to = recolour(seen);
        found.set(key, to);
      }
      pixels.set(to, i);
    }
  };
}
// The online radar's pixels (RGBA) as its readings, a byte each: the dBZ of the nearest of its own
// colours, counted up from RADAR_NONE, which is where it has no echo. The live map blends these
// between frames before they take their colours (see rain-gl).
export const RADAR_NONE = PROVIDER_RADAR.from - 1;
const levelOf = new Map<number, number>();
export function radarLevels(pixels: Uint8ClampedArray): Uint8Array {
  const levels = new Uint8Array(pixels.length / CHANNELS);
  for (let i = 0; i < levels.length; i++) {
    const alpha = pixels[i * CHANNELS + ALPHA] ?? 0;
    if (!alpha) continue;
    const at = i * CHANNELS,
      seen: Rgba = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, alpha],
      key = colourKey(seen);
    let level = levelOf.get(key);
    if (level === undefined) {
      level = radarDbz(seen) - RADAR_NONE;
      levelOf.set(key, level);
    }
    levels[i] = level;
  }
  return levels;
}

// The key's bar and its marks: each labelled stop an equal step up from the last, the colour
// between two running through the values between them.
const KEY_SAMPLES = 8;
export function scaleKey(stops: readonly Stop[]): { bar: string; marks: { label: string; at: number }[] } {
  const marked = stops.filter(stop => stop.label !== undefined),
    steps = Math.max(1, marked.length - 1),
    colours: string[] = [];
  marked.slice(1).forEach((stop, i) => {
    const from = marked[i]?.value ?? stop.value;
    for (let k = i ? 1 : 0; k <= KEY_SAMPLES; k++) {
      const share = k / KEY_SAMPLES;
      colours.push(
        `${css(scaleColour(stops, from + (stop.value - from) * share))} ${(((i + share) / steps) * PERCENT).toFixed(1)}%`,
      );
    }
  });
  return {
    bar: `linear-gradient(to top,${colours.join(',')})`,
    marks: marked.map((stop, i) => ({ label: stop.label ?? '', at: i / steps })),
  };
}

// A pin's ring: 232° of a turn, open 128° at the foot, running through the scale from
// `from` to `to`; and where `value` falls on it, in degrees round from the top.
const RING = { start: 244, sweep: 232, samples: 12 } as const;
export function ring(stops: readonly Stop[], from: number, to: number, value: number) {
  const colours = Array.from({ length: RING.samples + 1 }, (_, i) => {
    const share = i / RING.samples;
    return `${css(scaleColour(stops, from + (to - from) * share))} ${(share * RING.sweep).toFixed(1)}deg`;
  });
  const share = Math.min(1, Math.max(0, (value - from) / (to - from || 1)));
  return {
    gradient: `conic-gradient(from ${RING.start}deg,${colours.join(',')},transparent ${RING.sweep}deg)`,
    knob: RING.start + share * RING.sweep,
  };
}

// Paints `field` across a view in the colours of `stops`: worked out every 8 px, at the middle
// of each, into a canvas that small, which the page stretches smoothly over the view.
const FIELD_SAMPLE = 8,
  TILE = 256;
export function drawField(
  canvas: HTMLCanvasElement,
  field: ScalarField,
  view: MapCentre & { width: number; height: number },
  stops: readonly Stop[],
  coverage?: HTMLCanvasElement,
): void {
  const cols = Math.ceil(view.width / FIELD_SAMPLE),
    rows = Math.ceil(view.height / FIELD_SAMPLE),
    middle = tilePoint(view.latitude, view.longitude, view.zoom),
    left = middle.x * TILE - view.width / 2,
    top = middle.y * TILE - view.height / 2;
  canvas.width = cols;
  canvas.height = rows;
  canvas.style.width = `${cols * FIELD_SAMPLE}px`;
  canvas.style.height = `${rows * FIELD_SAMPLE}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(cols, rows),
    mask = coverage ? new OffscreenCanvas(cols, rows) : undefined,
    maskContext = mask?.getContext('2d'),
    missing = maskContext?.createImageData(cols, rows);
  let gaps = false;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const place = tilePlace(
          (left + (col + 1 / 2) * FIELD_SAMPLE) / TILE,
          (top + (row + 1 / 2) * FIELD_SAMPLE) / TILE,
          view.zoom,
        ),
        value = coverage
          ? rainReading(field, place.latitude, place.longitude)
          : gridAt(field, field.values, place.latitude, place.longitude),
        colour = scaleColour(stops, value);
      if (missing && !Number.isFinite(value)) {
        missing.data[(row * cols + col) * CHANNELS + ALPHA] = BYTE;
        gaps = true;
      }
      image.data.set(colour, (row * cols + col) * CHANNELS);
    }
  ctx.putImageData(image, 0, 0);
  if (coverage && mask && maskContext && missing) {
    maskContext.putImageData(missing, 0, 0);
    coverage.width = Math.ceil(view.width);
    coverage.height = Math.ceil(view.height);
    coverage.getContext('2d')?.drawImage(mask, 0, 0, cols * FIELD_SAMPLE, rows * FIELD_SAMPLE);
    coverage.dataset['gaps'] = String(gaps);
    hatch(coverage);
  }
}

// A field as an image over its own grid, for the live map to stretch between the grid's corners:
// 6 px a grid step each way, its rows evenly spaced in the map's projection (so the stretch puts
// each where it belongs), held off the poles where the projection ends.
const IMAGE_STEP = 6,
  POLE = 85.0511;
export function fieldImage(field: ScalarField, stops: readonly Stop[]): { url: string; corners: Corners } | null {
  const west = field.west,
    east = field.west + (field.cols - 1) * field.step,
    north = Math.min(POLE, field.north),
    south = Math.max(-POLE, field.north - (field.rows - 1) * field.step),
    cols = Math.max(2, (field.cols - 1) * IMAGE_STEP),
    rows = Math.max(2, (field.rows - 1) * IMAGE_STEP),
    canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(cols, rows),
    radians = Math.PI / HALF_TURN,
    projected = (latitude: number) => Math.atanh(Math.sin(latitude * radians)),
    top = projected(north),
    bottom = projected(south);
  for (let row = 0; row < rows; row++) {
    const latitude = Math.atan(Math.sinh(top + ((row + 1 / 2) / rows) * (bottom - top))) / radians;
    for (let col = 0; col < cols; col++) {
      const longitude = west + ((col + 1 / 2) / cols) * (east - west);
      image.data.set(
        scaleColour(stops, gridAt(field, field.values, latitude, longitude)),
        (row * cols + col) * CHANNELS,
      );
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    url: canvas.toDataURL(),
    corners: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}
