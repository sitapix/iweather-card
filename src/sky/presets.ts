import {
  PRESET_DATA,
  SUN_PATHS,
  type SkyKind,
  type SkyLook,
  type WindowClass,
  type AirTint,
  type PrecipitationTint,
} from './presets-data.ts';
import type { Direction } from './cloud-decks.ts';
import type { TextKey } from '../weather/i18n.ts';
import { alphaHex, CHANNEL_MAX, colorAlpha, mix, toHex, type RGB } from '../lib/canvas.ts';
import { clamp } from './clouds.ts';
import { finite } from '../lib/values.ts';
import { DAY, HOURS_PER_DAY } from '../lib/time.ts';
import { UNITS, beaufortFloor, convertUnit } from '../weather/units.ts';
import { CONDITION, isCloudAltitude, isCondition } from '../card/home-assistant.ts';
import { conditionInWords } from '../weather/condition-words.ts';
import { PERCENT } from '../lib/html.ts';
import { HALF_TURN, QUARTER_TURN } from '../lib/compass.ts';

export interface SkyKindInputs {
  cloudCover?: number | undefined;
  cloudAltitude?: string | undefined;
  precipitation?: number | undefined;
  precipitationUnit?: string | undefined;
  temperature?: number | undefined;
  windSpeed?: number | undefined;
  visibility?: number | undefined;
  dewPoint?: number | undefined;
  humidity?: number | undefined;
}
// Cloud cover in eighths of the sky (oktas), as shares: clear below one, mostly clear below
// three, partly cloudy below five, mostly cloudy below seven, then cloudy. Past partly cloudy
// the sun stops showing; scattered storms cover up to half.
const OKTA = 1 / 8;
export const COVER = {
  clear: OKTA,
  mostlyClear: 3 * OKTA,
  partlyCloudy: 5 * OKTA,
  mostlyCloudy: 7 * OKTA,
  scattered: 4 * OKTA,
} as const;
// Precipitation rates in mm an hour: drizzle and flurries below 0.5, moderate from 2.5, heavy
// from 7.6. Snow lifts and drifts from a strong breeze, Beaufort 6.
export const PRECIPITATION_RATE = { drizzle: 0.5, moderate: 2.5, heavy: 7.6 } as const;
const BLOWING_SNOW = beaufortFloor(6);
// A blizzard is snow on a wind of 35 mph, in a quarter of a mile of visibility or less where that
// is known. Tropical storms start at 34 knots and hurricanes at 64, both in m/s here.
const BLIZZARD = { wind: 15.6, visibility: 0.4 } as const;
const STORM = { tropical: 17.5, hurricane: 33 } as const;
// Past 10 km the air is clear. Under that, a fresh breeze (Beaufort 5) in dry air, 15 °C or more
// above its dew point, is carrying dust; lighter air holds smoke.
const CLEAR_AIR = 10;
const DUST_WIND = beaufortFloor(5);
const DRY_AIR = 15;
// Fog thins to mist past a kilometre of visibility, and past 5 km the mist is no longer the
// weather: the sky above it is. Mist is wet air and haze dry, which services report alike as fog,
// so it is haze only where the air is known to be dry: under 80% humidity, or 3 °C or more from
// its dew point.
const MIST = { thins: 1, lifts: 5 } as const;
const DRY = { humidity: 80, spread: 3 } as const;
// Use the low cloud preset when the provider has no height information.
const ALOFT = { low: 'LowAltitude', mid: 'MidAltitude', high: 'HighAltitude' } as const;
const aloft = (sky: 'partlyCloudy' | 'mostlyCloudy' | 'cloudy', altitude?: string): SkyKind =>
  `${sky}${ALOFT[isCloudAltitude(altitude) ? altitude : 'low']}`;
