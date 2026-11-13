import { CONDITION, type WeatherCondition, isCondition } from '../card/home-assistant.ts';
import type { SkyKind } from '../sky/presets-data.ts';

// Some integrations pass on a condition in their own words when they can't map it to one of Home
// Assistant's: "Light rain", "Overcast clouds", "Dark_PartlyCloud". Read as letters alone, so case,
// spaces and joined-up words don't matter, the first line below whose patterns all match names the
// nearest Home Assistant condition, and the kind of sky where the words name one outright. What
// falls or blows comes before the cloud it falls from, thunder before rain, snow before showers,
// wind before a bare "storm", and dust before thunder, as a dust storm spells "tstorm". Only
// English words are read; any others keep the overcast sky of a condition nobody named.
const THUNDER = /thunder|tstorm|lightning/,
  RAIN = /rain|shower/,
  SUN = /sun/,
  CLOUD = /cloud|overcast/,
  WIND = /wind|breez|gale|gust|squall|blustery/;
type Words = readonly [patterns: readonly RegExp[], condition: WeatherCondition, kind?: SkyKind];
const WORDS: readonly Words[] = [
  [[/tropicalstorm/], CONDITION.exceptional, 'tropicalStorm'],
  [[/hurricane|typhoon|cyclone/], CONDITION.exceptional, 'hurricane'],
  [[/dust|sand/], CONDITION.exceptional, 'blowingDust'],
  [[/smok|smog|volcan|wildfire/], CONDITION.exceptional, 'smoky'],
  [[/haze|hazy/], CONDITION.fog, 'haze'],
  [[/tornado|funnel/], CONDITION.lightningRainy, 'strongStorms'],
  [[THUNDER, /isolated/], CONDITION.lightning],
  [[THUNDER, /sun|scattered/], CONDITION.lightningRainy, 'scatteredThunderstorms'],
  [[THUNDER], CONDITION.lightningRainy],
  [[/hail/], CONDITION.hail],
  [[/freezingdrizzle/], CONDITION.rainy, 'freezingDrizzle'],
  [[/freezing(rain|shower)/], CONDITION.rainy, 'freezingRain'],
  [[/sleet|icepellet/], CONDITION.snowyRainy, 'sleet'],
  [[/snow/, /rain|drizzle/], CONDITION.snowyRainy],
  [[/wintry/], CONDITION.snowyRainy],
  [[/blizzard/], CONDITION.snowy, 'blizzard'],
  [[/(blowing|drifting)snow/], CONDITION.snowy, 'blowingSnow'],
  [[/flurr/], CONDITION.snowy, 'flurries'],
  [[/heavysnow/], CONDITION.snowy, 'heavySnow'],
  [[/snow/], CONDITION.snowy],
  [[/drizzle|sprinkle/], CONDITION.rainy, 'drizzle'],
  [[RAIN, /heavy|extreme|torrential/], CONDITION.pouring],
  [[/downpour|pouring|cloudburst/], CONDITION.pouring],
  [[RAIN, SUN], CONDITION.rainy, 'sunShowers'],
  [[RAIN], CONDITION.rainy],
  [[/fog|mist/], CONDITION.fog],
  [[WIND, CLOUD], CONDITION.windyVariant],
  [[WIND], CONDITION.windy],
  [[/storm/], CONDITION.lightningRainy],
  [[/mostlycloud|brokencloud/], CONDITION.partlyCloudy, 'mostlyCloudyMidAltitude'],
  [[/partly|fewcloud|scatteredcloud|lightcloud/], CONDITION.partlyCloudy],
  [[SUN, CLOUD], CONDITION.partlyCloudy],
  [[/(mostly|mainly)(sunny|clear)/], CONDITION.sunny, 'mostlyClear'],
  [[CLOUD], CONDITION.cloudy],
  [[/clear|sun|fair/], CONDITION.sunny],
];
const NOT_A_LETTER = /[^a-z]/g;

export interface WordedCondition {
  condition: WeatherCondition;
  kind?: SkyKind;
}
// The condition, and the sky where they name one, that an integration's own words come nearest to;
// none for words that name no weather, such as "unknown".
export function conditionInWords(text: string): WordedCondition | undefined {
  const letters = text.toLowerCase().replace(NOT_A_LETTER, ''),
    found = WORDS.find(([patterns]) => patterns.every(pattern => pattern.test(letters)));
  if (found === undefined) return undefined;
  const [, condition, kind] = found;
  return kind === undefined ? { condition } : { condition, kind };
}

// One of Home Assistant's conditions as it is, and an integration's own words as the nearest of them.
export const nearestCondition = (text: string): WeatherCondition | undefined =>
  isCondition(text) ? text : conditionInWords(text)?.condition;
