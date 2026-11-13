import { PRECIPITATION_RATE } from '../sky/presets.ts';
import { finite } from '../lib/values.ts';
import { convertUnit, UNITS } from './units.ts';
import { numberFormat } from '../lib/formats.ts';
import { type WeatherCondition, isCondition, type ForecastEntry } from '../card/home-assistant.ts';
import { phrase, say } from './words.ts';

// Rate to bar height, in thirds: light (<2.5 mm/h), moderate (<7.6 mm/h), heavy, full at
// 50 mm/h; any rate shows at least a sliver, 6% of the bar. Amounts are per forecast hour. Light
// rain feels more than its rate, so its third goes by the rate's cube root: a tenth of the way to
// moderate stands nearly half way up the third.
// The scale is how heavy it feels: snow's liquid equivalent is about a third of rain's at the
// same feel (a mix, half), so frozen rates count for more.
export const INTENSITY_LEVELS = [phrase('Light'), phrase('Moderate'), phrase('Heavy')] as const;
export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

export const LEVELS = INTENSITY_LEVELS.length;

const RATE = { ...PRECIPITATION_RATE, heaviest: 50, sliver: 0.06 } as const;

const FELT: Readonly<Partial<Record<PrecipitationSymbol, number>>> = { snow: 3, mixed: 2 };

export function precipitationIntensity(
  amount: number | null | undefined,
  unit: string | undefined,
  symbol?: PrecipitationSymbol,
): number {
  if (!finite(amount) || amount <= 0) return 0;
  const rate = convertUnit('precipitation_unit', amount, unit, UNITS.millimeters) * ((symbol && FELT[symbol]) ?? 1);
  if (rate < RATE.moderate) return Math.max(RATE.sliver, Math.cbrt(rate / RATE.moderate) / LEVELS);
  if (rate < RATE.heavy) return 1 / LEVELS + (rate - RATE.moderate) / (RATE.heavy - RATE.moderate) / LEVELS;
  return 2 / LEVELS + Math.min(1, (rate - RATE.heavy) / (RATE.heaviest - RATE.heavy)) / LEVELS;
}

// An amount reads to the nearest twentieth in inches and in centimetres, and whole in anything else,
// millimetres among them; from a foot of inches or 20 cm it reads whole too. Inch amounts drop the
// leading zero: .05″, 1.15″.
const TWENTIETH = 0.05,
  WHOLE_DIGITS = 0,
  TWENTIETH_DIGITS = 2;
const WHOLE_FROM: Readonly<Record<string, number>> = { [UNITS.inches]: 12, [UNITS.centimeters]: 20 };

const amountStep = (value: number, unit: string | undefined) => (value < (WHOLE_FROM[unit ?? ''] ?? 0) ? TWENTIETH : 1);

// Some, but less than rounds to anything.
export const traceAmount = (value: number, unit: string | undefined): boolean =>
  value > 0 && value < amountStep(value, unit) / 2;

export function precipitationAmount(
  value: number | null | undefined,
  unit: string | undefined,
  locale: string | undefined,
): string {
  if (!finite(value)) return '—';
  // A trace reads as less than the smallest amount: <.05″, <1 mm.
  const step = amountStep(value, unit),
    trace = traceAmount(value, unit),
    text = numberFormat(locale, { maximumFractionDigits: step < 1 ? TWENTIETH_DIGITS : WHOLE_DIGITS }).format(
      trace ? step : Math.round(value / step) * step,
    ),
    shown = unit === UNITS.inches ? `${text.replace(/^0(?=\D)/, '')}″` : `${text} ${unit ?? UNITS.millimeters}`;
  return trace ? `<${shown}` : shown;
}

// An amount in a sentence: "less than .05″" for a trace.
export const precipitationWords = (value: number, unit: string | undefined, locale: string | undefined): string =>
  traceAmount(value, unit)
    ? say('less than {amount}', { amount: precipitationAmount(amountStep(value, unit), unit, locale) })
    : precipitationAmount(value, unit, locale);

export type PrecipitationKind = 'hail' | 'sleet' | 'wintry_mix' | 'snow' | 'rain';

// What the conditions that bring precipitation bring down: snow, rain and snow mixed (a
// wintry mix), hail, or rain.
const PRECIPITATION_OF: Readonly<Partial<Record<WeatherCondition, PrecipitationKind>>> = {
  snowy: 'snow',
  'snowy-rainy': 'wintry_mix',
  hail: 'hail',
  rainy: 'rain',
  pouring: 'rain',
  'lightning-rainy': 'rain',
};

export const conditionPrecipitation = (condition: string | undefined): PrecipitationKind | undefined =>
  isCondition(condition) ? PRECIPITATION_OF[condition] : undefined;

// Whether an hour brings precipitation, by its condition or its amount.
export const wet = (item: ForecastEntry) =>
  conditionPrecipitation(item.condition) !== undefined || (item.precipitation ?? 0) > 0;

export const frozenPrecipitation = (kind: PrecipitationKind | undefined): boolean =>
  kind === 'snow' || kind === 'sleet' || kind === 'wintry_mix';

// The precipitation the views are about, which names the chance ("Chance of Snow") and sets
// the precipitation switch's glyph: what's falling now when it's frozen or hail, else
// today's forecast when that's frozen, else rain. Frozen precipitation wins, so a day
// forecast to snow reads as snow even while it's dry for now.
export function dominantPrecipitation(current: string | undefined, today: string | undefined): PrecipitationKind {
  const now = conditionPrecipitation(current),
    day = conditionPrecipitation(today);
  if (now && (frozenPrecipitation(now) || now === 'hail')) return now;
  if (day && frozenPrecipitation(day)) return day;
  return 'rain';
}

// What one hour (or day) brings, from its own condition, which sets the glyph beside its chance and
// the colours of its bar: snow, a mix of rain and snow, rain or hail, or a chance with no
// precipitation of its own.
export type PrecipitationSymbol = 'snow' | 'mixed' | 'rain' | 'none';

export function precipitationSymbol(item: ForecastEntry): PrecipitationSymbol {
  const kind = conditionPrecipitation(item.condition);
  if (kind === 'snow') return 'snow';
  if (kind === 'wintry_mix' || kind === 'sleet') return 'mixed';
  if (kind || (item.precipitation ?? 0) > 0) return 'rain';
  return 'none';
}

// A chance as shown: to the nearest 5%, so 43% reads 45%.
const CHANCE_STEP = 5;

export const roundChance = (value: number): number => Math.round(value / CHANCE_STEP) * CHANCE_STEP;
