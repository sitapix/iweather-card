import {
  inDomain,
  isCondition,
  STATE,
  type EntityAttributes,
  type EntityState,
  type HomeAssistant,
} from '../card/home-assistant.ts';
import { PER_HOUR, UNIT_KINDS, convertUnit, type UnitKind } from './units.ts';
import { finite } from '../lib/values.ts';
import { pointBearing } from '../lib/compass.ts';

// Every integration provides a different set of readings (Met.no has no UV, gusts or
// visibility; NWS no forecast UV; a weather station has its own sensors). Like other
// weather cards, any reading can come from its own sensor instead: set, it replaces the
// weather entity's value, or supplies one the entity lacks. Unset, nothing changes.
// The sensor's value is converted into the weather entity's unit for that kind, so the
// rest of the card reads one consistent set of attributes.

// Reading attribute, the unit kind it converts with (see UNIT_KINDS), and its label.
export const READINGS = [
  ['temperature', 'temperature_unit', 'Temperature'],
  ['apparent_temperature', 'temperature_unit', 'Feels like'],
  ['humidity', null, 'Humidity'],
  ['dew_point', 'temperature_unit', 'Dew point'],
  ['pressure', 'pressure_unit', 'Pressure'],
  ['uv_index', null, 'UV index'],
  ['wind_speed', 'wind_speed_unit', 'Wind speed'],
  ['wind_gust_speed', 'wind_speed_unit', 'Wind gusts'],
  ['wind_bearing', null, 'Wind direction'],
  ['visibility', 'distance_unit', 'Visibility'],
  ['cloud_coverage', null, 'Cloud cover'],
  ['precipitation', 'precipitation_unit', 'Precipitation now'],
] as const satisfies readonly (readonly [keyof EntityAttributes, UnitKind | null, string])[];
export type Reading = (typeof READINGS)[number][0];
export const readingOption = <A extends Reading>(attribute: A): `${A}_entity` => `${attribute}_entity`;
export type ReadingOption = `${Reading}_entity`;
export const READING_OPTIONS: readonly ReadingOption[] = READINGS.map(([attribute]) => readingOption(attribute));
// The card options that pick where readings come from.
export type SourceSettings = { entity?: string; condition_entity?: string } & Partial<Record<ReadingOption, string>>;
const kindOf = (attribute: Reading): UnitKind | null => READINGS.find(([name]) => name === attribute)?.[1] ?? null;

// Sensor units as Home Assistant writes them, in the spellings the converters know.
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  '°c': '°C',
  '°f': '°F',
  c: '°C',
  f: '°F',
  'km/h': 'km/h',
  kmh: 'km/h',
  kph: 'km/h',
  'm/s': 'm/s',
  mph: 'mph',
  kn: 'kn',
  kt: 'kn',
  knots: 'kn',
  'ft/s': 'ft/s',
  hpa: 'hPa',
  mbar: 'mbar',
  mb: 'mbar',
  kpa: 'kPa',
  pa: 'Pa',
  inhg: 'inHg',
  mmhg: 'mmHg',
  psi: 'psi',
  km: 'km',
  m: 'm',
  mi: 'mi',
  bft: 'bft',
  beaufort: 'bft',
};
const unitName = (unit: unknown): string | undefined =>
  typeof unit === 'string' ? (UNIT_ALIASES[unit.trim().toLowerCase()] ?? unit) : undefined;

// A source's reading as a number. A weather entity gives its attribute of that name; a
// sensor its state (wind direction sensors may report a compass point).
function reading(state: EntityState | undefined, attribute: Reading): number | null {
  if (state?.state === STATE.unavailable) return null;
  if (inDomain(state?.entity_id, 'weather')) {
    const value = state.attributes[attribute];
    if (attribute === 'wind_bearing' && typeof value === 'string') return pointBearing(value) ?? null;
    return finite(value) ? value : null;
  }
  const text = state?.state;
  if (attribute === 'wind_bearing' && text !== undefined) {
    const point = pointBearing(text);
    if (point !== undefined) return point;
  }
  const value = Number(text);
  return text === undefined || text.trim() === '' || !Number.isFinite(value) ? null : value;
}

