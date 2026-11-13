import { finite } from '../../lib/values.ts';
import type { HomeAssistant } from '../../card/home-assistant.ts';
import type { TileContext } from '../shared/context.ts';
import { AIR_TIERS, airBand, airGlyphFor, airNow, airSentence, airShare } from './rules.ts';
import { AIR_SOURCE } from './open-meteo.ts';
import { scaleBar } from '../shared/tile.ts';
import { esc } from '../../lib/html.ts';
import { rows, sheetHeader, sheetPanel, sheetSection } from '../../sheets/parts.ts';
import { smallValueDigits } from '../../lib/formats.ts';
import type { SheetView } from '../card.ts';
import { phrase, say } from '../../weather/words.ts';
import { mapView } from '../../map/view.ts';
// US AQI sub-indexes (EPA breakpoints) for the pollutant sensors HA offers, in their
// usual units. Gas readings in µg/m³ convert to ppb (ppm for CO) at 25 °C.
const BREAKPOINTS: Readonly<Record<string, readonly (readonly [high: number, index: number])[]>> = {
  pm25: [
    [9, 50],
    [35.4, 100],
    [55.4, 150],
    [125.4, 200],
    [225.4, 300],
    [325.4, 500],
  ],
  pm10: [
    [54, 50],
    [154, 100],
    [254, 150],
    [354, 200],
    [424, 300],
    [604, 500],
  ],
  ozone: [
    [54, 50],
    [70, 100],
    [85, 150],
    [105, 200],
    [200, 300],
  ],
  nitrogen_dioxide: [
    [53, 50],
    [100, 100],
    [360, 150],
    [649, 200],
    [1249, 300],
    [2049, 500],
  ],
  sulphur_dioxide: [
    [35, 50],
    [75, 100],
    [185, 150],
    [304, 200],
    [604, 300],
    [1004, 500],
  ],
  carbon_monoxide: [
    [4.4, 50],
    [9.4, 100],
    [12.4, 150],
    [15.4, 200],
    [30.4, 300],
    [50.4, 500],
  ],
};
const MOLAR: Readonly<Record<string, number>> = {
  ozone: 48,
  nitrogen_dioxide: 46.01,
  sulphur_dioxide: 64.07,
  carbon_monoxide: 28.01,
};
// A pollutant as the sheet names it: its symbol, what a row calls it, what it is in full, and what
// it is and where it comes from. In the order the sheet lists them.
interface PollutantInfo {
  short: string;
  name: string;
  long: string;
  about: string;
}
export const POLLUTANTS: Readonly<Record<string, PollutantInfo>> = {
  carbon_monoxide: {
    short: 'CO',
    name: phrase('Carbon Monoxide'),
    long: phrase('carbon monoxide'),
    about: phrase(
      'An odorless gas left by fuel that doesn’t burn completely, mostly in vehicle exhaust. Breathed in, it keeps the blood from carrying oxygen.',
    ),
  },
  nitrogen_dioxide: {
    short: 'NO2',
    name: phrase('Nitrogen Dioxide'),
    long: phrase('nitrogen dioxide'),
    about: phrase(
      'A reddish-brown gas given off when fuel burns at high heat, in engines, power plants and gas stoves. It inflames the airways.',
    ),
  },
  nitrogen_monoxide: {
    short: 'NO',
    name: phrase('Nitrogen Monoxide'),
    long: phrase('nitrogen monoxide'),
    about: phrase(
      'A colorless gas from engines and furnaces that burn fuel at high heat. In the air it soon turns into nitrogen dioxide.',
    ),
  },
  ozone: {
    short: 'O3',
    name: phrase('Ozone'),
    long: phrase('ozone'),
    about: phrase(
      'Forms near the ground when sunlight acts on pollution from vehicles and industry, so it climbs on hot, still afternoons. It irritates the airways.',
    ),
  },
  pm10: {
    short: 'PM10',
    name: phrase('Particulates Under 10µm'),
    long: phrase('particulate matter under 10µm'),
    about: phrase(
      'Coarser dust that lodges in the nose, throat and lungs. Roads, fields and building sites stir it up, along with pollen and mold.',
    ),
  },
  pm25: {
    short: 'PM2.5',
    name: phrase('Particulates Under 2.5µm'),
    long: phrase('particulate matter under 2.5µm'),
    about: phrase(
      'The finest dust and soot in the air, small enough to get through the lungs into the blood. Most of it is smoke, from fires, engines and chimneys.',
    ),
  },
  sulphur_dioxide: {
    short: 'SO2',
    name: phrase('Sulfur Dioxide'),
    long: phrase('sulfur dioxide'),
    about: phrase(
      'A sharp-smelling gas from burning coal and oil, from smelters and from volcanoes. It irritates the nose, throat and lungs.',
    ),
  },
  volatile_organic_compounds: {
    short: 'VOC',
    name: phrase('Volatile Organic Compounds'),
    long: phrase('volatile organic compounds'),
    about: phrase(
      'Gases given off by paints, solvents, cleaning products and fuels, indoors as well as out. Some irritate the airways, and outdoors they help form ozone.',
    ),
  },
};
// A symbol with its digits set low: PM₂.₅.
const formula = (short: string) => short.replace(/\d[\d.]*$/, '<sub>$&</sub>');
// A pollutant from the name a sensor gives it, its kind or its symbol in any case: pm25, PM2.5, O3.
const plain = (name: string) => name.toLowerCase().replace(/[\W_]/g, '');
const named = (name: string) =>
  Object.entries(POLLUTANTS).find(
    ([kind, { short }]) => plain(kind) === plain(name) || plain(short) === plain(name),
  )?.[1];
