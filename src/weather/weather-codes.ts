import { CONDITION, type WeatherCondition } from '../card/home-assistant.ts';
import { finite } from '../lib/values.ts';

// Open-Meteo's weather codes as Home Assistant's conditions, apart from the rest of what is asked of
// it, so a page with no use for the card's words can read them too.

// Each weather code Open-Meteo sends as a Home Assistant condition. Freezing drizzle and freezing
// rain come down as a wintry mix, and a storm that brings hail reads as the hail.
const CODE_CONDITIONS: Readonly<Record<number, WeatherCondition>> = {
  0: CONDITION.sunny,
  1: CONDITION.sunny,
  2: CONDITION.partlyCloudy,
  3: CONDITION.cloudy,
  45: CONDITION.fog,
  48: CONDITION.fog,
  51: CONDITION.rainy,
  53: CONDITION.rainy,
  55: CONDITION.rainy,
  56: CONDITION.snowyRainy,
  57: CONDITION.snowyRainy,
  61: CONDITION.rainy,
  63: CONDITION.rainy,
  65: CONDITION.pouring,
  66: CONDITION.snowyRainy,
  67: CONDITION.snowyRainy,
  71: CONDITION.snowy,
  73: CONDITION.snowy,
  75: CONDITION.snowy,
  77: CONDITION.snowy,
  80: CONDITION.rainy,
  81: CONDITION.rainy,
  82: CONDITION.pouring,
  85: CONDITION.snowy,
  86: CONDITION.snowy,
  95: CONDITION.lightningRainy,
  96: CONDITION.hail,
  99: CONDITION.hail,
};
export const codeCondition = (code: unknown): WeatherCondition | undefined =>
  finite(code) ? CODE_CONDITIONS[code] : undefined;

// An hour's condition: clear after dark is a clear night, and rain with snow in it a wintry mix,
// whichever of the two the code settled on.
export function hourCondition(
  code: unknown,
  snowfall: unknown,
  daytime: boolean | undefined,
): WeatherCondition | undefined {
  const condition = codeCondition(code);
  if (condition === CONDITION.sunny && daytime === false) return CONDITION.clearNight;
  const raining = condition === CONDITION.rainy || condition === CONDITION.pouring;
  return raining && finite(snowfall) && snowfall > 0 ? CONDITION.snowyRainy : condition;
}
