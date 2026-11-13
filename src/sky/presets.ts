import { PRESET_DATA, SUN_PATHS, type SkyKind, type SkyLook } from './presets-data.ts';
import type { TextKey } from '../weather/i18n.ts';
import { mix } from '../lib/canvas.ts';
import { clamp } from './clouds.ts';
import type { Direction } from './cloud-decks.ts';
import { finite } from '../lib/values.ts';
import { DAY, HOURS_PER_DAY } from '../lib/time.ts';
import { UNITS, beaufortFloor, convertUnit } from '../weather/units.ts';
import { CONDITION, type CloudAltitude, isCondition } from '../card/home-assistant.ts';
import { conditionInWords } from '../weather/condition-words.ts';
import { PERCENT } from '../lib/html.ts';
import { HALF_TURN, QUARTER_TURN } from '../lib/compass.ts';

export interface SkyKindInputs {
  cloudCover?: number | undefined;
  cloudAltitude?: CloudAltitude | undefined;
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
// Air rising cools to its dew point about every 125 m for each °C it starts above it, so a sky
// within 4.5 °C of its dew point has its cloud base below some 560 m: low cloud, seen from under it.
const LOW_CLOUD_SPREAD = 4.5;
// Fog thins to mist past a kilometre of visibility, and past 5 km the mist is no longer the
// weather: the sky above it is. Mist is wet air and haze dry, which services report alike as fog,
// so it is haze only where the air is known to be dry: under 80% humidity, or 3 °C or more from
// its dew point.
const MIST = { thins: 1, lifts: 5 } as const;
const DRY = { humidity: 80, spread: 3 } as const;
// A cloudy sky at the height its cloud is, mid where that isn't known.
const ALOFT = { low: 'LowAltitude', mid: 'MidAltitude', high: 'HighAltitude' } as const;
const aloft = (sky: 'partlyCloudy' | 'mostlyCloudy' | 'cloudy', altitude: CloudAltitude | undefined = 'mid'): SkyKind =>
  `${sky}${ALOFT[altitude]}`;
const coverKind = (cover: number, altitude: CloudAltitude | undefined): SkyKind =>
  cover < COVER.clear
    ? 'clear'
    : cover < COVER.mostlyClear
      ? 'mostlyClear'
      : cover < COVER.partlyCloudy
        ? aloft('partlyCloudy', altitude)
        : cover < COVER.mostlyCloudy
          ? aloft('mostlyCloudy', altitude)
          : aloft('cloudy', altitude);
// Kinds of sky, from a Home Assistant condition. Cloud cover splits the fair-weather
// conditions in eighths (12.5, 37.5, 62.5, 87.5%), within what the condition says: a clear sky
// stays clear or mostly clear, a partly cloudy one between mostly clear and mostly cloudy, and a
// cloudy one mostly cloudy or overcast, as the cover can come from a forecast other than the one
// that named the condition. Where the entity reports more, standard definitions refine the condition:
// light precipitation is drizzle or flurries, rain at or below freezing is freezing
// drizzle, or rain any heavier freezing rain, rain under a sky that still shows the sun is sun
// showers, storms under partial cloud are scattered, snow in a strong wind is blowing snow and in a
// gale a blizzard, and "fog" you can see a kilometre through is haze. "exceptional" stands for
// whatever else the service can't name, so the wind and the air say which it is. A condition in an
// integration's own words takes the sky they name, or else the nearest condition's (see
// conditionInWords). `temperature` and `dewPoint` are in °C, `windSpeed` in m/s, `visibility` in km.
export function skyKind(condition: string, inputs: SkyKindInputs = {}): SkyKind {
  if (!isCondition(condition)) {
    const worded = conditionInWords(condition);
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
      return cover !== null && cover >= COVER.clear ? 'mostlyClear' : 'clear';
    // Cloudy skies are drawn at the height that holds the most of their cloud, where that is known.
    case 'partlycloudy':
      if (cover === null) return aloft('partlyCloudy', altitude);
      return cover < COVER.mostlyClear
        ? 'mostlyClear'
        : cover < COVER.partlyCloudy
          ? aloft('partlyCloudy', altitude)
          : aloft('mostlyCloudy', altitude);
    // Where the cloud's height isn't known, a full overcast takes the high sky of soft mottling
    // that most cloudy days show, unless the air is so near its dew point that the cloud must be
    // low: then it's the heaped, darker sky from under a low deck.
    case 'cloudy':
      if (cover !== null && cover < COVER.mostlyCloudy) return aloft('mostlyCloudy', altitude);
      if (altitude !== undefined) return aloft('cloudy', altitude);
      return finite(temperature) && finite(dewPoint) && temperature - dewPoint <= LOW_CLOUD_SPREAD
        ? 'cloudyLowAltitude'
        : 'cloudyHighAltitude';
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
      return 'mostlyClear';
    case 'windy-variant':
      return aloft('mostlyCloudy', altitude);
    case 'exceptional': {
      const hazy = finite(visibility) && visibility < CLEAR_AIR,
        breezy = finite(windSpeed) && windSpeed >= DUST_WIND,
        dry = finite(temperature) && finite(dewPoint) && temperature - dewPoint >= DRY_AIR;
      if (hazy && breezy && dry) return 'blowingDust';
      if (hazy && !breezy) return 'smoky';
      // Otherwise a storm, by its wind, and with no wind to go by the worst. A wind known to be under
      // a tropical storm's is none, and leaves an overcast sky that claims nothing.
      if (!finite(windSpeed) || windSpeed >= STORM.hurricane) return 'hurricane';
      return windSpeed >= STORM.tropical ? 'tropicalStorm' : 'cloudyMidAltitude';
    }
    default:
      return 'cloudyMidAltitude';
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
export const skyPreset = (kind: SkyKind): SkyLook => PRESET_DATA.kinds[kind];

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
// The sky gradient for a kind at a solar elevation: [top, middle, bottom, middle stop].
export function skyGradientFor(
  kind: SkyKind,
  elevation: number,
  rising = true,
): [top: string, middle: string, bottom: string, stop: number] {
  const [[, , top, middle, bottom, stop], [, , toTop, toMiddle, toBottom, toStop], t] = around(
    PRESET_DATA.gradients[skyPreset(kind).sky],
    elevation,
    rising,
  );
  return [mix(top, toTop, t), mix(middle, toMiddle, t), mix(bottom, toBottom, t), stop + (toStop - stop) * t];
}
// Lighting at a solar elevation: sun, ambient and fill colours with intensities, the
// four decks' and blanket's tints and brightness, and star opacity. While the moon shows, a kind
// with light of its own for that (`moonLight`) is lit by it.
export interface Lighting {
  sun: string;
  sunIntensity: number;
  ambient: string;
  ambientIntensity: number;
  fill: string;
  fillIntensity: number;
  clouds: string[];
  brightness: number[];
  stars: number;
  // Where the sun's light on the clouds comes from (see sunDirection).
  direction: Direction;
}
// The way a sun angle lights the clouds: a lamp facing straight into the scene, tipped up by
// `pitch` about the horizontal, then turned by `yaw` about the vertical, both in degrees. By day
// the presets keep it on the viewer's side of the clouds, so their faces are lit, not their rims.
export function sunDirection(pitch: number, yaw: number): Direction {
  const p = (pitch * Math.PI) / HALF_TURN,
    y = (yaw * Math.PI) / HALF_TURN;
  return [-Math.cos(p) * Math.sin(y), Math.sin(p), -Math.cos(p) * Math.cos(y)];
}
export function lightingFor(kind: SkyKind, elevation: number, rising = true, moonlit = false): Lighting {
  const preset = skyPreset(kind),
    [from, to, t] = around((moonlit ? preset.moonLight : undefined) ?? preset.light, elevation, rising),
    [, , sun, sunIntensity, ambient, ambientIntensity, fill, fillIntensity, clouds, brightness, stars, [pitch, yaw]] =
      from,
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
      [toPitch, toYaw],
    ] = to,
    lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    sun: mix(sun, toSun, t),
    sunIntensity: lerp(sunIntensity, toSunIntensity),
    ambient: mix(ambient, toAmbient, t),
    ambientIntensity: lerp(ambientIntensity, toAmbientIntensity),
    fill: mix(fill, toFill, t),
    fillIntensity: lerp(fillIntensity, toFillIntensity),
    clouds: clouds.map((color, i) => mix(color, toClouds[i] ?? color, t)),
    brightness: brightness.map((value, i) => lerp(value, toBrightness[i] ?? value)),
    stars: lerp(stars, toStars),
    // The angles themselves are eased between keyframes, as the presets were tuned.
    direction: sunDirection(lerp(pitch, toPitch), lerp(yaw, toYaw)),
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
}
export function sunPathAt(hour: number, wide = false): SunPosition {
  const path = SUN_PATHS[wide ? 'landscape' : 'portrait'],
    h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  let i = path.findIndex(k => k[0] > h);
  if (i < 1) i = path.length - 1;
  const a = path[i - 1],
    b = path[i];
  if (!a || !b) throw new Error('The sun path has too few keyframes.');
  const [start, [x, y], rayAngle, rainbow, ghosts] = a,
    [end, [toX, toY], toRayAngle, toRainbow, toGhosts] = b,
    t = end === start ? 0 : (h - start) / (end - start),
    lerp = (from: number, to: number) => from + (to - from) * t;
  return {
    x: lerp(x, toX),
    y: lerp(y, toY),
    rayAngle: lerp(rayAngle, toRayAngle),
    rainbow: lerp(rainbow, toRainbow),
    ghosts: Math.round(lerp(ghosts, toGhosts)),
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
  nextRising?: number;
  nextSetting?: number;
  elevation?: number | undefined;
  rising?: boolean;
}
export function solarHour(now: number, { nextRising, nextSetting, elevation, rising = true }: SunTimes = {}): number {
  if (finite(nextRising) && finite(nextSetting)) {
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