// Mass concentrations become parts per billion through the molar volume, 24.45 L at 25 °C;
// carbon monoxide's breakpoints are in parts per million. Past the last band is 500.
const MOLAR_VOLUME = 24.45;
const THOUSAND = 1000;
const INDEX_MAX = 500;
export function pollutantIndex(kind: string, value: number, unit: string | undefined): number | null {
  const bands = BREAKPOINTS[kind];
  if (!bands || !finite(value)) return null;
  let c = value;
  const molar = MOLAR[kind];
  if (molar !== undefined && (unit ?? '').includes('g/m'))
    c =
      (((unit ?? '').startsWith('mg') ? value * THOUSAND : value) * MOLAR_VOLUME) /
      molar /
      (kind === 'carbon_monoxide' ? THOUSAND : 1);
  else if (kind === 'carbon_monoxide' && unit === 'ppb') c = value / THOUSAND;
  else if (molar !== undefined && kind !== 'carbon_monoxide' && unit === 'ppm') c = value * THOUSAND;
  let low = 0,
    lowIndex = 0;
  for (const [high, index] of bands) {
    if (c <= high) return Math.round(lowIndex + ((index - lowIndex) * (c - low)) / (high - low));
    [low, lowIndex] = [high, index];
  }
  return INDEX_MAX;
}
// Pollutant sensors on the AQI sensor's own device, as integrations such as AirNow,
// WAQI and Google Air Quality create them.
export interface Pollutant {
  kind: string;
  value: number;
  unit: string;
  index: number | null;
}
// Sibling ids are found once per entity registry. Their kinds come from the current states,
// which can arrive after the registry or change without replacing it.
const siblings = new WeakMap<object, Map<string, readonly string[]>>();
export function pollutantIds(
  hass: Pick<HomeAssistant, 'entities' | 'states'>,
  aqiEntity: string | undefined,
): readonly string[] {
  const { entities } = hass;
  if (!entities || aqiEntity === undefined) return [];
  const known = siblings.get(entities) ?? new Map<string, readonly string[]>();
  siblings.set(entities, known);
  let ids = known.get(aqiEntity);
  if (!ids) {
    const device = entities[aqiEntity]?.device_id;
    ids = device ? Object.keys(entities).filter(id => entities[id]?.device_id === device && id !== aqiEntity) : [];
    known.set(aqiEntity, ids);
  }
  return ids.filter(id => {
    const kind = hass.states[id]?.attributes.device_class;
    return kind !== undefined && kind in POLLUTANTS;
  });
}
export function pollutantSensors(
  hass: Pick<HomeAssistant, 'entities' | 'states'> | undefined,
  aqiEntity: string | undefined,
): Pollutant[] {
  if (!hass) return [];
  return pollutantIds(hass, aqiEntity).flatMap(id => {
    const state = hass.states[id],
      kind = state?.attributes.device_class;
    if (!state || kind === undefined || !state.state.trim() || !Number.isFinite(Number(state.state))) return [];
    const value = Number(state.state),
      unit = state.attributes.unit_of_measurement ?? '';
    return [{ kind, value, unit, index: pollutantIndex(kind, value, unit) }];
  });
}

