import { convertUnit, UNITS } from '../../weather/units.ts';
import { finite } from '../../lib/values.ts';
import { windMetersPerSecond } from '../../sky/sky.ts';
import type { Series } from '../../sheets/series.ts';
export const fahrenheit = (value: number, unit: string | undefined) =>
  convertUnit('temperature_unit', value, unit, UNITS.fahrenheit);
const MPS_PER_MPH = 0.44704;

// The readings feels-like is worked out from: an entity's attributes, a forecast hour
// with the entity's units, or attributes from history, so each is checked as read.
export interface FeelsLikeReadings {
  apparent_temperature?: unknown;
  temperature?: unknown;
  temperature_unit?: unknown;
  humidity?: unknown;
  wind_speed?: unknown;
  wind_speed_unit?: unknown;
}
// Feels-like from the provider when supplied; otherwise the US National Weather
// Service heat index and wind chill, which the tile labels as estimated. The heat index is
// the Rothfusz regression, from 80 °F with a humidity; wind chill applies at 50 °F and below
// in wind over 3 mph.
const HEAT_INDEX = {
  from: 80,
  c: [-42.379, 2.04901523, 10.14333127, -0.22475541, -0.00683783, -0.05481717, 0.00122874, 0.00085282, -0.00000199],
} as const;
const WIND_CHILL = { below: 50, calm: 3, c: [35.74, 0.6215, -35.75, 0.4275], power: 0.16 } as const;
export function feelsLike(attrs: FeelsLikeReadings): { value: number; estimated: boolean } | null {
  if (finite(attrs.apparent_temperature)) return { value: attrs.apparent_temperature, estimated: false };
  if (!finite(attrs.temperature)) return null;
  const unit = typeof attrs.temperature_unit === 'string' ? attrs.temperature_unit : undefined,
    t = fahrenheit(attrs.temperature, unit),
    rh = attrs.humidity;
  const speed = attrs.wind_speed,
    speedUnit = typeof attrs.wind_speed_unit === 'string' ? attrs.wind_speed_unit : undefined;
  // In mph, through m/s (Beaufort forces are not proportional to speed).
  const wind = finite(speed) ? windMetersPerSecond(speed, speedUnit) / MPS_PER_MPH : null;
  let f = t;
  if (t >= HEAT_INDEX.from && finite(rh)) {
    const [c1, c2, c3, c4, c5, c6, c7, c8, c9] = HEAT_INDEX.c;
    f =
      c1 +
      c2 * t +
      c3 * rh +
      c4 * t * rh +
      c5 * t * t +
      c6 * rh * rh +
      c7 * t * t * rh +
      c8 * t * rh * rh +
      c9 * t * t * rh * rh;
  } else if (t <= WIND_CHILL.below && finite(wind) && wind > WIND_CHILL.calm) {
    const [c1, c2, c3, c4] = WIND_CHILL.c,
      chill = wind ** WIND_CHILL.power;
    f = c1 + c2 * t + c3 * chill + c4 * t * chill;
  }
  return { value: convertUnit('temperature_unit', f, UNITS.fahrenheit, unit), estimated: true };
}

// air quality bad enough to matter first (rank 0); then feels-like 5 °F (2.8 °C) or more from
// the temperature, and the averages on an unusual day, a high outside its normal range (rank 1);
// then the rest (rank 2).
export const FEELS_APART = 5;
// How it feels now, when that is far enough from the temperature to mention; else null.
export function feltApart(
  attrs: FeelsLikeReadings & { temperature?: number | undefined; temperature_unit?: string | undefined },
): number | null {
  const feels = feelsLike(attrs),
    unit = attrs.temperature_unit;
  return feels &&
    finite(attrs.temperature) &&
    Math.abs(fahrenheit(feels.value, unit) - fahrenheit(attrs.temperature, unit)) >= FEELS_APART
    ? feels.value
    : null;
}
export const feelsSeries: Series = {
  hour: (entry, attrs) =>
    feelsLike({ ...entry, temperature_unit: attrs.temperature_unit, wind_speed_unit: attrs.wind_speed_unit })?.value,
  reading: attrs => feelsLike(attrs)?.value,
  withActual: true,
  derived: true,
};