const coverKind = (cover: number, altitude: string | undefined): SkyKind =>
  cover < COVER.clear
    ? 'clear'
    : cover < COVER.mostlyClear
      ? 'mostlyClear'
      : cover < COVER.partlyCloudy
        ? aloft('partlyCloudy', altitude)
        : cover < COVER.mostlyCloudy
          ? aloft('mostlyCloudy', altitude)
          : aloft('cloudy', altitude);
// Named conditions select their own sky. Wind with measured cover uses the five cloud bands.
// Home Assistant groups several kinds of precipitation, fog and exceptional weather under
// broad names. Use the available measurements to refine those groups.
export function skyKind(condition: string, inputs: SkyKindInputs = {}): SkyKind {
  if (!isCondition(condition)) {
    const worded = conditionInWords(condition);
    if (worded?.kind === 'mostlyCloudy') return aloft('mostlyCloudy', inputs.cloudAltitude);
    if (worded !== undefined) return worded.kind ?? skyKind(worded.condition, inputs);
  }
  const {
    cloudCover,
    cloudAltitude: altitude,
    precipitation,
    precipitationUnit,
    temperature,
    windSpeed,
    visibility,
    dewPoint,
    humidity,
  } = inputs;
  const cover = finite(cloudCover) ? cloudCover / PERCENT : null;
  // A reported 0 while it rains or snows says nothing about how hard, so only amounts
  // above zero make drizzle or flurries.
  const rate = finite(precipitation)
      ? convertUnit('precipitation_unit', precipitation, precipitationUnit, UNITS.millimeters)
      : null,
    light = rate !== null && rate > 0 && rate < PRECIPITATION_RATE.drizzle;
  switch (isCondition(condition) ? condition : undefined) {
    case 'sunny':
    case 'clear-night':
      return 'clear';
    case 'partlycloudy':
      return aloft('partlyCloudy', altitude);
    case 'cloudy':
      return aloft('cloudy', altitude);
    // The international lines between fog, mist and none: 1 and 5 km of visibility. Past them the
    // sky shows as its cover, and a full one or none reported as a low deck, which mist lies under.
    case 'fog': {
      if (!finite(visibility) || visibility < MIST.thins) return 'foggy';
      if (visibility >= MIST.lifts)
        return cover === null || cover >= COVER.mostlyCloudy ? 'cloudyLowAltitude' : coverKind(cover, altitude);
      const dry = finite(humidity)
        ? humidity < DRY.humidity
        : finite(temperature) && finite(dewPoint) && temperature - dewPoint >= DRY.spread;
      return dry ? 'haze' : 'foggy';
    }
    // Under 0.5 mm an hour is drizzle, frozen or not. Past partly cloudy (62.5%) the sun
    // stops showing.
    case 'rainy':
      if (finite(temperature) && temperature <= 0) return light ? 'freezingDrizzle' : 'freezingRain';
      if (cover !== null && cover < COVER.partlyCloudy) return 'sunShowers';
      return light ? 'drizzle' : 'rain';
    case 'pouring':
      return 'heavyRain';
    // Lightning without rain is an isolated thunderstorm: strikes, no rain layer.
    case 'lightning':
      return 'isolatedThunderstorms';
    // Scattered thunderstorms cover up to half the area.
    case 'lightning-rainy':
      return rate !== null && rate > PRECIPITATION_RATE.heavy
        ? 'strongStorms'
        : cover !== null && cover <= COVER.scattered
          ? 'scatteredThunderstorms'
          : 'thunderstorms';
    // Snow lifts and drifts from a strong breeze (Beaufort 6, 10.8 m/s).
    case 'snowy':
      if (finite(windSpeed) && windSpeed >= BLIZZARD.wind && (!finite(visibility) || visibility <= BLIZZARD.visibility))
        return 'blizzard';
      if (finite(windSpeed) && windSpeed >= BLOWING_SNOW) return 'blowingSnow';
      return rate !== null && rate > PRECIPITATION_RATE.moderate ? 'heavySnow' : light ? 'flurries' : 'snow';
    case 'snowy-rainy':
      return 'wintryMix';
    case 'hail':
      return 'hail';
    case 'windy':
      return cover === null ? 'mostlyClear' : coverKind(cover, altitude);
    case 'windy-variant':
      return cover === null ? aloft('mostlyCloudy', altitude) : coverKind(cover, altitude);
    case 'exceptional': {
      const hazy = finite(visibility) && visibility < CLEAR_AIR,
        breezy = finite(windSpeed) && windSpeed >= DUST_WIND,
        dry = finite(temperature) && finite(dewPoint) && temperature - dewPoint >= DRY_AIR;
      if (hazy && breezy && dry) return 'blowingDust';
      if (hazy && !breezy) return 'smoky';
      // Otherwise a storm, by its wind, and with no wind to go by the worst. A wind known to be under
      // a tropical storm's is none, and leaves an overcast sky that claims nothing.
      if (!finite(windSpeed) || windSpeed >= STORM.hurricane) return 'hurricane';
      return windSpeed >= STORM.tropical ? 'tropicalStorm' : aloft('cloudy', altitude);
    }
    default:
      return aloft('cloudy', altitude);
  }
}
// Names for the kinds a Home Assistant condition doesn't name itself, as keys of
// the interface text (the rest keep Home Assistant's translated condition).
export const KIND_LABELS: Readonly<Partial<Record<SkyKind, TextKey>>> = {
  drizzle: 'drizzle',
  flurries: 'flurries',
  blowingSnow: 'blowing_snow',
  blizzard: 'blizzard',
  freezingDrizzle: 'freezing_drizzle',
  freezingRain: 'freezing_rain',
  blowingDust: 'blowing_dust',
  smoky: 'smoke',
  tropicalStorm: 'tropical_storm',
  hurricane: 'hurricane',
  sunShowers: 'sun_showers',
  scatteredThunderstorms: 'scattered_thunderstorms',
  haze: 'haze',
  mostlyClear: 'mostly_sunny',
  mostlyCloudyMidAltitude: 'mostly_cloudy',
  mostlyCloudyLowAltitude: 'mostly_cloudy',
  mostlyCloudyHighAltitude: 'mostly_cloudy',
};
// The condition a sky of fog that has thinned to nothing is named by: the cover it has left.
export function liftedCondition(kind: SkyKind, night: boolean): string | undefined {
  if (kind === 'foggy' || kind === 'haze') return undefined;
  if (kind === 'clear') return night ? CONDITION.clearNight : CONDITION.sunny;
  return kind.startsWith('cloudy') ? CONDITION.cloudy : CONDITION.partlyCloudy;
}
// By night a clear sky is clear, not sunny, and a mostly clear one mostly clear.
export const NIGHT_LABELS: Readonly<Partial<Record<SkyKind, TextKey>>> = {
  clear: 'clear',
  mostlyClear: 'mostly_clear',
};
const WINDOW_WIDTH = { compact: 465, regular: 1133, ultrawide: 1800 } as const;
const SCREEN_CUTOFFS: ReadonlySet<number> = new Set([1024, 1080, 1112]);

