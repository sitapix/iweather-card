import { FORECAST_FEATURES, inDomain, type HomeAssistant } from './home-assistant.ts';
import { weatherAvailable } from '../weather/conditions.ts';
import { finite } from '../lib/values.ts';

// Keep Home Assistant's preference for entities not already on the dashboard. Within each
// group, prefer a forecast provider over an observation-only station. Never start on a known
// unavailable entity when another group has a usable one. Ties keep Home Assistant's order.
export function suggestWeatherEntity(
  hass: HomeAssistant | undefined,
  entities: readonly string[] = [],
  fallback: readonly string[] = [],
): string {
  const groups = [entities, fallback, Object.keys(hass?.states ?? {})];
  for (const group of groups) {
    let best: string | undefined;
    let score = -1;
    for (const id of group) {
      if (!inDomain(id, 'weather')) continue;
      const state = hass?.states[id];
      if (state && !weatherAvailable(state)) continue;
      const features = state?.attributes.supported_features ?? 0,
        rank =
          [
            Boolean(features & FORECAST_FEATURES.hourly),
            Boolean(features & (FORECAST_FEATURES.daily | FORECAST_FEATURES.twiceDaily)),
          ].filter(Boolean).length *
            2 +
          Number(finite(state?.attributes.temperature));
      if (rank > score) {
        best = id;
        score = rank;
      }
    }
    if (best) return best;
  }
  return groups.flat().find(id => inDomain(id, 'weather')) ?? 'weather.home';
}
