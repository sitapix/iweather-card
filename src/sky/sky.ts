import { lightingFor, skyGradientFor, skyKind, skyPreset, type Lighting } from './presets.ts';
import type { GradientName, Lightning, SkyKind, SkyLayer, SkyLook } from './presets-data.ts';
import { finite, clamp } from '../lib/values.ts';
import { hash, mix } from '../lib/canvas.ts';
import { METERS_PER_SECOND, UNITS, beaufortSpeed, isBeaufort } from '../weather/units.ts';
import { DAY, HOUR, HOURS_PER_DAY, MINUTE } from '../lib/time.ts';
import { FULL_TURN, HALF_TURN } from '../lib/compass.ts';
import { PERCENT } from '../lib/html.ts';
import { nearestCondition } from '../weather/condition-words.ts';
import type { CloudAltitude } from '../card/home-assistant.ts';

const RAD = Math.PI / HALF_TURN;
// The astronomical series count days from J2000.0, 10957.5 days after the Unix epoch.
const J2000_DAYS = 10957.5;
const daysSinceJ2000 = (time: number) => time / DAY - J2000_DAYS;

// Cloud cover and lighting by reported condition. The sky kind supplies the cloud decks,
// gradient, celestial bodies and falling particles.
interface BasePreset {
  clouds: readonly [back: number, middle: number, front: number];
  blanket?: boolean;
  overcastAmount?: number;
  fog?: number;
  windy?: boolean;
}
const UNAVAILABLE: BasePreset = { clouds: [0.4, 0.3, 0.2], overcastAmount: 0.7 };
const PRESETS: Readonly<Record<string, BasePreset>> = {
  sunny: { clouds: [0.16, 0.08, 0] },
  'clear-night': { clouds: [0.06, 0.03, 0] },
  partlycloudy: { clouds: [0.42, 0.32, 0.2] },
  cloudy: { clouds: [0.75, 0.62, 0.48], blanket: true, overcastAmount: 0.75 },
  fog: { clouds: [0.3, 0.2, 0], blanket: true, fog: 1, overcastAmount: 0.75 },
  rainy: { clouds: [0.8, 0.7, 0.55], blanket: true, overcastAmount: 0.82 },
  pouring: { clouds: [0.9, 0.8, 0.65], blanket: true, overcastAmount: 0.82 },
  lightning: { clouds: [0.85, 0.72, 0.55], blanket: true, overcastAmount: 0.86 },
  'lightning-rainy': { clouds: [0.9, 0.8, 0.62], blanket: true, overcastAmount: 0.88 },
  snowy: { clouds: [0.78, 0.62, 0.45], blanket: true, overcastAmount: 0.6 },
  'snowy-rainy': { clouds: [0.8, 0.68, 0.5], blanket: true, overcastAmount: 0.68 },
  hail: { clouds: [0.85, 0.72, 0.55], blanket: true, overcastAmount: 0.75 },
  windy: { clouds: [0.35, 0.28, 0.18], windy: true },
  'windy-variant': { clouds: [0.7, 0.58, 0.42], blanket: true, overcastAmount: 0.5, windy: true },
  exceptional: { clouds: [0.6, 0.5, 0.35], overcastAmount: 0.45 },
};

const KILOMETERS_PER_HOUR = METERS_PER_SECOND[UNITS.kilometersPerHour] ?? 1;
export function windMetersPerSecond(speed: number | undefined, unit: string | undefined): number {
  if (!finite(speed)) return 0;
  // An unnamed unit is taken as km/h, the most common.
  return isBeaufort(unit)
    ? beaufortSpeed(speed)
    : speed * ((unit === undefined ? undefined : METERS_PER_SECOND[unit]) ?? KILOMETERS_PER_HOUR);
}