export function skyWindowClass(width: number, height: number, screenLongSide?: number): WindowClass {
  if (width < WINDOW_WIDTH.compact) return 'compact';
  if (width >= WINDOW_WIDTH.ultrawide) return 'ultrawide';
  const regular =
    screenLongSide !== undefined && SCREEN_CUTOFFS.has(screenLongSide) ? screenLongSide : WINDOW_WIDTH.regular;
  if (width >= regular) return 'landscapeRegular';
  if (height < WINDOW_WIDTH.compact && width > height) return 'compactLandscape';
  return 'portraitRegular';
}

export const skyPreset = (kind: SkyKind, windowClass: WindowClass = 'compact'): SkyLook =>
  PRESET_DATA.windows[windowClass][kind];

// Keyframes run from midnight (-90°) up to noon and back down for the afternoon.
// A position along that day cycle lets morning and evening stops interpolate apart.
const position = (elevation: number, pm: boolean | 0 | 1) =>
  pm === true || pm === 1 ? HALF_TURN - elevation : elevation;
type Keyframe = readonly [elevation: number, pm: 0 | 1, ...rest: unknown[]];
function around<K extends Keyframe>(
  list: readonly K[],
  elevation: number,
  rising: boolean,
): [before: K, after: K, t: number] {
  const at = position(clamp(elevation, -QUARTER_TURN, QUARTER_TURN), !rising),
    keyed = list.map(item => [position(item[0], item[1]), item] as const).sort((a, b) => a[0] - b[0]);
  let before = keyed[0],
    after = keyed.at(-1);
  if (!before || !after) throw new Error('A sky preset has no keyframes.');
  for (const entry of keyed) {
    if (entry[0] <= at) before = entry;
    if (entry[0] >= at) {
      after = entry;
      break;
    }
  }
  const t = after[0] === before[0] ? 0 : (at - before[0]) / (after[0] - before[0]);
  return [before[1], after[1], clamp(t)];
}
const TILE_EDGE_SHARE = 0.14;
const TILE_MIDPOINT = 0.5;
// The sky gradient for a kind at a solar elevation: [top, middle, bottom, middle stop].
export function skyGradientFor(
  kind: SkyKind,
  elevation: number,
  rising = true,
  tile = false,
): [top: string, middle: string, bottom: string, stop: number] {
  const [[, , top, middle, bottom, stop], [, , toTop, toMiddle, toBottom, toStop], t] = around(
    PRESET_DATA.gradients[skyPreset(kind).sky],
    elevation,
    rising,
  );
  const blend = (a: RGB, b: RGB, share: number): RGB => [
      a[0] + (b[0] - a[0]) * share,
      a[1] + (b[1] - a[1]) * share,
      a[2] + (b[2] - a[2]) * share,
    ],
    first = blend(top, toTop, t),
    center = blend(middle, toMiddle, t),
    last = blend(bottom, toBottom, t);
  if (tile) {
    // Mix in the interpolated channels before quantizing the final display colours.
    const upper = blend(center, first, TILE_EDGE_SHARE),
      lower = blend(center, last, TILE_EDGE_SHARE),
      display = (color: RGB) => toHex(color.map(channel => Math.fround(channel / CHANNEL_MAX) * CHANNEL_MAX));
    return [display(upper), display(blend(upper, lower, TILE_MIDPOINT)), display(lower), TILE_MIDPOINT];
  }
  return [toHex(first), toHex(center), toHex(last), stop + (toStop - stop) * t];
}
// Lighting at a solar elevation: sun, ambient and fill colours with intensities, the
// four decks' and blanket's tints and brightness, and star opacity. While the moon shows, a kind
// with light of its own for that (`moonLight`) is lit by it.
export interface Lighting {
  air: AirTint;
  precipitation: PrecipitationTint;
  sun: string;
  sunIntensity: number;
  ambient: string;
  ambientIntensity: number;
  fill: string;
  fillIntensity: number;
  clouds: string[];
  brightness: number[];
  cloudAlpha: number[];
  sunAngle: [number, number, number];
  direction: Direction;
  moonIntensity: number;
  moonRadius: number;
  moonColor: string;
  moonHorizon: string;
  stars: number;
}
// The way a sun angle lights the clouds: a lamp facing straight into the scene, tipped up by
// `pitch` about the horizontal, then turned by `yaw` about the vertical, both in degrees. By day
// the presets keep it on the viewer's side of the clouds, so their faces are lit, not their rims.
export function sunDirection(pitch: number, yaw: number): Direction {
  const p = (pitch * Math.PI) / HALF_TURN,
    y = (yaw * Math.PI) / HALF_TURN;
  return [-Math.cos(p) * Math.sin(y), Math.sin(p), -Math.cos(p) * Math.cos(y)];
}
export function lightingFor(
  kind: SkyKind,
  elevation: number,
  rising = true,
  moonlit = false,
  windowClass: WindowClass = 'compact',
): Lighting {
  const preset = skyPreset(kind, windowClass),
    [from, to, t] = around((moonlit ? preset.moonLight : undefined) ?? preset.light, elevation, rising),
    [
      ,
      ,
      sun,
      sunIntensity,
      ambient,
      ambientIntensity,
      fill,
      fillIntensity,
      clouds,
      brightness,
      stars,
      alpha,
      angle,
      moonIntensity,
      moonRadius,
      moonColor,
      moonHorizon,
      precipitation,
      air,
    ] = from,
    [
      ,
      ,
      toSun,
      toSunIntensity,
      toAmbient,
      toAmbientIntensity,
      toFill,
      toFillIntensity,
      toClouds,
      toBrightness,
      toStars,
      toAlpha,
      toAngle,
      toMoonIntensity,
      toMoonRadius,
      toMoonColor,
      toMoonHorizon,
      toPrecipitation,
      toAir,
    ] = to,
    lerp = (x: number, y: number) => x + (y - x) * t;
  const sunAngle: Lighting['sunAngle'] = [
    lerp(angle[0], toAngle[0]),
    lerp(angle[1], toAngle[1]),
    lerp(angle[2], toAngle[2]),
  ];
  const color = (a: string, b: string): string => mix(a, b, t) + alphaHex(lerp(colorAlpha(a), colorAlpha(b)));
  const pair = (a: readonly [string, string], b: readonly [string, string]): readonly [string, string] => [
    color(a[0], b[0]),
    color(a[1], b[1]),
  ];
  const fall = (key: 'rain' | 'snow' | 'sleet') => ({
    front: pair(precipitation[key].front, toPrecipitation[key].front),
    back: pair(precipitation[key].back, toPrecipitation[key].back),
  });
  return {
    sun: mix(sun, toSun, t),
    sunIntensity: lerp(sunIntensity, toSunIntensity),
    ambient: mix(ambient, toAmbient, t),
    ambientIntensity: lerp(ambientIntensity, toAmbientIntensity),
    fill: mix(fill, toFill, t),
    fillIntensity: lerp(fillIntensity, toFillIntensity),
    clouds: clouds.map((color, i) => mix(color, toClouds[i] ?? color, t)),
    brightness: brightness.map((v, i) => lerp(v, toBrightness[i] ?? v)),
    stars: lerp(stars, toStars),
    cloudAlpha: alpha.map((v, i) => lerp(v, toAlpha[i] ?? v)),
    sunAngle,
    direction: sunDirection(sunAngle[0], sunAngle[1]),
    moonIntensity: lerp(moonIntensity, toMoonIntensity),
    moonRadius: lerp(moonRadius, toMoonRadius),
    moonColor: mix(moonColor, toMoonColor, t),
    moonHorizon: mix(moonHorizon, toMoonHorizon, t),
    air: {
      near: pair(air.near, toAir.near),
      noise: pair(air.noise, toAir.noise),
      fringe: color(air.fringe, toAir.fringe),
    },
    precipitation: {
      rain: fall('rain'),
      snow: fall('snow'),
      sleet: fall('sleet'),
      hail: pair(precipitation.hail, toPrecipitation.hail),
    },
  };
}

