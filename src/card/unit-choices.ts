// Units picked from a sheet's options, kept on this device: each with the card's own setting it was
// picked over, and it stands while that setting does. A setting changed since is the newer word, and
// the card's setting shows; set back, the pick stands again.
import { isRecord } from '../lib/values.ts';
import { UNIT_CHOICES, UNIT_KIND_NAMES, type UnitKind } from '../weather/units.ts';
import type { CardConfig } from './config.ts';

const KEY = 'iweather-units';
interface Pick {
  unit: string;
  over: string;
}
type Picks = Partial<Record<UnitKind, Pick>>;
// What is kept, each pick one the card offers; nothing where nothing can be kept, as in a private
// window that refuses it.
function picks(): Picks {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return {};
  }
  if (!isRecord(stored)) return {};
  const found: Picks = {};
  for (const kind of UNIT_KIND_NAMES) {
    const pick = stored[kind];
    if (!isRecord(pick)) continue;
    const { unit, over } = pick;
    if (typeof unit === 'string' && typeof over === 'string' && UNIT_CHOICES[kind].includes(unit))
      found[kind] = { unit, over };
  }
  return found;
}
// The card's settings with the units picked on this device over them.
export function withPickedUnits(config: CardConfig): CardConfig {
  const kept = picks(),
    units: Partial<Record<UnitKind, string>> = {};
  for (const kind of UNIT_KIND_NAMES) {
    const pick = kept[kind];
    if (pick && pick.over === config[kind]) units[kind] = pick.unit;
  }
  return Object.keys(units).length ? { ...config, ...units } : config;
}
// A unit picked for a kind, over the card's own setting for it.
export function pickUnit(kind: UnitKind, unit: string, over: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...picks(), [kind]: { unit, over } }));
  } catch {}
}
