// The parts of Home Assistant's frontend this card reads: the `hass` object it is given,
// entity states, and the websocket calls it makes. Fields are optional where the card
// copes without them (the preview page and older Home Assistant versions leave some
// out). Replies to websocket calls are `unknown` and checked where they are read.

// --- Home Assistant's names ----------------------------------------------------------

// The domains (an entity id's part before the dot) of the entities the card reads.
export const DOMAINS = [
  'weather',
  'sensor',
  'binary_sensor',
  'input_number',
  'number',
  'input_select',
  'select',
  'zone',
] as const;
export type Domain = (typeof DOMAINS)[number];
// Whether `id` names an entity in one of `domains`: weather.home is in 'weather'.
export const inDomain = (id: string | undefined, ...domains: readonly Domain[]): id is string =>
  id !== undefined && domains.some(domain => id.startsWith(`${domain}.`));
// An entity id in one of `domains`, as Home Assistant forms them: lowercase letters, digits
// and underscores after the dot.
export const entityPattern = (...domains: readonly Domain[]): RegExp =>
  new RegExp(`^(${domains.join('|')})\\.[a-z0-9_]+$`);
// The sun, which every installation has.
export const SUN_ENTITY = 'sun.sun';
// The states of an entity with no reading, a switch's off, and sun.sun's two.
export const STATE = {
  unknown: 'unknown',
  unavailable: 'unavailable',
  off: 'off',
  aboveHorizon: 'above_horizon',
  belowHorizon: 'below_horizon',
} as const;
// A weather entity's conditions, by the names the card uses for them.
export const CONDITION = {
  clearNight: 'clear-night',
  cloudy: 'cloudy',
  exceptional: 'exceptional',
  fog: 'fog',
  hail: 'hail',
  lightning: 'lightning',
  lightningRainy: 'lightning-rainy',
  partlyCloudy: 'partlycloudy',
  pouring: 'pouring',
  rainy: 'rainy',
  snowy: 'snowy',
  snowyRainy: 'snowy-rainy',
  sunny: 'sunny',
  windy: 'windy',
  windyVariant: 'windy-variant',
} as const;
export type WeatherCondition = (typeof CONDITION)[keyof typeof CONDITION];
export const WEATHER_CONDITIONS: readonly WeatherCondition[] = Object.values(CONDITION);
export const isCondition = (value: unknown): value is WeatherCondition =>
  WEATHER_CONDITIONS.some(condition => condition === value);
// The forecasts a weather entity offers, as bits of its supported_features.
export const FORECAST_FEATURES = { daily: 1, hourly: 2, twiceDaily: 4 } as const;
// Events for Home Assistant's frontend: open an entity's dialog, change a card's settings
// (from its editor), a form's new values, a tap's haptic feedback, and perform an action.
export const EVENTS = {
  moreInfo: 'hass-more-info',
  configChanged: 'config-changed',
  valueChanged: 'value-changed',
  haptic: 'haptic',
  toggleMenu: 'hass-toggle-menu',
  action: 'hass-action',
} as const;
// Fires `type` from `node` the way Home Assistant's frontend does: bubbling out of shadow roots.
export function fireEvent(node: EventTarget, type: (typeof EVENTS)[keyof typeof EVENTS], detail: unknown): void {
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
// Home Assistant's form element, and the card whose editor defines it (see the editor).
export const HA_FORM = 'ha-form';
export const ENTITIES_CARD = 'hui-entities-card';

// Attributes the card reads from weather, sun, sensor and alert entities, with the types
// Home Assistant gives them. Any other attribute is unknown.
export interface EntityAttributes {
  friendly_name?: string;
  unit_of_measurement?: string;
  device_class?: string;
  supported_features?: number;
  attribution?: string;
  // Where it reports the weather for, if it says.
  latitude?: number;
  longitude?: number;
  // weather.*
  temperature?: number;
  apparent_temperature?: number;
  dew_point?: number;
  temperature_unit?: string;
  humidity?: number;
  cloud_coverage?: number;
  // The cloud's dominant height, supplied explicitly or lent from the forecast hour.
  cloud_altitude?: CloudAltitude;
  uv_index?: number;
  pressure?: number;
  pressure_unit?: string;
  wind_speed?: number;
  wind_gust_speed?: number;
  wind_speed_unit?: string;
  // Degrees, or a compass point from some integrations.
  wind_bearing?: number | string;
  visibility?: number;
  visibility_unit?: string;
  precipitation?: number;
  precipitation_unit?: string;
  // sun.sun: ISO times and degrees.
  next_rising?: string;
  next_setting?: string;
  next_noon?: string;
  elevation?: number;
  rising?: boolean;
  [attribute: string]: unknown;
}

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: EntityAttributes;
  // ISO times: the state itself last changed; the state or an attribute last changed; and the
  // integration last wrote it, changed or not.
  last_changed?: string;
  last_updated?: string;
  last_reported?: string;
}

