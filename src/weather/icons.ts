import { SYMBOLS, warning, type SymbolName } from './symbols.ts';
import { COVER, skyKind, type SkyKindInputs } from '../sky/presets.ts';
import { isCondition } from '../card/home-assistant.ts';
import { glyphs } from '../cards/shared/glyphs.ts';
import { PERCENT } from '../lib/html.ts';
import type { SkyKind } from '../sky/presets-data.ts';
import { convertUnit } from './units.ts';
import { nearestCondition } from './condition-words.ts';
import { windMetersPerSecond } from '../sky/sky.ts';
import { finite } from '../lib/values.ts';

// Each kind of sky as a day and a night symbol. A condition is first refined into its kind by
// the forecast's own numbers (cloud cover, rain rate, temperature, wind), the same way the
// scenery is, so a shower with sun shows a sun behind the rain.
const KIND_SYMBOLS: Readonly<Record<SkyKind, readonly [day: SymbolName, night: SymbolName]>> = {
  clear: ['sun', 'moon'],
  hot: ['hot', 'moon'],
  frigid: ['sun', 'moon'],
  mostlyClear: ['sun', 'moon'],
  partlyCloudyMidAltitude: ['cloud-sun', 'cloud-moon'],
  partlyCloudyLowAltitude: ['cloud-sun', 'cloud-moon'],
  partlyCloudyHighAltitude: ['cloud-sun', 'cloud-moon'],
  // Past partly cloudy the sun or moon no longer shows.
  mostlyCloudyMidAltitude: ['cloud', 'cloud'],
  mostlyCloudyLowAltitude: ['cloud', 'cloud'],
  mostlyCloudyHighAltitude: ['cloud', 'cloud'],
  cloudyMidAltitude: ['cloud', 'cloud'],
  cloudyLowAltitude: ['cloud', 'cloud'],
  cloudyHighAltitude: ['cloud', 'cloud'],
  foggy: ['fog', 'fog'],
  haze: ['sun-haze', 'moon-haze'],
  smoky: ['smoke', 'smoke'],
  drizzle: ['drizzle', 'drizzle'],
  blowingDust: ['wind', 'wind'],
  freezingDrizzle: ['drizzle', 'drizzle'],
  freezingRain: ['sleet', 'sleet'],
  rain: ['rain', 'rain'],
  heavyRain: ['heavy-rain', 'heavy-rain'],
  sunShowers: ['sun-rain', 'moon-rain'],
  snow: ['snow', 'snow'],
  flurries: ['flurries', 'flurries'],
  sunFlurries: ['sun-snow', 'moon-snow'],
  heavySnow: ['heavy-snow', 'heavy-snow'],
  blowingSnow: ['blowing-snow', 'blowing-snow'],
  blizzard: ['blowing-snow', 'blowing-snow'],
  sleet: ['sleet', 'sleet'],
  wintryMix: ['sleet', 'sleet'],
  hail: ['hail', 'hail'],
  isolatedThunderstorms: ['sun-storm', 'moon-storm'],
  scatteredThunderstorms: ['sun-storm-rain', 'moon-storm-rain'],
  thunderstorms: ['storm-rain', 'storm-rain'],
  strongStorms: ['strong-storm', 'strong-storm'],
  hurricane: ['hurricane', 'hurricane'],
  tropicalStorm: ['hurricane', 'hurricane'],
};
// Conditions whose own symbol says more than their sky does.
const CONDITION_SYMBOLS: Readonly<Record<string, SymbolName>> = {
  windy: 'wind',
  'windy-variant': 'wind',
  exceptional: 'warning',
  sunrise: 'sunrise',
  sunset: 'sunset',
};

// An alert's level from its severity, as weather services word it: US-style Minor,
// Moderate, Severe, Extreme, or Europe's green, yellow, orange and red warning levels.
const LEVELS = [
  ['red', /red|extreme/],
  ['orange', /orange|severe/],
  ['yellow', /yellow|moderate/],
  ['green', /green|minor/],
] as const;
export function alertLevel(severity: string | undefined): 'green' | 'yellow' | 'orange' | 'red' {
  const text = (severity ?? '').toLowerCase();
  return LEVELS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'yellow';
}
const RANK = { green: 0, yellow: 1, orange: 2, red: 3 } as const;
const LEVEL_COLOURS = { green: '#059669', yellow: '#facc15', orange: '#f97316', red: '#dc2626' } as const;
// The sign for the most severe of a set of alerts.
export function alertIcon(severities: readonly (string | undefined)[]): string {
  const level = severities
    .map(alertLevel)
    .reduce<'green' | 'yellow' | 'orange' | 'red'>(
      (worst, level) => (RANK[level] > RANK[worst] ? level : worst),
      'green',
    );
  return warning(LEVEL_COLOURS[level]);
}