// Where a sky body sits at a solar hour (6 sunrise, 12 noon, 18 sunset):
// [x, y] as shares of the open sky, the ray angle, rainbow strength and ghost count.
export interface SunPosition {
  x: number;
  y: number;
  rayAngle: number;
  rainbow: number;
  ghosts: number;
  color: string;
  alpha: number;
  irisLength: number;
  irisFrequency: number;
  irisAmplitude: number;
}
export function sunPathAt(hour: number, window: WindowClass | boolean = 'compact'): SunPosition {
  const path = SUN_PATHS[typeof window === 'boolean' ? (window ? 'landscapeRegular' : 'compact') : window],
    h = finite(hour) ? hour : SOLAR.noon;
  let i = path.findIndex(k => k[0] > h);
  if (i < 0) i = path.length - 1;
  const a = path[Math.max(0, i - 1)],
    b = path[i];
  if (!a || !b) throw new Error('The sun path has too few keyframes.');
  const [start, [x, y], rayAngle, rainbow, ghosts, color, irisLength, irisFrequency, irisAmplitude] = a,
    [end, [toX, toY], toRayAngle, toRainbow, toGhosts, toColor, toLength, toFrequency, toAmplitude] = b,
    t = end === start ? 0 : clamp((h - start) / (end - start)),
    lerp = (from: number, to: number) => from + (to - from) * t;
  return {
    x: lerp(x, toX),
    y: lerp(y, toY),
    rayAngle: lerp(rayAngle, toRayAngle),
    rainbow: lerp(rainbow, toRainbow),
    ghosts: Math.trunc(lerp(ghosts, toGhosts)),
    color: mix(color, toColor, t),
    alpha: lerp(colorAlpha(color), colorAlpha(toColor)),
    irisLength: lerp(irisLength, toLength),
    irisFrequency: lerp(irisFrequency, toFrequency),
    irisAmplitude: lerp(irisAmplitude, toAmplitude),
  };
}
// Solar hour from sun.sun's next sunrise and sunset: today's daylight maps to 6–18
// and the night to 18–30. Without them, an estimate from elevation and direction: the sun
// taken 40° up, climbing to noon at 55°, and half an hour from sunrise or sunset below the
// horizon.
const SOLAR = { sunrise: 6, noon: 12, sunset: 18 } as const;
const HALF_DAY = SOLAR.sunset - SOLAR.sunrise;
const ESTIMATE = { elevation: 40, noon: 55, twilight: 0.5 } as const;
export interface SunTimes {
  sunrise?: number | undefined;
  sunset?: number | undefined;
  nextRising?: number;
  nextSetting?: number;
  elevation?: number | undefined;
  rising?: boolean;
}
export function solarHour(
  now: number,
  { sunrise, sunset, nextRising, nextSetting, elevation, rising = true }: SunTimes = {},
): number {
  // A supplied day's crossings keep elapsed daylight correct across longitudes and DST.
  if (finite(sunrise) && finite(sunset) && sunset > sunrise && sunset - sunrise <= DAY) {
    return SOLAR.sunrise + HALF_DAY * ((now - sunrise) / (sunset - sunrise));
  }
  // HA next-event timestamps can be months apart near the poles. Keep that case on
  // the bounded elevation path instead of stretching a single day over the season.
  if (
    finite(nextRising) &&
    finite(nextSetting) &&
    finite(now) &&
    nextRising >= now &&
    nextSetting >= now &&
    nextRising - now <= DAY &&
    nextSetting - now <= DAY &&
    nextRising !== nextSetting
  ) {
    if (nextSetting < nextRising) {
      const sunrise = nextRising - DAY;
      return SOLAR.sunrise + HALF_DAY * clamp((now - sunrise) / (nextSetting - sunrise));
    }
    const sunset = nextSetting - DAY;
    return (SOLAR.sunset + HALF_DAY * clamp((now - sunset) / (nextRising - sunset))) % HOURS_PER_DAY;
  }
  const e = finite(elevation) ? elevation : ESTIMATE.elevation,
    share = clamp(e / ESTIMATE.noon) * (SOLAR.noon - SOLAR.sunrise);
  return e < 0
    ? rising
      ? SOLAR.sunrise - ESTIMATE.twilight
      : SOLAR.sunset + ESTIMATE.twilight
    : rising
      ? SOLAR.sunrise + share
      : SOLAR.sunset - share;
}