// The air quality sheet: the index's category and the scale it is on, the index set against
// yesterday's, what the category means for health, the primary pollutant, every pollutant reading,
// and the sensor's source. Without a breakdown of its pollutants it ends at health.
export function airQualityDetail(
  ctx: Pick<TileContext, 'fmt' | 'hass' | 'config' | 'airYesterday' | 'airSupply'>,
): string {
  const air = airNow(ctx);
  if (!air)
    return `<p class="detail-text">${say('Choose an air quality sensor in the card settings to see air quality.')}</p>`;
  const { value, scale, entity, supply } = air,
    attributes = (entity === undefined ? undefined : ctx.hass?.states[entity]?.attributes) ?? {},
    { name: level, tier } = airBand(scale, value),
    health = AIR_TIERS[tier]?.[1] ?? '',
    // A sensor's come from its device; a reading filled in brings its own.
    measured: Pollutant[] = supply
      ? supply.pollutants.map(p => ({ ...p, index: pollutantIndex(p.kind, p.value, p.unit) }))
      : pollutantSensors(ctx.hass, entity),
    pollutants = [...measured].sort(
      (a, b) => Object.keys(POLLUTANTS).indexOf(a.kind) - Object.keys(POLLUTANTS).indexOf(b.kind),
    );
  // The worst of them, as the sensor names it or else by each one's own index.
  const told = attributes['dominentpol'] ?? attributes['dominant_pollutant'] ?? attributes['primary_pollutant'],
    worst = pollutants
      .filter((p): p is Pollutant & { index: number } => finite(p.index))
      .sort((a, b) => b.index - a.index)[0],
    primary = typeof told === 'string' ? named(told) : worst && POLLUTANTS[worst.kind],
    primaryName = primary
      ? `${formula(primary.short)} (${say(primary.long)})`
      : typeof told === 'string'
        ? esc(told.toUpperCase())
        : '';
  const source = supply ? AIR_SOURCE : attributes['attribution'];
  return `<div class="detail-headline named">${esc(say(level))}</div><div class="detail-sub">${esc(say('Scale: {name}', { name: say(scale.name) }))}</div>
    ${sheetPanel(`<p class="detail-text">${esc(airSentence(scale, ctx.fmt(value), value, air.yesterday))}</p>${scaleBar(scale.stops, airShare(scale, value))}`)}
    ${sheetSection(say('Health Information'), `<p>${say(health)}</p>`)}${
      primaryName
        ? sheetSection(say('Primary Pollutant'), primary ? `<p>${say(primary.about)}</p>` : '', {
            under: `<div class="detail-sub">${primaryName}</div>`,
            plain: !primary,
          })
        : ''
    }${
      pollutants.length
        ? sheetSection(
            say('Pollutant Details'),
            rows(
              pollutants.flatMap((p): [string, string][] => {
                const about = POLLUTANTS[p.kind];
                return about
                  ? [
                      [
                        `${formula(about.short)} ${say(about.name)}`,
                        `${ctx.fmt(p.value, smallValueDigits(p.value))} <small>${esc(p.unit)}</small>`,
                      ],
                    ]
                  : [];
              }),
            ),
          )
        : ''
    }${typeof source === 'string' && source ? `<section class="detail-compare detail-source"><p>${esc(source)}</p></section>` : ''}`;
}
// Over a reading, the map of the air around it (see map/views.ts), where the card has a map.
export function airQualitySheet({ ctx, title }: SheetView): string {
  const air = airNow(ctx),
    map = air && mapView(ctx, 'air_quality') ? '<div class="radar sheet-map" data-kind="air_quality"></div>' : '';
  return `${sheetHeader(airGlyphFor(air?.value ?? Number.NaN, air?.scale), title)}${map}${airQualityDetail(ctx)}`;
}
