import { isRecord, finite, text, isList } from '../lib/values.ts';
import { fromUnix } from '../lib/time.ts';
import type { HomeAssistant } from '../card/home-assistant.ts';
// Asking Home Assistant for its history of entities, and reading its replies.
// A history state's time: compressed states carry seconds, full ones an ISO time.
export const stateTime = (state: unknown): number => {
  if (!isRecord(state)) return NaN;
  const stamp = state['lu'] ?? state['lc'] ?? state['last_updated'] ?? state['last_changed'];
  return finite(stamp) ? fromUnix(stamp) : Date.parse(text(stamp) ? stamp : '');
};
// One entity's states in a history reply.
export const historyOf = (result: unknown, entity: string | undefined): readonly unknown[] => {
  const states = isRecord(result) && entity !== undefined ? result[entity] : undefined;
  return isList(states) ? states : [];
};
// A nonnumeric state closes the last known interval; keep it for rate integration.
export const historyIntervals = (result: unknown, entity: string): { time: number; value: number | null }[] =>
  historyOf(result, entity).flatMap(row => {
    const time = stateTime(row),
      value = isRecord(row) ? parseFloat(String(row['s'] ?? row['state'])) : NaN;
    return Number.isFinite(time) ? [{ time, value: finite(value) ? value : null }] : [];
  });
export const historyReadings = (result: unknown, entity: string): { time: number; value: number }[] =>
  historyIntervals(result, entity).flatMap(({ time, value }) => (value === null ? [] : [{ time, value }]));
// Entities' states from `start` to `end` (or now): with their attributes when `full`, else only
// their values.
export const askHistory = (hass: HomeAssistant, entities: string[], full: boolean, start: number, end?: number) =>
  hass.callWS?.({
    type: 'history/history_during_period',
    start_time: new Date(start).toISOString(),
    ...(end === undefined ? {} : { end_time: new Date(end).toISOString() }),
    entity_ids: entities,
    minimal_response: !full,
    no_attributes: !full,
    significant_changes_only: false,
  });
// Yesterday's and today's states of the entity.
export interface History {
  yesterday: readonly unknown[];
  today: readonly unknown[];
}