// What the scene is drawn from: the condition, the sun and moon, and the entity's readings.
export interface SceneInputs {
  condition?: string;
  night?: boolean;
  elevation?: number | undefined;
  rising?: boolean;
  cloudCover?: number | undefined;
  cloudAltitude?: CloudAltitude | undefined;
  windSpeed?: number;
  moonAltitude?: number | undefined;
  moonTilt?: number | undefined;
  // The lunar phase now (0 new, .5 full), as moonPhase gives it.
  moonPhase?: number | undefined;
  precipitation?: number | undefined;
  precipitationUnit?: string | undefined;
  solarHour?: number | undefined;
  moonHour?: number | undefined;
  temperature?: number | undefined;
  dewPoint?: number | undefined;
  humidity?: number | undefined;
  visibility?: number | undefined;
}
// The scene for a sky: its kind and look, gradient and lighting, each layer's strength,
// and how the clouds and precipitation move.
export interface ScenePreset {
  condition: string;
  kind: SkyKind;
  look: SkyLook;
  light: Lighting;
  night: boolean;
  solarHour: number | undefined;
  moonHour: number | undefined;
  elevation: number;
  rising: boolean;
  sky: string[];
  skyStop: number;
  clouds: readonly number[];
  overcastAmount: number;
  lit: number;
  golden: number;
  rain: number;
  snow: number;
  dust: number;
  hail: number;
  sleet: number;
  fog: number;
  lightning: boolean;
  cloudFlash: boolean;
  precipitating: boolean;
  overcastSky: boolean;
  blanket: number;
  stars: number;
  moon: boolean;
  moonAltitude: number | undefined;
  moonTilt: number | undefined;
  sun: boolean;
  flare: boolean;
  rays: SkyLook['rays'] | null;
  ghosts: SkyLook['ghosts'] | null;
  rainbow: SkyLook['rainbow'] | null;
  strikes: Lightning;
  fringe: number;
  windAngle: number;
  fps: number;
  cloudSpeed: number;
}
// A daytime sky with a lid is lifted toward pale blue-grey, by how dark its gradient is,
// except these, which show their gradient as it is.
const LIFT: Readonly<Partial<Record<GradientName, number>>> = {
  rainheavy: 0.12,
  snowheavy: 0.18,
  hurricane: 0.08,
  overcast_low: 0,
  overcast_mid: 0,
  rain: 0,
  overcast_high: 0,
};
const FALLING: readonly SkyLayer[] = ['rain', 'snow', 'sleet', 'hail'],
  STORMY: readonly SkyLayer[] = [...FALLING, 'lightning'];

// The moon shows in the sky only while the sun is at most 9° up and the moon itself more than 9° up.
const MOON_SHOWS = 9;

