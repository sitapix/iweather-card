import { readFileSync } from 'node:fs';
import { finite, isRecord, text } from '../src/lib/values.ts';

// A recording from test/integrations: a real integration's weather entity, its state and its
// forecasts as Home Assistant sent them, and when and where that was.
export interface Recording {
  name: string;
  now: number;
  timeZone: string;
  latitude: number;
  longitude: number;
  state: string;
  attributes: Readonly<Record<string, unknown>>;
  forecasts: Readonly<Record<string, unknown>>;
}

export function recording(name: string): Recording {
  const parsed: unknown = JSON.parse(
      readFileSync(new URL(`../test/integrations/${name}.json`, import.meta.url), 'utf8'),
    ),
    state = isRecord(parsed) ? parsed['state'] : undefined;
  if (!isRecord(parsed) || !isRecord(state) || !text(state['state'])) throw new Error(`${name} holds no recording.`);
  const { now, time_zone: timeZone, latitude, longitude, forecasts } = parsed,
    attributes = state['attributes'];
  if (!text(now) || !text(timeZone) || !finite(latitude) || !finite(longitude))
    throw new Error(`${name} doesn’t say when and where it was recorded.`);
  return {
    name,
    now: Date.parse(now),
    timeZone,
    latitude,
    longitude,
    state: state['state'],
    attributes: isRecord(attributes) ? attributes : {},
    forecasts: isRecord(forecasts) ? forecasts : {},
  };
}
