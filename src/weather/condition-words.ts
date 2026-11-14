import { CONDITION, type WeatherCondition, isCondition } from '../card/home-assistant.ts';
import type { SkyKind } from '../sky/presets-data.ts';

// Providers also send phrases such as "Light rain", "Overcast clouds" and "Dark_PartlyCloud".
// Compare their English words without case or separators. Test precipitation and specific cloud
// types before broad sky conditions. Dust precedes thunder because "dust storm" contains "tstorm".
const THUNDER = /thunder|tstorm|lightning/,
  RAIN = /rain|shower/,
  SUN = /sun/,
  CLOUD = /cloud|overcast/,
  WIND = /wind|breez|gale|gust|squall|blustery/;
type WordedSky = SkyKind | 'mostlyCloudy';
type Words = readonly [patterns: readonly RegExp[], condition: WeatherCondition, kind?: WordedSky];
const WORDS: readonly Words[] = [
  [[/tropicalstorm/], CONDITION.exceptional, 'tropicalStorm'],
  [[/hurricane|typhoon|cyclone/], CONDITION.exceptional, 'hurricane'],
  [[/dust|sand/], CONDITION.exceptional, 'blowingDust'],
  [[/smok|smog|volcan|wildfire/], CONDITION.exceptional, 'smoky'],
  [[/haze|hazy/], CONDITION.fog, 'haze'],
  [[/^frigid$/], CONDITION.sunny, 'frigid'],
  [[/^hot$/], CONDITION.sunny, 'hot'],
  [[/strongstorm|severethunder|tornado|funnel/], CONDITION.lightningRainy, 'strongStorms'],
  [[THUNDER, /isolated/], CONDITION.lightning],
  [[THUNDER, /sun|scattered/], CONDITION.lightningRainy, 'scatteredThunderstorms'],
  [[/^thunderstorms?$/], CONDITION.lightningRainy, 'thunderstorms'],
  [[THUNDER], CONDITION.lightningRainy],
  [[/hail/], CONDITION.hail],
  [[/freezingdrizzle/], CONDITION.rainy, 'freezingDrizzle'],
  [[/freezing(rain|shower)/], CONDITION.rainy, 'freezingRain'],
  [[/sleet|icepellet/], CONDITION.snowyRainy, 'sleet'],
  [[/snow/, /rain|drizzle/], CONDITION.snowyRainy],
  [[/wintry/], CONDITION.snowyRainy],
  [[/blizzard/], CONDITION.snowy, 'blizzard'],
  [[/(blowing|drifting)snow/], CONDITION.snowy, 'blowingSnow'],
  [[SUN, /flurr/], CONDITION.snowy, 'sunFlurries'],
  [[/flurr/], CONDITION.snowy, 'flurries'],
  [[/heavysnow/], CONDITION.snowy, 'heavySnow'],
  [[/^snow$/], CONDITION.snowy, 'snow'],
  [[/snow/], CONDITION.snowy],
  [[/drizzle|sprinkle/], CONDITION.rainy, 'drizzle'],
  [[RAIN, /heavy|extreme|torrential/], CONDITION.pouring],
  [[/downpour|pouring|cloudburst/], CONDITION.pouring],
  [[RAIN, SUN], CONDITION.rainy, 'sunShowers'],
  [[/^rain$/], CONDITION.rainy, 'rain'],
  [[RAIN], CONDITION.rainy],
  [[/^foggy$/], CONDITION.fog, 'foggy'],
  [[/fog|mist/], CONDITION.fog],
  [[/(mostly|mainly)cloud|brokencloud/], CONDITION.partlyCloudy, 'mostlyCloudy'],
  [[/partly|fewcloud|scatteredcloud|lightcloud/], CONDITION.partlyCloudy],
  [[SUN, CLOUD], CONDITION.partlyCloudy],
  [[/(mostly|mainly)(sunny|clear)/], CONDITION.sunny, 'mostlyClear'],
  [[WIND, CLOUD], CONDITION.windyVariant],
  [[WIND], CONDITION.windy],
  [[/storm/], CONDITION.lightningRainy],
  [[CLOUD], CONDITION.cloudy],
  [[/clear|sun|fair/], CONDITION.sunny],
];
const NOT_A_LETTER = /[^a-z]/g;

export interface WordedCondition {
  condition: WeatherCondition;
  kind?: WordedSky;
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