// Rain and snow lean 15° per 100 mph of wind, to 100 mph.
const MILES_PER_HOUR = METERS_PER_SECOND[UNITS.milesPerHour] ?? 1;
const LEAN = { mph: 100, degrees: 15 } as const;
export function scenePreset({
  condition = 'unavailable',
  night = false,
  elevation,
  rising = true,
  cloudCover,
  cloudAltitude,
  windSpeed = 0,
  moonAltitude,
  moonTilt,
  moonPhase: phase,
  precipitation,
  precipitationUnit,
  solarHour,
  moonHour,
  temperature,
  dewPoint,
  humidity,
  visibility,
}: SceneInputs = {}): ScenePreset {
  // The preset for this kind of sky drives the gradient, layers,
  // clouds, precipitation and light; the older per-condition values fill the rest.
  const kind = skyKind(condition, {
      cloudCover,
      cloudAltitude,
      precipitation,
      precipitationUnit,
      temperature,
      windSpeed,
      visibility,
      dewPoint,
      humidity,
    }),
    preset = skyPreset(kind),
    look = !night && preset.day ? { ...preset, ...preset.day } : preset,
    layers = new Set(look.layers);
  // A condition in an integration's own words takes the values of the nearest condition.
  const base = PRESETS[nearestCondition(condition) ?? condition] ?? UNAVAILABLE;
  // Providers that report cloud cover refine the fair-weather presets.
  const cover = finite(cloudCover) && !base.blanket ? clamp(cloudCover / PERCENT) : null;
  const clouds =
    cover === null
      ? base.clouds
      : base.clouds.map((value, index) => Math.max(value * 0.5, clamp(cover * (1 - index * 0.22))));
  const fallback = night ? -25 : 40,
    sunElevation = finite(elevation) ? elevation : fallback;
  // The moon appears wherever the preset has a moon layer, once it is clear of the horizon
  // and the sun low enough (MOON_SHOWS), by day too (a pale moon over a dawn sky), and never
  // as the new moon's dark picture. While it shows, it lights the sky (see lightingFor).
  const moon =
    layers.has('moon') &&
    moonAltitude !== undefined &&
    moonAltitude > MOON_SHOWS &&
    sunElevation <= MOON_SHOWS &&
    (phase === undefined || skyMoonPhase(phase) > 0);
  const [top, middle, bottom, skyStop] = skyGradientFor(kind, sunElevation, rising),
    light = lightingFor(kind, sunElevation, rising, moon);
  const lift = !night && look.blanket ? (LIFT[look.sky] ?? 0.28) : 0,
    sky = [top, middle, bottom].map((color, i) => mix(color, '#c4cfe0', lift * (1 + i * 0.3)));
  // Preset particle counts fill a phone screen; these are per card, in proportion.
  const fall = ([front, back]: SkyLook['rain']) => (layers.has('rain') ? (front[0] + back[0] / 10) * 0.25 : 0);
  const overcastAmount = base.overcastAmount ?? 0,
    lit = clamp((sunElevation + 6) / 14),
    golden = clamp(1 - Math.abs(sunElevation - 1) / 9) * (1 - overcastAmount);
  return {
    overcastAmount,
    condition,
    kind,
    look,
    light,
    night,
    solarHour,
    moonHour,
    elevation: sunElevation,
    rising,
    sky,
    skyStop,
    clouds,
    lit,
    golden,
    rain: fall(look.rain),
    snow: layers.has('snow') ? (look.snow[0][0] + look.snow[1][0] / 10) * 0.5 : 0,
    // Dust's grains are too many to draw one for one, and too fine to miss.
    dust: layers.has('dust') ? look.snow[0][0] * 0.2 : 0,
    hail: layers.has('hail') ? look.hail[0] * 0.6 : 0,
    sleet: layers.has('sleet') ? (look.sleet[0][0] + look.sleet[1][0] / 10) * 0.5 : 0,
    fog: layers.has('fog') ? 1 : (base.fog ?? 0),
    lightning: layers.has('lightning'),
    cloudFlash: layers.has('cloudFlash'),
    // The blanket is near opaque wherever a preset enables it, and a veil, drawn in its place, as
    // opaque as the preset says.
    // Overcast for lighting: a blanket, or any falling precipitation under a grey sky.
    precipitating: FALLING.some(layer => layers.has(layer)),
    overcastSky: Boolean(look.blanket) || FALLING.some(layer => layers.has(layer)),
    blanket: look.veil
      ? look.veil[2]
      : look.blanket
        ? layers.has('rain') || layers.has('snow') || layers.has('lightning')
          ? 0.85
          : 0.6
        : 0,
    stars: layers.has('stars') ? light.stars : 0,
    moon,
    moonAltitude,
    moonTilt,
    sun: !night && layers.has('sunDisc') && sunElevation > -2,
    // Lens effects need a clear path to the sun; fringe edges overcast skies.
    flare: !night && (layers.has('sunHalo') || layers.has('sunGhosts')) && sunElevation > -2,
    // Sun extras, each only where its preset enables it.
    rays: !night && layers.has('sunBeams') ? look.rays : null,
    ghosts: layers.has('sunGhosts') ? look.ghosts : null,
    rainbow: layers.has('sunHalo') ? look.rainbow : null,
    strikes: look.lightning,
    fringe: base.blanket ? 0.45 + overcastAmount * 0.35 : 0,
    // Fall angle: falling rain and snow lean 15°
    // per 100 mph of wind, wind capped at 100 mph. windSpeed is in meters per second.
    windAngle: ((Math.min(LEAN.mph, windSpeed / MILES_PER_HOUR) / LEAN.mph) * LEAN.degrees * Math.PI) / HALF_TURN,
    // Frame rate for the kind of sky: 60 fps with anything falling or storming,
    // 30 for clouds, fog and haze, 25 for clear, frigid and hot skies.
    fps: STORMY.some(layer => layers.has(layer)) ? 60 : /^(clear|frigid|hot)$/.test(kind) ? 25 : 30,
    cloudSpeed: 1 + clamp(windSpeed / 8, 0, 3) + (base.windy ? 1.5 : 0),
  };
}

