// Where the weather shown is for, and whether that is home.
import type { CardConfig } from './config.ts';
import type { EntityAttributes, HassConfig, HomeAssistant } from './home-assistant.ts';
import { finite } from '../lib/values.ts';

export type Place = Pick<EntityAttributes, 'latitude' | 'longitude'>;
// A place counts as home within 10 km of Home Assistant's: a weather entity's own coordinates are
// rounded, or snapped to a service's grid, by that much.
const HOME_KM = 10,
  EARTH_KM = 6371,
  DEGREE = Math.PI / 180;
// The zone the settings name, else the weather entity's own place where it gives one, else home.
// The sky, the map and what the card asks of Open-Meteo all follow it.
export function weatherPlace(
  hass: Pick<HomeAssistant, 'states' | 'config'> | undefined,
  config: Pick<CardConfig, 'entity' | 'zone'> | undefined,
): Place | undefined {
  const located = (id: string | undefined): Place | undefined => {
    const attrs = id === undefined ? undefined : hass?.states[id]?.attributes;
    return attrs && finite(attrs.latitude) && finite(attrs.longitude) ? attrs : undefined;
  };
  return located(config?.zone) ?? located(config?.entity) ?? hass?.config;
}
// Whether a place is Home Assistant's home. A place that doesn't say where it is has only that home
// to be.
export function isHome({ latitude, longitude }: Place, home: HassConfig | undefined): boolean {
  if (!home || !finite(latitude) || !finite(longitude) || !finite(home.latitude) || !finite(home.longitude))
    return true;
  const north = (latitude - home.latitude) * DEGREE,
    east = (longitude - home.longitude) * DEGREE,
    across =
      Math.sin(north / 2) ** 2 +
      Math.cos(latitude * DEGREE) * Math.cos(home.latitude * DEGREE) * Math.sin(east / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(across)) <= HOME_KM;
}
