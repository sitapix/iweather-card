import type { CardConfig } from '../card/config.ts';
import type { HomeAssistant } from '../card/home-assistant.ts';
import { READING_OPTIONS } from './sources.ts';
import { finite } from '../lib/values.ts';

// Entity changes and forecast downloads have their own timestamps. Neither dates an observation.
export type DataUpdate =
  | { kind: 'entity'; entity: string; name: string; at: number }
  | { kind: 'supplement'; at: number };

const validTime = (at: number | undefined, now: number): at is number =>
  finite(at) && at <= now && Number.isFinite(new Date(at).getTime());

export function dataUpdates(
  config: CardConfig,
  hass: HomeAssistant | undefined,
  now: number,
  supplementAt?: number,
): DataUpdate[] {
  const entities = new Set([
      config.entity,
      config.condition_entity,
      config.forecast_entity,
      ...READING_OPTIONS.map(option => config[option]),
    ]),
    updates: DataUpdate[] = [];
  for (const entity of entities) {
    if (entity === undefined) continue;
    const state = hass?.states[entity],
      at = Date.parse(state?.last_updated ?? '');
    if (!validTime(at, now)) continue;
    updates.push({ kind: 'entity', entity, name: state?.attributes.friendly_name?.trim() || entity, at });
  }
  if (validTime(supplementAt, now)) updates.push({ kind: 'supplement', at: supplementAt });
  return updates;
}