// The lunar cycle as a share from new moon: first quarter, full and last quarter at its quarters.
export const MOON_PHASE = { new: 0, firstQuarter: 0.25, full: 0.5, lastQuarter: 0.75 } as const;
// A phase as the moon-disc canvases carry it, to four decimals (a minute of the cycle).
export const PHASE_DIGITS = 4;
// The sky's moon is one of 28 pictures through the cycle, picture k showing phase k/28. The
// moon's phase angle (0° full, 180° new) picks it, in steps that are finest at the half
// moons: the full picture holds within 24° of full (about two days either side), and the
// new one beyond 156°. Each step out from full, waxing or waning, starts at these angles.
const SKY_MOON_PICTURES = 28;
const SKY_MOON_STEPS = [24, 38, 50, 58, 68, 76, 85, 95, 109, 123, 135, 140, 144, 156] as const;
// The phase the sky's moon is drawn at for `phase` (0 new, .5 full).
export function skyMoonPhase(phase: number): number {
  const cycle = (((phase % 1) + 1) % 1) * FULL_TURN,
    waxing = cycle < HALF_TURN,
    angle = HALF_TURN - (waxing ? cycle : FULL_TURN - cycle),
    out = SKY_MOON_STEPS.findIndex(limit => angle <= limit),
    half = SKY_MOON_PICTURES / 2,
    picture = out === -1 ? 0 : waxing ? half - out : half + out;
  return picture / SKY_MOON_PICTURES;
}
// 0 new, .25 first quarter, .5 full, .75 last quarter: the Moon's elongation from
// the Sun in ecliptic longitude, with the main periodic terms (within about an hour).
export function moonPhase(time = Date.now()): number {
  const d = daysSinceJ2000(time),
    sin = (angle: number) => Math.sin(angle * RAD);
  const Mm = 134.963 + 13.064993 * d,
    Ms = 357.529 + 0.98560028 * d,
    D = 297.85 + 12.190749 * d,
    F = 93.272 + 13.22935 * d;
  const moon =
    218.316 +
    13.176396 * d +
    6.289 * sin(Mm) -
    1.274 * sin(Mm - 2 * D) +
    0.658 * sin(2 * D) +
    0.214 * sin(2 * Mm) -
    0.186 * sin(Ms) -
    0.114 * sin(2 * F);
  const sun = 280.46 + 0.9856474 * d + 1.915 * sin(Ms) + 0.02 * sin(2 * Ms);
  return ((((moon - sun) % FULL_TURN) + FULL_TURN) % FULL_TURN) / FULL_TURN;
}

// Low-precision lunar position (about 1° accuracy), in degrees above the horizon.
export function moonAltitude(
  time: number,
  latitude: number | undefined,
  longitude: number | undefined,
): number | undefined {
  if (!finite(latitude) || !finite(longitude)) return undefined;
  const { dec, hour, phi } = lunarSky(time, latitude, longitude);
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hour)) / RAD;
}
// The moon's progress across the sky as a solar-style hour: 6 at moonrise, 12 at
// its highest, 18 at moonset, from its hour angle and the half-arc it spends above
// the horizon. Undefined while it is down.
export function moonHourAt(
  time: number,
  latitude: number | undefined,
  longitude: number | undefined,
): number | undefined {
  if (!finite(latitude) || !finite(longitude)) return undefined;
  const { dec, hour, phi } = lunarSky(time, latitude, longitude),
    angle = Math.atan2(Math.sin(hour), Math.cos(hour));
  const cosine = -Math.tan(phi) * Math.tan(dec),
    half = cosine <= -1 ? Math.PI : cosine >= 1 ? 0 : Math.acos(cosine);
  if (!half || Math.abs(angle) > half) return undefined;
  return HOURS_PER_DAY / 2 + (angle / half) * (HOURS_PER_DAY / 4);
}
// The lunar equator's tilt to the ecliptic, and the daily drift of the Moon's ascending node.
const LUNAR_EQUATOR_TILT = 1.54242 * RAD;
const NODE_AT_J2000 = 125.0445,
  NODE_PER_DAY = 0.0529539;