export interface EntityRegistryEntry {
  device_id?: string | null;
  // The integration, which of its entities this is, and the decimals the user chose to show.
  platform?: string;
  translation_key?: string;
  display_precision?: number;
}

export interface HassConfig {
  // The name Home Assistant gives its home (Settings › System › General).
  location_name?: string;
  latitude?: number;
  longitude?: number;
  time_zone?: string;
  unit_system?: { length?: string };
  // Home's country, as a two-letter code, where it is set.
  country?: string | null;
}

export interface FrontendLocale {
  language?: string;
  // '12' and '24' force a clock; 'language' and 'system' follow the locale.
  time_format?: 'language' | 'system' | '12' | '24';
  // How numbers are written, where it isn't by the language (see numberLocale).
  number_format?: string;
  // The zone times are shown in: the device's, or Home Assistant's.
  time_zone?: 'local' | 'server';
}

export type ForecastType = 'daily' | 'hourly' | 'twice_daily';

// The numeric readings a forecast entry can carry. The card keeps exactly these from what
// Home Assistant streams: `visibility` isn't in Home Assistant's own schema, but some
// integrations add it, and the visibility sheet charts it when they do.
export const FORECAST_READINGS = [
  'temperature',
  'templow',
  'apparent_temperature',
  'dew_point',
  'humidity',
  'cloud_coverage',
  'uv_index',
  'pressure',
  'precipitation',
  'precipitation_probability',
  'wind_speed',
  'wind_gust_speed',
  'visibility',
] as const;
export type ForecastReading = (typeof FORECAST_READINGS)[number];
// The height that holds the most of the cloud: up to about 3 km, up to about 8 km, or above.
export type CloudAltitude = 'low' | 'mid' | 'high';
export const isCloudAltitude = (value: unknown): value is CloudAltitude =>
  value === 'low' || value === 'mid' || value === 'high';
// One forecast entry as the card holds it: a reading the integration doesn't give (or
// gives as null) is missing or undefined, alike. `datetime` is an ISO time.
export type ForecastEntry = Partial<Record<ForecastReading, number | undefined>> & {
  datetime?: string | undefined;
  condition?: string | undefined;
  is_daytime?: boolean | undefined;
  // Degrees, or a compass point from some integrations.
  wind_bearing?: number | string | undefined;
  // The card's own, from the supplement's cover at each height (see cloudAltitude).
  cloud_altitude?: CloudAltitude | undefined;
};

