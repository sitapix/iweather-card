import type { EntityAttributes, EntityState, ForecastEntry } from '../card/home-assistant.ts';
import { finite } from '../lib/values.ts';
import { phrase } from './words.ts';

// Display units, as a weather app's settings offer them: each kind of value either
// follows the weather entity ('auto', which Home Assistant already converts to the
// system's units) or is converted to a chosen unit. The card converts the entity's
// attributes and its forecasts once, on the way in, and rewrites their *_unit
// attributes, so everything downstream reads converted values with matching labels.

export const UNIT_KIND_NAMES = [
  'temperature_unit',
  'wind_speed_unit',
  'precipitation_unit',
  'pressure_unit',
  'distance_unit',
] as const;
export type UnitKind = (typeof UNIT_KIND_NAMES)[number];
// Readings a kind converts, as entity attributes and forecast entries name them.
export type ConvertedField =
  | 'temperature'
  | 'templow'
  | 'apparent_temperature'
  | 'dew_point'
  | 'wind_speed'
  | 'wind_gust_speed'
  | 'precipitation'
  | 'pressure'
  | 'visibility';
export interface UnitKindInfo {
  attribute: 'temperature_unit' | 'wind_speed_unit' | 'precipitation_unit' | 'pressure_unit' | 'visibility_unit';
  fields: readonly ConvertedField[];
  options: readonly (readonly [unit: string, label: string])[];
}
// Each kind's setting: 'auto' or a unit it offers.
export type UnitSettings = Partial<Record<UnitKind, string>>;

// The units, as Home Assistant and the card's options spell them. Home Assistant names the
// Beaufort scale 'Beaufort'; the card's option is 'bft'.
export const UNITS = {
  celsius: '°C',
  fahrenheit: '°F',
  kelvin: 'K',
  metersPerSecond: 'm/s',
  kilometersPerHour: 'km/h',
  milesPerHour: 'mph',
  knots: 'kn',
  feetPerSecond: 'ft/s',
  beaufort: 'bft',
  beaufortScale: 'Beaufort',
  millimeters: 'mm',
  centimeters: 'cm',
  inches: 'in',
  hectopascals: 'hPa',
  millibars: 'mbar',
  pascals: 'Pa',
  kilopascals: 'kPa',
  inchesOfMercury: 'inHg',
  millimetersOfMercury: 'mmHg',
  poundsPerSquareInch: 'psi',
  kilometers: 'km',
  meters: 'm',
  miles: 'mi',
  feet: 'ft',
} as const;
// A setting that follows the weather entity's own unit.
export const AUTO = 'auto';

// Card option, entity attribute holding the source unit, the values it applies to,
// and the units offered (value, label).
export const UNIT_KINDS: Readonly<Record<UnitKind, UnitKindInfo>> = {
  temperature_unit: {
    attribute: 'temperature_unit',
    fields: ['temperature', 'templow', 'apparent_temperature', 'dew_point'],
    options: [
      [UNITS.celsius, phrase('Celsius (°C)')],
      [UNITS.fahrenheit, phrase('Fahrenheit (°F)')],
    ],
  },
  wind_speed_unit: {
    attribute: 'wind_speed_unit',
    fields: ['wind_speed', 'wind_gust_speed'],
    options: [
      [UNITS.milesPerHour, phrase('Miles per hour (mph)')],
      [UNITS.kilometersPerHour, phrase('Kilometers per hour (km/h)')],
      [UNITS.metersPerSecond, phrase('Meters per second (m/s)')],
      [UNITS.beaufort, phrase('Beaufort (bft)')],
      [UNITS.knots, phrase('Knots (kn)')],
    ],
  },
  precipitation_unit: {
    attribute: 'precipitation_unit',
    fields: ['precipitation'],
    options: [
      [UNITS.inches, phrase('Inches (in)')],
      [UNITS.millimeters, phrase('Millimeters (mm)')],
    ],
  },
  pressure_unit: {
    attribute: 'pressure_unit',
    fields: ['pressure'],
    options: [
      [UNITS.millibars, phrase('Millibars (mbar)')],
      [UNITS.inchesOfMercury, phrase('Inches of mercury (inHg)')],
      [UNITS.millimetersOfMercury, phrase('Millimeters of mercury (mmHg)')],
      [UNITS.hectopascals, phrase('Hectopascals (hPa)')],
      [UNITS.kilopascals, phrase('Kilopascals (kPa)')],
    ],
  },
  distance_unit: {
    attribute: 'visibility_unit',
    fields: ['visibility'],
    options: [
      [UNITS.miles, phrase('Miles (mi)')],
      [UNITS.kilometers, phrase('Kilometers (km)')],
    ],
  },
};
// Every kind follows the weather entity unless the card says otherwise.
export const UNIT_DEFAULTS: Readonly<Record<UnitKind, typeof AUTO>> = {
  temperature_unit: AUTO,
  wind_speed_unit: AUTO,
  precipitation_unit: AUTO,
  pressure_unit: AUTO,
  distance_unit: AUTO,
};
const choices = (kind: UnitKind): readonly string[] => [AUTO, ...UNIT_KINDS[kind].options.map(([value]) => value)];
export const UNIT_CHOICES: Readonly<Record<UnitKind, readonly string[]>> = {
  temperature_unit: choices('temperature_unit'),
  wind_speed_unit: choices('wind_speed_unit'),
  precipitation_unit: choices('precipitation_unit'),
  pressure_unit: choices('pressure_unit'),
  distance_unit: choices('distance_unit'),
};