// The position angle of the Moon's axis (radians, from celestial north toward east,
// counter-clockwise on a north-up sky): where its north pole points, without the
// physical libration (well under a degree). It swings about ±25° through the month.
export function moonAxis(time: number): number {
  const { ra, d, e, l, b } = lunarPosition(time);
  const node = (NODE_AT_J2000 - NODE_PER_DAY * d) * RAD,
    w = l - node,
    librationLatitude = Math.asin(
      -Math.sin(w) * Math.cos(b) * Math.sin(LUNAR_EQUATOR_TILT) - Math.sin(b) * Math.cos(LUNAR_EQUATOR_TILT),
    );
  const x = Math.sin(LUNAR_EQUATOR_TILT) * Math.sin(node),
    y = Math.sin(LUNAR_EQUATOR_TILT) * Math.cos(node) * Math.cos(e) - Math.cos(LUNAR_EQUATOR_TILT) * Math.sin(e);
  return Math.asin((Math.hypot(x, y) * Math.cos(ra - Math.atan2(x, y))) / Math.cos(librationLatitude));
}
// Canvas rotation (radians, clockwise positive) that turns the north-up moon texture to
// the Moon's face as an upright observer sees it: the position angle of the Moon's axis
// from celestial north, less the parallactic angle. The face turns with the Moon's
// axis, not with its bright limb: near full the limb's direction swings with the
// Moon's latitude while the face stays put, and the texture is lit along that axis.
export function moonTilt(
  time: number,
  latitude: number | undefined,
  longitude: number | undefined,
): number | undefined {
  if (!finite(latitude) || !finite(longitude)) return undefined;
  const { dec, hour, phi } = lunarSky(time, latitude, longitude);
  const parallactic = Math.atan2(Math.sin(hour), Math.tan(phi) * Math.cos(dec) - Math.sin(dec) * Math.cos(hour));
  // Both angles run from north toward east, counter-clockwise on the sky; the canvas turns clockwise.
  return parallactic - moonAxis(time);
}
function lunarPosition(time: number) {
  const d = daysSinceJ2000(time),
    e = 23.4397 * RAD;
  const L = (218.316 + 13.176396 * d) * RAD,
    M = (134.963 + 13.064993 * d) * RAD,
    F = (93.272 + 13.22935 * d) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M),
    b = 5.128 * RAD * Math.sin(F);
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra, dec, d, e, l, b };
}
function lunarSky(time: number, latitude: number, longitude: number) {
  const { ra, dec, d } = lunarPosition(time);
  return { ra, dec, phi: latitude * RAD, hour: (280.16 + 360.9856235 * d) * RAD + longitude * RAD - ra };
}

export function seeded(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 2246822507);
    value = Math.imul(value ^ (value >>> 13), 3266489909);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
  };
}

// A bolt is drawn in scene units around the frame's centre, y up. Midpoint displacement:
// split every segment and push its midpoint off it by up to `roughness`, in a random
// direction round the segment (so seen side-on, by the sideways share of that), halve the
// roughness and repeat; seven passes make 129 points.
export type Point = readonly [x: number, y: number];
export const BOLT_POINTS = 129;
function bolt(start: Point, end: Point, roughness: number, random: () => number): Point[] {
  let points: Point[] = [start, end];
  for (let pass = 0; pass < 7; pass++, roughness *= 0.5) {
    const next: Point[] = [start];
    let [ax, ay] = start;
    for (const point of points.slice(1)) {
      const [bx, by] = point,
        length = Math.hypot(bx - ax, by - ay) || 1,
        offset = (random() * 2 - 1) * roughness * Math.cos(random() * Math.PI * 2);
      next.push([(ax + bx) / 2 - ((by - ay) / length) * offset, (ay + by) / 2 + ((bx - ax) / length) * offset], point);
      [ax, ay] = point;
    }
    points = next;
  }
  return points;
}
// One line of a bolt, and how far down the main channel it leaves from (0 for the channel
// itself, else the share of its points above the branch).
export interface BoltLine {
  points: Point[];
  start: number;
}
// A strike's bolt: the main channel from just above the frame's top (25 units up) to just
// above its bottom (23.5 down), starting up to `reach` units either side of the centre and
// ending on the other side, at least 3 units out. Each branch leaves the channel somewhere
// in its upper two thirds and runs a quarter to three quarters of the way towards a point
// up to `spread` either side of the channel's foot, as rough for its length.
export function lightningBolt(
  seed: number,
  { reach, roughness, branches, spread }: { reach: number; roughness: number; branches: number; spread: number },
): BoltLine[] {
  const random = seeded(seed),
    top = 25,
    bottom = -23.5,
    startX = (random() * 2 - 1) * reach,
    endX = startX < 0 ? 3 + random() * (reach - 3) : -(3 + random() * (reach - 3)),
    main = bolt([startX, top], [endX, bottom], roughness, random),
    span = Math.hypot(startX - endX, top - bottom),
    lines: BoltLine[] = [{ points: main, start: 0 }];
  for (let i = 0; i < branches; i++) {
    const at = 12 + Math.floor(random() * 71),
      [x0, y0] = main[at] ?? [startX, top],
      toward = endX + spread * Math.cos(random() * Math.PI * 2),
      share = 0.5 + (random() * 2 - 1) * 0.25,
      x1 = x0 + (toward - x0) * share,
      y1 = y0 + (bottom - y0) * share;
    lines.push({
      points: bolt([x0, y0], [x1, y1], (Math.hypot(x1 - x0, y1 - y0) / span) * roughness, random),
      start: at / BOLT_POINTS,
    });
  }
  return lines;
}