export interface ForecastSubscription {
  type: 'weather/subscribe_forecast';
  entity_id: string;
  forecast_type: ForecastType;
}
export interface HistoryRequest {
  type: 'history/history_during_period';
  start_time: string;
  end_time?: string;
  entity_ids: string[];
  minimal_response?: boolean;
  no_attributes?: boolean;
  significant_changes_only?: boolean;
}
// An action asked for its answer, as the card asks an integration for minute precipitation.
export interface ServiceRequest {
  type: 'call_service';
  domain: string;
  service: string;
  target: { entity_id: string };
  return_response: true;
}
export interface StatisticsRequest {
  type: 'recorder/statistics_during_period';
  start_time: string;
  end_time?: string;
  statistic_ids: string[];
  period: 'hour' | 'day';
  types: ('max' | 'min' | 'mean')[];
  // The units to answer in, which Home Assistant converts the statistics into.
  units?: { temperature?: string };
}

// Ends a subscription. Home Assistant's returns a promise; a stand-in may not.
export type Unsubscribe = () => unknown;

export interface Connection {
  subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription): Promise<Unsubscribe>;
}

export interface HomeAssistant {
  states: Record<string, EntityState>;
  entities?: Record<string, EntityRegistryEntry>;
  config?: HassConfig;
  // The theme in use: dark or not, where Home Assistant says.
  themes?: { darkMode?: boolean };
  locale?: FrontendLocale;
  language?: string;
  connection?: Connection;
  callWS?(message: HistoryRequest | StatisticsRequest | ServiceRequest): Promise<unknown>;
  formatEntityState?(state: EntityState, value?: string): string;
}

// Home Assistant's own form element, which the visual editor reuses: fields by their
// selectors, grouped in grids and expandable sections.
export interface SelectOption {
  value: string;
  label: string;
}
export type Selector =
  | { entity: { domain: Domain | readonly Domain[]; multiple?: boolean } }
  | { text: { type?: 'text' | 'url' } }
  | { boolean: Record<string, never> }
  | { ui_action: { default_action: 'more-info' | 'none' } }
  | { number: { min: number; max: number; step: number; mode: 'box' | 'slider' } }
  | {
      select: {
        mode: 'box' | 'dropdown' | 'list';
        options: readonly SelectOption[];
        multiple?: boolean;
        reorder?: boolean;
        // Buttons in this many columns at most (box mode); three unless set.
        box_max_columns?: number;
      };
    };
// An ha-form field or section. A section with a name keeps its fields' values under that
// name; without one they sit beside the rest. `helper` is the card's own: the line of help
// computeHelper shows under a field.
export interface FormSchemaItem {
  name: string;
  label?: string;
  helper?: string;
  type?: 'grid' | 'expandable';
  title?: string;
  icon?: string;
  expanded?: boolean;
  required?: boolean;
  selector?: Selector;
  schema?: FormSchemaItem[];
}
export interface HaFormElement extends HTMLElement {
  hass: HomeAssistant | undefined;
  schema: FormSchemaItem[];
  data: Record<string, unknown>;
  computeLabel: (item: FormSchemaItem) => string;
  computeHelper: (item: FormSchemaItem) => string | undefined;
}

export interface CardHelpers {
  createCardElement(config: { type: string; [option: string]: unknown }): HTMLElement;
}

// What the card picker offers for an entity: a card's settings, and a label among several.
export interface CardSuggestion {
  config: { type: string; [option: string]: unknown };
  label?: string;
}
// The card picker's entry for a custom card.
export interface CustomCardEntry {
  type: string;
  name: string;
  description?: string;
  preview?: boolean;
  documentationURL?: string;
  getEntitySuggestion?: (hass: HomeAssistant, entityId: string) => CardSuggestion | readonly CardSuggestion[] | null;
}

// The new-dashboard dialog's entry for a community dashboard.
export interface CustomStrategyEntry {
  type: string;
  strategyType: 'dashboard' | 'view';
  name?: string;
  description?: string;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
    customStrategies?: CustomStrategyEntry[];
    // The build of the card that defined it on this page, and the file it came from.
    iWeatherLoaded?: { version: string; from: string };
    loadCardHelpers(): Promise<CardHelpers>;
  }
  interface HTMLElementTagNameMap {
    [HA_FORM]: HaFormElement;
  }
}
