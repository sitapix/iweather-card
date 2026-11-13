import { finite } from '../../lib/values.ts';
import { AIR_SCALE_AUTO, DEFAULT_AIR_SCALE, type AirScaleId } from '../../card/config.ts';
import type { HomeAssistant } from '../../card/home-assistant.ts';
import { airGlyph } from '../shared/glyphs.ts';
import { phrase, say } from '../../weather/words.ts';
import type { AirSupply } from './open-meteo.ts';
import { AIR_SCALES, type AirBand, type AirScale } from './scales.ts';
// What each tier of air means (see scales.ts): advice for now, and what it means for health.
export type AirTier = readonly [advice: string, health: string];
export const AIR_TIERS: readonly AirTier[] = [
  [phrase('Air quality is satisfactory.'), phrase('The air is clean, and nothing in it should bother anyone.')],
  [
    phrase('Unusually sensitive people should consider limiting prolonged outdoor exertion.'),
    phrase(
      'Most people won’t notice anything at this level. Someone with especially sensitive lungs may feel it when breathing hard outdoors.',
    ),
  ],
  [
    phrase('Sensitive groups should reduce prolonged outdoor exertion.'),
    phrase(
      'This air is starting to matter for anyone with heart or lung disease, and for older adults and children. Most other people should be fine.',
    ),
  ],
  [
    phrase('Everyone should reduce prolonged outdoor exertion.'),
    phrase(
      'Most people will start to notice this air when they’re active outside, and it can hit those with heart or lung conditions much harder.',
    ),
  ],
  [
    phrase('Everyone should avoid prolonged outdoor exertion.'),
    phrase(
      'Breathing this air is a real risk for anyone, not just those in sensitive groups, so it’s best to keep time outdoors short.',
    ),
  ],
  [
    phrase('Everyone should avoid outdoor activity.'),
    phrase(
      'This is the top of the scale. The air is dangerous for everyone, and the safest place is indoors with the windows shut.',
    ),
  ],
];
// The tier air first matters from, and the tiers the glyph's dots stand for: sparse in the first,
// as drawn in the second, and denser in every tier past that.
const SIGNIFICANT_TIER = 2;
const DENSITIES = ['low', 'medium'] as const;
const FALLBACK_BAND: AirBand = { top: Infinity, name: phrase('Unknown'), tier: 0 };
// A sensor that names its scale says which it is. Anything else is taken for the US scale, as many
// services report that in every country, so a country alone says nothing about a reading.
const SCALE_NAMES: Readonly<Record<string, AirScaleId>> = {
  aqhi: 'ca',
  aqih: 'ie',
  atmo: 'fr',
  cai: 'kr',
  daqi: 'uk',
  eaqi: 'eu',
  ica: 'es',
  icars: 'mx',
  khai: 'kr',
  lqi: 'de',
  naqi: 'in',
  psi: 'sg',
  uba: 'de',
};
const namedScale = (name: string | undefined): AirScaleId | undefined =>
  (name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(word => SCALE_NAMES[word])
    .find(id => id !== undefined);
// The scale a card reads its sensor on: as set, or else as the sensor names it.
export function airScale({
  config,
  hass,
}: {
  config: {
    air_quality_scale?: AirScaleId | typeof AIR_SCALE_AUTO | undefined;
    air_quality_entity?: string | undefined;
  };
  hass?: Pick<HomeAssistant, 'states'> | undefined;
}): AirScale {
  const set = config.air_quality_scale;
  if (set && set !== AIR_SCALE_AUTO) return AIR_SCALES[set];
  const entity = config.air_quality_entity,
    name = entity === undefined ? undefined : hass?.states[entity]?.attributes.friendly_name;
  return AIR_SCALES[namedScale(entity) ?? namedScale(typeof name === 'string' ? name : undefined) ?? DEFAULT_AIR_SCALE];
}
// Air quality now: a set sensor's reading on its scale, or without one the US index filled in for
// the weather's place (see open-meteo.ts). A sensor set but not reading leaves none.
export interface AirNow {
  value: number;
  scale: AirScale;
  // The reading at about this time yesterday, where there is one.
  yesterday: number | undefined;
  // From the sensor's own entity, or filled in.
  entity: string | undefined;
  supply: AirSupply | undefined;
}
export function airNow(ctx: {
  config: Parameters<typeof airScale>[0]['config'];
  hass?: Pick<HomeAssistant, 'states'> | undefined;
  airYesterday?: number | undefined;
  airSupply?: AirSupply | undefined;
}): AirNow | undefined {
  const entity = ctx.config.air_quality_entity;
  if (entity !== undefined) {
    const state = ctx.hass?.states[entity]?.state,
      value = state?.trim() ? Number(state) : Number.NaN;
    return finite(value)
      ? { value, scale: airScale(ctx), yesterday: ctx.airYesterday, entity, supply: undefined }
      : undefined;
  }
  const supply = ctx.airSupply;
  return supply
    ? { value: supply.index, scale: AIR_SCALES.us, yesterday: supply.yesterday, entity: undefined, supply }
    : undefined;
}
// A reading's level on its scale. A scale of a few levels can have a continuous index behind it, to
// 100 in even steps, which many sensors report instead.
const airLevel = (scale: AirScale, value: number): number =>
  scale.steps !== undefined && value > scale.range[1] ? Math.ceil(value / scale.steps) : value;
// A reading's band. A reading between two whole levels belongs to the lower one.
export const airBand = (scale: AirScale, value: number): AirBand => {
  const level = airLevel(scale, value);
  return scale.bands.find(band => level < band.top + 1) ?? scale.bands.at(-1) ?? FALLBACK_BAND;
};
// How far along the scale a reading is.
export const airShare = (scale: AirScale, value: number): number => {
  const [low, high] = scale.range;
  return (airLevel(scale, value) - low) / (high - low);
};
// The air quality glyph for a reading. Without a reading it stays as drawn.
export const airGlyphFor = (value: number, scale: AirScale = AIR_SCALES.us): string =>
  Number.isFinite(value) ? airGlyph(DENSITIES[airBand(scale, value).tier] ?? 'high') : airGlyph('medium');

// Air quality bad enough to put first, and to show in full. On the US scale that is past 100, where
// "Unhealthy for Sensitive Groups" begins. Some scales always show so.
export const airIsSignificant = (value: number, scale: AirScale = AIR_SCALES.us): boolean =>
  scale.prominent === true || airBand(scale, value).tier >= SIGNIFICANT_TIER;

// A reading against yesterday's: within 1% of the scale or a tenth of yesterday's, whichever is
// more, it is similar; lower is better. Each way is said of a scale with numbers, with its reading,
// and of one without.
const AIR_SIMILAR = { shareOfScale: 0.01, share: 0.1 } as const,
  AIR_COMPARED = {
    better: {
      numbered: phrase('Air quality index is {index}, which is better than yesterday at about this time.'),
      named: phrase('Air quality is better than yesterday at about this time.'),
    },
    similar: {
      numbered: phrase('Air quality index is {index}, which is similar to yesterday at about this time.'),
      named: phrase('Air quality is similar to yesterday at about this time.'),
    },
    worse: {
      numbered: phrase('Air quality index is {index}, which is worse than yesterday at about this time.'),
      named: phrase('Air quality is worse than yesterday at about this time.'),
    },
  } as const;
function airComparison(scale: AirScale, value: number, yesterday: number): keyof typeof AIR_COMPARED {
  const [low, high] = scale.range,
    change = value - yesterday;
  return Math.abs(change) <= Math.max((high - low) * AIR_SIMILAR.shareOfScale, Math.abs(yesterday) * AIR_SIMILAR.share)
    ? 'similar'
    : change < 0
      ? 'better'
      : 'worse';
}
// The reading in a sentence, set against yesterday's at this time when there is one. A scale with
// no numbers says its band instead.
export function airSentence(scale: AirScale, shown: string, value: number, yesterday: number | undefined): string {
  if (finite(yesterday)) {
    const { numbered, named } = AIR_COMPARED[airComparison(scale, value, yesterday)];
    return scale.numeric ? say(numbered, { index: shown }) : say(named);
  }
  const short = say(scale.short);
  return scale.numeric
    ? say('Current {scale} is {index}.', { scale: short, index: shown })
    : say('Current {scale} is {level}.', { scale: short, level: say(airBand(scale, value).name) });
}