// A storm's light behind the clouds flickers on a clock of its own, apart from the bolts.
// Every two seconds it may come on, at the preset's odds, at a spot of its own in the
// upper sky: up to 20 scene units either side of the middle and 10 to 45 up (y up from the
// frame's centre, at the light's own depth). While on, it follows a fixed ten-second run of
// flickers, `value` (0 dark, 2 brightest), which falls dark at every even second, so each
// two seconds flicker their own way.
const FLICKER: readonly (readonly [seconds: number, value: number])[] = [
  [0, 0],
  [0.342, 1.62],
  [0.665, 0.544],
  [0.804, 1.221],
  [1.293, 0.477],
  [1.432, 2],
  [1.734, 0.271],
  [2, 0],
  [2.137, 0.244],
  [2.324, 2],
  [2.754, 0.819],
  [2.849, 1.218],
  [3.332, 0.235],
  [4, 0],
  [4.117, 0.253],
  [4.36, 1.92],
  [4.891, 0.504],
  [5.126, 0.123],
  [5.596, 0.002],
  [6, 0],
  [6.099, 0.234],
  [6.394, 1.987],
  [6.952, 0.626],
  [7.135, 1.633],
  [7.702, 0.293],
  [8, 0],
  [8.121, 0.303],
  [8.334, 1.932],
  [9.448, 0.268],
  [10, 0],
];
const FLICKER_LOOP = 10,
  FLICKER_SLOT = 2;
export function cloudFlash(seconds: number, odds: number): { value: number; x: number; y: number } | null {
  const slot = Math.floor(seconds / FLICKER_SLOT);
  if (hash(slot, 61) >= odds) return null;
  const at = ((seconds % FLICKER_LOOP) + FLICKER_LOOP) % FLICKER_LOOP,
    next = FLICKER.findIndex(([time]) => time > at),
    [t0, v0] = FLICKER[Math.max(0, next - 1)] ?? [0, 0],
    [t1, v1] = FLICKER[next] ?? [FLICKER_LOOP, 0];
  return {
    value: v0 + ((v1 - v0) * (at - t0)) / (t1 - t0 || 1),
    x: -20 + 40 * hash(slot, 62),
    y: 10 + 35 * hash(slot, 63),
  };
}

// Earth–Moon distance in km from the main periodic terms (within a few hundred km).
export function moonDistance(time = Date.now()): number {
  const d = daysSinceJ2000(time),
    cos = (angle: number) => Math.cos(angle * RAD);
  const Mm = 134.963 + 13.064993 * d,
    Ms = 357.529 + 0.98560028 * d,
    D = 297.85 + 12.190749 * d;
  return (
    385001 -
    20905 * cos(Mm) -
    3699 * cos(2 * D - Mm) -
    2956 * cos(2 * D) -
    570 * cos(2 * Mm) +
    246 * cos(2 * Mm - 2 * D) -
    205 * cos(Ms - 2 * D) -
    171 * cos(Mm + 2 * D) -
    152 * cos(Mm + Ms - 2 * D)
  );
}
// The next time the phase reaches `target` (0 new, .5 full), to the minute, within a month.
const PHASE_SEARCH = 31 * DAY;
export function nextMoonPhase(target: number, time = Date.now()): number | null {
  const offset = (t: number) => (((moonPhase(t) - target) % 1) + 1) % 1;
  let previous = offset(time);
  for (let t = time + HOUR; t < time + PHASE_SEARCH; t += HOUR) {
    const current = offset(t);
    if (current < previous) {
      let low = t - HOUR,
        high = t;
      while (high - low > MINUTE) {
        const middle = (low + high) / 2;
        if (offset(middle) < offset(low)) high = middle;
        else low = middle;
      }
      return high;
    }
    previous = current;
  }
  return null;
}