type Converter = (value: number, from: string, to: string) => number | null;
// Each kind through a base unit: kelvin offsets aside, a factor to the base. Water freezes at
// 32 °F, and a degree Celsius is nine fifths of a Fahrenheit one; 0 °C is 273.15 K.
const FREEZING_F = 32,
  F_PER_C = 9 / 5,
  ZERO_C_IN_K = 273.15;
const TEMPERATURE: {
  toC: Readonly<Record<string, (value: number) => number>>;
  fromC: Readonly<Record<string, (value: number) => number>>;
} = {
  toC: {
    [UNITS.celsius]: v => v,
    [UNITS.fahrenheit]: v => (v - FREEZING_F) / F_PER_C,
    [UNITS.kelvin]: v => v - ZERO_C_IN_K,
  },
  fromC: {
    [UNITS.celsius]: v => v,
    [UNITS.fahrenheit]: v => v * F_PER_C + FREEZING_F,
    [UNITS.kelvin]: v => v + ZERO_C_IN_K,
  },
};
export const METERS_PER_SECOND: Readonly<Record<string, number>> = {
  [UNITS.metersPerSecond]: 1,
  [UNITS.kilometersPerHour]: 1 / 3.6,
  [UNITS.milesPerHour]: 0.44704,
  [UNITS.knots]: 0.514444,
  [UNITS.feetPerSecond]: 0.3048,
};
const MILLIMETERS: Readonly<Record<string, number>> = {
  [UNITS.millimeters]: 1,
  [UNITS.centimeters]: 10,
  [UNITS.inches]: 25.4,
};
const HECTOPASCALS: Readonly<Record<string, number>> = {
  [UNITS.hectopascals]: 1,
  [UNITS.millibars]: 1,
  [UNITS.pascals]: 0.01,
  [UNITS.kilopascals]: 10,
  [UNITS.inchesOfMercury]: 33.8639,
  [UNITS.millimetersOfMercury]: 1.33322,
  [UNITS.poundsPerSquareInch]: 68.9476,
};
const KILOMETERS: Readonly<Record<string, number>> = {
  [UNITS.kilometers]: 1,
  [UNITS.meters]: 0.001,
  [UNITS.miles]: 1.609344,
  [UNITS.feet]: 0.0003048,
};
// Beaufort scale upper limits in m/s (force 0 is calm, below .5 m/s); past the last is
// force 12, a hurricane. A force stands for 0.836 × B^1.5 m/s.
export const BEAUFORT_LIMITS = [0.5, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
const BEAUFORT = { factor: 0.836, power: 1.5 } as const;
export const beaufortSpeed = (force: number): number => BEAUFORT.factor * Math.max(0, force) ** BEAUFORT.power;
// The least wind speed in m/s of a Beaufort force.
export const beaufortFloor = (force: number): number => BEAUFORT_LIMITS[force - 1] ?? 0;
// Whether a unit is the Beaufort scale, by either spelling.
export const isBeaufort = (unit: string | undefined): boolean =>
  unit === UNITS.beaufort || unit === UNITS.beaufortScale;

const scaled =
  (table: Readonly<Record<string, number>>): Converter =>
  (value, from, to) => {
    const source = table[from],
      target = table[to];
    return source !== undefined && target !== undefined ? (value * source) / target : null;
  };
const CONVERT: Readonly<Record<UnitKind, Converter>> = {
  temperature_unit: (value, from, to) => {
    const toC = TEMPERATURE.toC[from],
      fromC = TEMPERATURE.fromC[to];
    return toC && fromC ? fromC(toC(value)) : null;
  },
  wind_speed_unit: (value, from, to) => {
    const factor = METERS_PER_SECOND[from],
      ms = isBeaufort(from) ? beaufortSpeed(value) : factor !== undefined ? value * factor : null;
    if (ms === null) return null;
    if (isBeaufort(to)) {
      const force = BEAUFORT_LIMITS.findIndex(limit => ms < limit);
      return force < 0 ? BEAUFORT_LIMITS.length : force;
    }
    const target = METERS_PER_SECOND[to];
    return target !== undefined ? ms / target : null;
  },
  precipitation_unit: scaled(MILLIMETERS),
  pressure_unit: scaled(HECTOPASCALS),
  distance_unit: scaled(KILOMETERS),
};

// The card's spelling of a unit, so Home Assistant's 'Beaufort' matches the option 'bft'.
const same = (unit: string): string => (isBeaufort(unit) ? UNITS.beaufort : unit);
// One value from `from` to `to`; the value unchanged when the units match or either is
// unknown, so whatever an integration reports is never recalculated needlessly.
// A rate's "per hour", as in mm/h: what is left converts as an amount.
export const PER_HOUR = /\s*\/\s*h$/i;
export function convertUnit(kind: UnitKind, value: number, from: string | undefined, to: string | undefined): number {
  if (!finite(value) || !from || !to || same(from) === same(to)) return value;
  const result = CONVERT[kind](value, from, to);
  return finite(result) ? result : value;
}

interface Step {
  key: UnitKind;
  kind: UnitKindInfo;
  from: string;
  to: string;
}
// The kinds the config converts, each with its source unit from the entity and its target.
function plan(attrs: Readonly<Record<string, unknown>> | undefined, config: UnitSettings | undefined): Step[] {
  return UNIT_KIND_NAMES.flatMap(key => {
    const kind = UNIT_KINDS[key],
      from = attrs?.[kind.attribute],
      to = config?.[key];
    // Only when both units are known; otherwise the entity's own values and label stay.
    return to &&
      to !== AUTO &&
      typeof from === 'string' &&
      from &&
      same(from) !== same(to) &&
      finite(CONVERT[key](1, from, to))
      ? [{ key, kind, from, to }]
      : [];
  });
}
// The planned conversions, applied in place to attributes or a forecast entry; `label`
// rewrites the *_unit attributes to match.
function apply(target: Record<string, unknown>, steps: readonly Step[], label: boolean): void {
  for (const { key, kind, from, to } of steps) {
    for (const field of kind.fields) {
      const value = target[field];
      if (finite(value)) target[field] = convertUnit(key, value, from, to);
    }
    if (label) target[kind.attribute] = to;
  }
}
const converting = (config: UnitSettings | undefined): boolean =>
  UNIT_KIND_NAMES.some(key => Boolean(config?.[key]) && config?.[key] !== AUTO);

// A weather entity's state with its attributes converted, cached per state object so
// an unchanged state keeps its identity (the card skips work when it does).
const states = new WeakMap<EntityState, { key: string; value: EntityState }>();
export function convertState(state: EntityState, config: UnitSettings | undefined): EntityState {
  if (!converting(config)) return state;
  const key = UNIT_KIND_NAMES.map(name => config?.[name] ?? AUTO).join('|'),
    cached = states.get(state);
  if (cached?.key === key) return cached.value;
  const steps = plan(state.attributes, config);
  // Already in the chosen units: the integration's own state, untouched.
  if (!steps.length) return state;
  const attributes: EntityAttributes = { ...state.attributes };
  apply(attributes, steps, true);
  const value = { ...state, attributes };
  states.set(state, { key, value });
  return value;
}
// Attributes from the entity's history, which are in its own units, in the card's.
export function convertAttributes(
  attributes: Readonly<Record<string, unknown>>,
  config: UnitSettings | undefined,
): Readonly<Record<string, unknown>> {
  const steps = converting(config) ? plan(attributes, config) : [];
  if (!steps.length) return attributes;
  const converted = { ...attributes };
  apply(converted, steps, true);
  return converted;
}

// One forecast entry with the planned conversions applied.
function convertEntry(entry: ForecastEntry, steps: readonly Step[]): ForecastEntry {
  const out = { ...entry };
  apply(out, steps, false);
  return out;
}
// Another entity's forecast into this entity's units (and then the card's chosen ones),
// so a forecast borrowed from a second integration lines up with the first.
export function convertForecastBetween(
  list: readonly ForecastEntry[],
  fromAttrs: EntityAttributes | undefined,
  toAttrs: EntityAttributes | undefined,
  config: UnitSettings | undefined,
): readonly ForecastEntry[] {
  const steps = plan(fromAttrs, targetsOf(toAttrs, config));
  if (!steps.length) return list;
  return list.map(entry => convertEntry(entry, steps));
}
// Another entity's readings now in the units of `toAttrs`, which are already the card's, so a
// reading taken from a second integration lines up with the first's.
export function convertAttributesTo(attributes: EntityAttributes, toAttrs: EntityAttributes): EntityAttributes {
  const steps = plan(attributes, targetsOf(toAttrs, undefined));
  if (!steps.length) return attributes;
  const converted = { ...attributes };
  apply(converted, steps, true);
  return converted;
}
// The units borrowed readings are brought into: the card's chosen ones, else the entity's own.
function targetsOf(toAttrs: EntityAttributes | undefined, config: UnitSettings | undefined): UnitSettings {
  const targets: UnitSettings = {};
  for (const key of UNIT_KIND_NAMES) {
    const chosen = config?.[key];
    targets[key] = chosen && chosen !== AUTO ? chosen : (toAttrs?.[UNIT_KINDS[key].attribute] ?? AUTO);
  }
  return targets;
}
// Forecast entries carry no units of their own: they are in the entity's units.
export function convertForecast(
  list: readonly ForecastEntry[],
  attrs: EntityAttributes | undefined,
  config: UnitSettings | undefined,
): readonly ForecastEntry[] {
  if (!converting(config)) return list;
  const steps = plan(attrs, config);
  if (!steps.length) return list;
  return list.map(entry => convertEntry(entry, steps));
}
