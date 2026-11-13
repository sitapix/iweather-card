import { OPEN_METEO, type CardConfig } from './config.ts';
import { isCondition, type HomeAssistant } from './home-assistant.ts';
import { weatherAvailable } from '../weather/conditions.ts';
import { readingOption, sensorReadings } from '../weather/sources.ts';
import type { AirNow } from '../cards/air-quality/rules.ts';
import type { PageAlert } from '../cards/alerts/rules.ts';

// Where the page's weather comes from, said at its foot: each integration the page draws from, in
// its own words, and Open-Meteo, which has a link of its own.
export interface Credits {
  // Each source once, the card's own entity first.
  named: string[];
  // Something on the page came from Open-Meteo.
  openMeteo: boolean;
}
export interface CreditInputs {
  config: CardConfig;
  hass: HomeAssistant | undefined;
  // Open-Meteo has filled part of the forecast.
  supplied: boolean;
  alerts: readonly PageAlert[];
  // The next hour's panel is drawn.
  nextHour: boolean;
  air: AirNow | undefined;
  // Normals or the last weeks' precipitation are there for the averages tile.
  averaged: boolean;
}

// An entity is credited only while the page shows something of it: a sensor that is reading, a
// condition that is one, a second entity that is available, the next hour while it is drawn, and
// alerts in force. An alert the card asked for itself names its sender instead. A credit that
// another already says is left out, and so is one naming Open-Meteo while its link is shown.
export function creditsOf({ config, hass, supplied, alerts, nextHour, air, averaged }: CreditInputs): Credits {
  const page = config.weather_layout === 'page',
    tile = (id: CardConfig['tiles'][number]) => page && config.tiles.includes(id),
    state = (id: string | undefined) => (id === undefined ? undefined : hass?.states[id]),
    words = (id: string | undefined) => {
      const attribution = state(id)?.attributes.attribution;
      return typeof attribution === 'string' ? attribution : undefined;
    };
  const sources = [
    words(config.entity),
    isCondition(state(config.condition_entity)?.state) ? words(config.condition_entity) : undefined,
    ...[...sensorReadings(hass, config)].map(reading => words(config[readingOption(reading)])),
    weatherAvailable(state(config.forecast_entity)) ? words(config.forecast_entity) : undefined,
    nextHour ? words(config.next_hour_entity) : undefined,
    tile('air_quality') ? words(air?.entity) : undefined,
    tile('averages') && averaged && config.averages !== OPEN_METEO ? words(config.averages) : undefined,
    ...alerts.map(alert => (state(alert.id) ? words(alert.id) : alert.source)),
  ];
  const openMeteo =
    supplied ||
    (tile('air_quality') && air?.supply !== undefined) ||
    (tile('averages') && averaged && config.averages === OPEN_METEO);
  const named: string[] = [];
  for (const source of sources) {
    const text = source?.trim() ?? '',
      folded = text.toLowerCase();
    if (!text || (openMeteo && folded.includes('open-meteo'))) continue;
    if (named.some(each => each.toLowerCase().includes(folded))) continue;
    named.push(text);
  }
  return { named, openMeteo };
}