// A forecast entry's numbers in the units the sky kinds use: °C, m/s, mm, km.
export function iconDetails(
  entry:
    | {
        cloud_coverage?: number | null | undefined;
        precipitation?: number | null | undefined;
        temperature?: number | null | undefined;
        wind_speed?: number | null | undefined;
        visibility?: number | null | undefined;
        dew_point?: number | null | undefined;
        humidity?: number | null | undefined;
      }
    | undefined,
  units: {
    temperature_unit?: unknown;
    wind_speed_unit?: unknown;
    precipitation_unit?: unknown;
    visibility_unit?: unknown;
  },
): SkyKindInputs {
  const unit = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    humidity: finite(entry?.humidity) ? entry.humidity : undefined,
    cloudCover: finite(entry?.cloud_coverage) ? entry.cloud_coverage : undefined,
    precipitation: finite(entry?.precipitation) ? entry.precipitation : undefined,
    precipitationUnit: unit(units.precipitation_unit),
    temperature: finite(entry?.temperature)
      ? convertUnit('temperature_unit', entry.temperature, unit(units.temperature_unit), '°C')
      : undefined,
    windSpeed: finite(entry?.wind_speed)
      ? windMetersPerSecond(entry.wind_speed, unit(units.wind_speed_unit))
      : undefined,
    visibility: finite(entry?.visibility)
      ? convertUnit('distance_unit', entry.visibility, unit(units.visibility_unit), 'km')
      : undefined,
    dewPoint: finite(entry?.dew_point)
      ? convertUnit('temperature_unit', entry.dew_point, unit(units.temperature_unit), '°C')
      : undefined,
  };
}

// The glyph beside a chance, by what's falling (see precipitationSymbol): with nothing named,
// a chance is a chance of rain.
export const PRECIPITATION_GLYPHS = { snow: 'flake', mixed: 'mix', rain: 'drop', none: 'drop' } as const;

// A clear day this hot (°C) shows the heat; snow under less cloud than this (%) still shows
// the sun or moon. The drawn snowflake is three strokes, six arms.
const HOT = 35;
const SUN_SHOWS = COVER.partlyCloudy * PERCENT;
const FLAKE_STROKES = [0, 60, 120] as const;
// The interface's own marks, which aren't weather: the switch's views, and what sits beside a chance.
const mark = (body: string) => `<svg viewBox="0 0 36 36" overflow="visible" aria-hidden="true">${body}</svg>`;
const MARKS: Readonly<Record<string, string>> = {
  conditions: glyphs.conditions,
  wind: glyphs.wind,
  drop: glyphs.precipitation,
  // A small drop and a small flake: rain and snow together.
  mix: mark(
    '<path fill="currentColor" d="M10 8S4 16 4 20a6 6 0 0 0 12 0c0-4-6-12-6-12Z"/><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M26 10v16M19 14l14 8M19 22l14-8"/></g>',
  ),
  // Six arms, each forked near its tip.
  flake: mark(
    `<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${FLAKE_STROKES.map(
      angle => `<path transform="rotate(${angle} 18 18)" d="M18 4v28M14 7.5l4 3.5 4-3.5M14 28.5l4-3.5 4 3.5"/>`,
    ).join('')}</g>`,
  ),
};
const UNKNOWN = mark(
  '<path d="M14 12a5 5 0 0 1 10 1c0 4-6 3-6 8m0 5v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
);

// The symbol for a condition, by day or by night. `details` refines it (see iconDetails): a clear
// day at 35 °C or more shows the heat. Otherwise `condition` may name one of the marks above, or
// be an integration's own words, which take the symbol of the nearest condition and the sky they make.
export function weatherIcon(condition = '', night = false, details?: SkyKindInputs): string {
  const named =
      CONDITION_SYMBOLS[condition] === undefined && MARKS[condition] === undefined
        ? (nearestCondition(condition) ?? condition)
        : condition,
    own = CONDITION_SYMBOLS[named];
  // Exceptional weather is a warning until the readings say what it is.
  if (own && !(named === 'exceptional' && skyKind(condition, details) !== 'hurricane')) return SYMBOLS[own];
  if (!isCondition(named)) return MARKS[named] ?? UNKNOWN;
  // Every other condition has its symbol by the kind of sky it makes.
  const kind = skyKind(condition, details),
    [day, dark] = KIND_SYMBOLS[kind];
  if (!night && kind === 'clear' && finite(details?.temperature) && details.temperature >= HOT) return SYMBOLS.hot;
  // Snow under a sky that still shows the sun or moon, as sun showers are for rain.
  if ((kind === 'snow' || kind === 'flurries') && finite(details?.cloudCover) && details.cloudCover < SUN_SHOWS)
    return SYMBOLS[night ? 'moon-snow' : 'sun-snow'];
  return SYMBOLS[night ? dark : day];
}