// The readings a configured sensor supplies now, which withSensors puts in the entity's place.
export const sensorReadings = (hass: HomeAssistant | undefined, config: SourceSettings | undefined): Set<Reading> =>
  new Set(
    READINGS.flatMap(([attribute]) => {
      const id = config?.[readingOption(attribute)];
      return id && reading(hass?.states[id], attribute) !== null ? [attribute] : [];
    }),
  );

const DECIMAL = 10;
const roundTo = (value: number, digits: number) => Math.round(value * DECIMAL ** digits) / DECIMAL ** digits;

// The readings a weather entity lacks, for the editor to point out.
export const missingReadings = (attributes: EntityAttributes | undefined): Reading[] =>
  READINGS.filter(([attribute]) => attribute !== 'precipitation' && !finite(attributes?.[attribute])).map(
    ([attribute]) => attribute,
  );

// Home Assistant's state with the weather entity's attributes filled in from the
// configured sensors. Unchanged inputs give back the same objects, so the card can tell
// nothing changed.
type Source = readonly [attribute: Reading | 'condition', id: string];
const cache = new WeakMap<EntityState, { inputs: (EntityState | undefined)[]; key: string; value: EntityState }>();
export function withSensors(hass: HomeAssistant, config: SourceSettings | undefined): HomeAssistant {
  const entity = config?.entity,
    state = entity ? hass.states[entity] : undefined;
  const sources: Source[] = [];
  for (const [attribute] of READINGS) {
    const id = config?.[readingOption(attribute)];
    if (id) sources.push([attribute, id]);
  }
  if (config?.condition_entity) sources.push(['condition', config.condition_entity]);
  if (!entity || !state || !sources.length) return hass;
  // Each sensor's reading as precise as the user has Home Assistant show it, where they've said.
  const inputs = sources.map(([, id]) => hass.states[id]),
    precisions = sources.map(([, id]) => hass.entities?.[id]?.display_precision),
    key = JSON.stringify([sources, precisions]),
    cached = cache.get(state);
  if (
    cached &&
    cached.inputs.length === inputs.length &&
    cached.inputs.every((input, i) => input === inputs[i]) &&
    cached.key === key
  )
    return cached.value === state ? hass : { ...hass, states: { ...hass.states, [entity]: cached.value } };
  const attributes: EntityAttributes = { ...state.attributes };
  let condition = state.state;
  sources.forEach(([attribute], i) => {
    const input = inputs[i];
    if (attribute === 'condition') {
      // The condition itself can come from another weather entity, or a sensor whose state is one.
      if (isCondition(input?.state)) condition = input.state;
      return;
    }
    const read = reading(input, attribute),
      precision = precisions[i];
    if (read === null) return;
    const value = finite(precision) ? roundTo(read, precision) : read;
    const kind = kindOf(attribute),
      unitAttribute = kind && UNIT_KINDS[kind].attribute;
    // A weather entity names its units in *_unit attributes; a sensor in unit_of_measurement.
    const named = unitName(
        inDomain(input?.entity_id, 'weather')
          ? unitAttribute && input.attributes[unitAttribute]
          : input?.attributes.unit_of_measurement,
      ),
      from = kind === 'precipitation_unit' ? named?.replace(PER_HOUR, '') : named,
      to = unitAttribute && attributes[unitAttribute];
    // Into the weather entity's unit; with none to match, the sensor's own unit is adopted.
    attributes[attribute] = kind && from && to ? convertUnit(kind, value, from, to) : value;
    if (unitAttribute && !to && from) attributes[unitAttribute] = from;
  });
  const value = { ...state, state: condition, attributes };
  cache.set(state, { inputs, key, value });
  return { ...hass, states: { ...hass.states, [entity]: value } };
}
