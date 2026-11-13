import { AIR_SCALE_AUTO, AIR_SCALE_IDS } from './config.ts';
import { AIR_SCALES } from '../cards/air-quality/scales.ts';
import type { EntityAttributes, FormSchemaItem, Selector } from './home-assistant.ts';
import {
  CARD_TYPE,
  CONFIG_DEFAULTS,
  FORECAST_LIMITS,
  REFRESH_LIMITS,
  TOP_PADDING_LIMITS,
  currentConfig,
  OPEN_METEO,
  SETTING_DOMAINS,
  isLayout,
  isMapSource,
  type MapSource,
  type PageSize,
  type SheetStyle,
  type WeatherLayout,
  type WeatherMode,
} from './config.ts';
import { TILE_CARDS } from '../cards/index.ts';
import { TILES } from '../cards/ids.ts';
import { UNIT_KINDS, type UnitKind } from '../weather/units.ts';
import { READINGS, missingReadings, readingOption, type Reading } from '../weather/sources.ts';
import { isRecord } from '../lib/values.ts';
import { type EditorText, english } from './editor-words.ts';
import type { EditedPart } from './editing.ts';

// The visual editor's fields, kept free of browser APIs so tests can check them. Fields have
// short labels and a line of help under them (see computeHelper in the editor); sections
// appear only where they apply: the full page's options with the Full layout, the map's tiles
// with a map, an averages sensor when averages come from one.
const field = (name: string, label: string, selector: Selector, helper?: string): FormSchemaItem => ({
  name,
  label,
  selector,
  ...(helper ? { helper } : {}),
});
// The values each select offers, as the card's settings name them; a unit's are its units.
interface SelectValues {
  weather_layout: WeatherLayout;
  weather_mode: WeatherMode;
  size: PageSize;
  sheet_style: SheetStyle;
  map: MapSource;
  averages_source: AveragesSource;
}
type Options<K extends string> = readonly {
  value: K extends keyof SelectValues ? SelectValues[K] : string;
  label: string;
}[];
// A select as buttons (`choice`), always set, in at most `columns` columns; or as a dropdown
// (`select`), whose × puts its default back (see `filled`). Neither is marked required, which
// would add a star to a field that always has a value.
const choice = <K extends string>(
  name: K,
  label: string,
  options: Options<K>,
  columns: number,
  helper?: string,
): FormSchemaItem => ({
  ...field(name, label, { select: { mode: 'box', options, box_max_columns: columns } }, helper),
  // Buttons show no star, and required keeps them from offering to clear.
  required: true,
});
const select = <K extends string>(name: K, label: string, options: Options<K>, helper?: string): FormSchemaItem =>
  field(name, label, { select: { mode: 'dropdown', options } }, helper);
const flag = (name: string, label: string, helper?: string): FormSchemaItem =>
  field(name, label, { boolean: {} }, helper);
const amount = (name: keyof typeof FORECAST_LIMITS, label: string): FormSchemaItem =>
  field(name, label, { number: { ...FORECAST_LIMITS[name], step: 1, mode: 'box' } });
const text = (name: string, label: string, helper?: string, type?: 'url'): FormSchemaItem =>
  field(name, label, { text: type ? { type } : {} }, helper);
const grid = (schema: FormSchemaItem[]): FormSchemaItem => ({ type: 'grid', name: '', schema });
// A section; with a name its fields' values sit under that name in the card's settings.
const section = (
  title: string,
  icon: string,
  schema: FormSchemaItem[],
  expanded = false,
  name = '',
): FormSchemaItem => ({
  type: 'expandable',
  name,
  title,
  icon,
  ...(expanded ? { expanded } : {}),
  schema,
});

// What the form shows depends on: the layout, where averages come from, whether there is a map,
// which readings the weather entity lacks, and whether the editor is narrow, as on a phone.
export interface EditorContext {
  layout: WeatherLayout;
  averages: AveragesSource;
  map: MapSource;
  attributes: EntityAttributes | undefined;
  narrow: boolean;
}
// Three choices stand side by side, or two to a row where the editor is narrow, so their labels
// aren't cut short. Four stand two by two.
const COLUMNS = 3;
const columnsFor = (narrow: boolean): number => (narrow ? 2 : COLUMNS);
// Where averages come from: nowhere, Open-Meteo, or a sensor the form asks for.
const AVERAGES_SOURCES = ['none', OPEN_METEO, 'sensor'] as const;
type AveragesSource = (typeof AVERAGES_SOURCES)[number];
const isAveragesSource = (value: unknown): value is AveragesSource => AVERAGES_SOURCES.some(source => source === value);

const forecastSection = (): FormSchemaItem =>
  section(
    'Forecast',
    'mdi:calendar-clock',
    [
      grid([flag('show_forecast', 'Hourly forecast'), amount('forecast_hours', 'Hours')]),
      grid([flag('show_daily', 'Daily forecast'), amount('forecast_days', 'Days')]),
      flag('show_high_low', 'High and low'),
      choice(
        'weather_mode',
        'Hourly view',
        [
          { value: 'auto', label: 'Automatic' },
          { value: 'conditions', label: 'Conditions' },
          { value: 'rain', label: 'Precipitation' },
          { value: 'wind', label: 'Wind' },
        ],
        2,
      ),
    ],
    true,
  );

// The full page: three sections, for its tiles, the services it reaches out to, and the alerts
// and sensors its panels and tiles read. They show only with the Full page layout.
const pageSection = (columns: number): FormSchemaItem =>
  section(
    'Full page',
    'mdi:view-dashboard-variant',
    [
      choice(
        'size',
        'Size',
        [
          { value: 'standard', label: 'Standard' },
          { value: 'large', label: 'Large' },
          { value: 'extra_large', label: 'Extra large' },
        ],
        columns,
        'Larger text and tiles, with fewer columns, for a screen you read from across the room.',
      ),
      field(
        'top_padding',
        'Top padding (%)',
        { number: { ...TOP_PADDING_LIMITS, step: 1, mode: 'box' } },
        'Space above the current weather. 50% is half the original spacing; 100% restores it.',
      ),
      choice(
        'sheet_style',
        'Tile details',
        [
          { value: 'auto', label: 'Automatic' },
          { value: 'sheet', label: 'Sheet' },
          { value: 'popover', label: 'Popover' },
        ],
        columns,
        'Automatic slides a sheet up on a phone, and opens a popover beside the tile on anything larger.',
      ),
      field(
        'tiles',
        'Tiles',
        {
          select: {
            multiple: true,
            reorder: true,
            mode: 'list',
            options: TILES.map(value => ({ value, label: TILE_CARDS[value].label })),
          },
        },
        'Drag to reorder. Poor air quality goes first. Feels like moves up when it’s 5 °F or more from the temperature, and Averages when today’s high is outside its normal range.',
      ),
    ],
    true,
  );

// What the page asks of services outside Home Assistant, and the map, with its base tiles and
// optional overlays. Local only comes first, as it overrules the rest.
function servicesSection(context: EditorContext): FormSchemaItem {
  return section('Map and online services', 'mdi:earth', [
    flag(
      'local_only',
      'Local only',
      'The card contacts no outside service, whatever you set below: no Open-Meteo, no radar. The map appears only with map tiles of your own.',
    ),
    flag(
      'open_meteo_forecast',
      'Fill the forecast from Open-Meteo',
      'When your weather entity leaves out rain chances, gusts or days. Its own values come first. The card sends the weather’s location to Open-Meteo.',
    ),
    select(
      'map',
      'Map',
      [
        { value: 'none', label: 'None' },
        { value: 'rainviewer', label: 'Online: radar and wind (recommended)' },
        { value: 'local', label: 'Home Assistant data only' },
      ],
      'The map shows wind in the Wind view and precipitation in the Precipitation view. Otherwise it shows the first that applies: precipitation falling or due soon, poor air quality, or wind on a windy dry day. Online adds RainViewer radar and wind across the map from Open-Meteo, with no integration or key. With Home Assistant data only, the card loads the base map from OpenStreetMap unless you set your own map tiles.',
    ),
    ...(context.map === 'none'
      ? []
      : [
          flag('map_wind_animation', 'Moving wind on the card', 'Off, the wind holds still until you open the map.'),
          ...(context.map === 'local'
            ? []
            : [
                flag(
                  'map_precipitation_animation',
                  'Moving precipitation on the card',
                  'Off, precipitation holds still until you open the map.',
                ),
              ]),
          section('Map tiles', 'mdi:map-outline', [
            text('map_tile_url', 'Base map', 'An https URL with {z}, {x} and {y}. Default: OpenStreetMap.', 'url'),
            section(
              'Overlays',
              'mdi:layers-outline',
              (
                [
                  ['precipitation', 'Precipitation'],
                  ['wind', 'Wind'],
                  ['air_quality', 'Air quality'],
                  ['temperature', 'Temperature'],
                ] as const
              ).map(([name, label]) => text(name, label, undefined, 'url')),
              false,
              'map_layers',
            ),
          ]),
        ]),
    section('Refresh intervals', 'mdi:timer-sync-outline', [
      field(
        'radar_refresh_minutes',
        'Radar refresh (minutes)',
        { number: { ...REFRESH_LIMITS.radar_refresh_minutes, step: 1, mode: 'box' } },
        'How often the card checks RainViewer for new radar frames. Your integrations keep their own update intervals.',
      ),
      field(
        'forecast_refresh_minutes',
        'Forecast refresh (minutes)',
        { number: { ...REFRESH_LIMITS.forecast_refresh_minutes, step: 1, mode: 'box' } },
        'How often the card asks Open-Meteo for the forecast it fills in. Your integrations keep their own update intervals.',
      ),
    ]),
  ]);
}

// The page's alerts, next hour, air quality and averages. Averages come from nowhere, Open-Meteo
// or a temperature sensor, which the form asks for once chosen.
function sensorsSection(context: EditorContext): FormSchemaItem {
  return section('Alerts and sensors', 'mdi:alert-outline', [
    field(
      'alert_entities',
      'Severe weather alerts',
      { entity: { multiple: true, domain: SETTING_DOMAINS.alert_entities } },
      'Sensors from NWS Alerts, Meteoalarm or similar. Shown first on the page.',
    ),
    field(
      'next_hour_entity',
      'Next-hour precipitation',
      { entity: { domain: SETTING_DOMAINS.next_hour_entity } },
      'A nowcast weather entity, or a sensor listing minute-by-minute precipitation.',
    ),
    field(
      'air_quality_entity',
      'Air quality index',
      { entity: { domain: SETTING_DOMAINS.air_quality_entity } },
      'Compared with yesterday from history.',
    ),
    select(
      'air_quality_scale',
      'Air quality scale',
      [
        { value: AIR_SCALE_AUTO, label: 'Automatic' },
        ...AIR_SCALE_IDS.map(value => ({ value, label: AIR_SCALES[value].name })),
      ],
      'Automatic reads the scale from the sensor’s name, or else uses the US scale, which many services report worldwide.',
    ),
    select(
      'averages_source',
      'Averages',
      [
        { value: 'none', label: 'None' },
        { value: OPEN_METEO, label: 'Open-Meteo (1991–2020 normals)' },
        { value: 'sensor', label: 'A temperature sensor’s history' },
      ],
      'Today’s high against the normal, and how the last 30 days compare.',
    ),
    ...(context.averages === 'sensor'
      ? [
          field(
            'averages_sensor',
            'Temperature sensor',
            { entity: { domain: SETTING_DOMAINS.averages } },
            'Needs at least two years of long-term statistics.',
          ),
        ]
      : []),
  ]);
}

const lookSection = (columns: number, compact: boolean): FormSchemaItem =>
  section('Look', 'mdi:palette-outline', [
    grid([flag('show_name', 'Place name'), text('name', 'Name', 'Instead of the weather entity’s name.')]),
    text('place_name', 'Town or city', 'Shown as the place name. Overrides Name.'),
    grid([flag('weather_scene', 'Live sky'), flag('weather_animation', 'Animation', 'Off with reduced motion.')]),
    ...(compact
      ? []
      : [
          flag(
            'glass_refraction',
            'Glass refraction',
            'Distort the sky through raindrops. Off keeps droplets and highlights.',
          ),
        ]),
    flag(
      'low_power',
      'Low power',
      'For a wall tablet or an older screen: a softer sky, fewer frames and less rain and snow.',
    ),
    ...(compact
      ? []
      : [
          choice(
            'haptics',
            'Haptic feedback',
            [
              { value: 'moon', label: 'Moon timeline' },
              { value: 'all', label: 'Everything' },
              { value: 'off', label: 'Off' },
            ],
            columns,
            'The moon timeline ticks at each mark it passes, and a sheet’s menu at each sheet your held finger passes. Everything adds a tap when you switch views or days, read a chart or press a tile.',
          ),
        ]),
  ]);

const actionsSection = (expanded: boolean): FormSchemaItem =>
  section(
    'Interactions',
    'mdi:gesture-tap',
    [
      field('tap_action', 'Tap', { ui_action: { default_action: 'more-info' } }),
      field('hold_action', 'Hold', { ui_action: { default_action: 'none' } }),
      field('double_tap_action', 'Double tap', { ui_action: { default_action: 'none' } }),
    ],
    expanded,
  );

const UNIT_FIELDS = [
  ['temperature_unit', 'Temperature'],
  ['wind_speed_unit', 'Wind'],
  ['precipitation_unit', 'Precipitation'],
  ['pressure_unit', 'Pressure'],
  ['distance_unit', 'Distance'],
] as const satisfies readonly (readonly [UnitKind, string])[];
const unitsSection = (compact: boolean): FormSchemaItem =>
  section(
    'Units',
    'mdi:ruler',
    UNIT_FIELDS.filter(([name]) => !compact || name === 'temperature_unit').map(([name, label]) =>
      select(name, label, [
        { value: 'auto', label: 'Weather entity’s units' },
        ...UNIT_KINDS[name].options.map(([value, text]) => ({ value, label: text })),
      ]),
    ),
  );

// Other integrations or sensors for what the weather entity lacks: readings it doesn't provide
// come first, marked, so it is clear which sensors would fill a gap.
// Compact still uses these to refine its condition name and sky (see sceneInputs and skyKind),
// even without a tile displaying the reading itself.
const COMPACT_READINGS: ReadonlySet<Reading> = new Set([
  'temperature',
  'humidity',
  'dew_point',
  'wind_speed',
  'visibility',
  'cloud_coverage',
  'precipitation',
]);
function sourcesSection(attributes: EntityAttributes | undefined, say: EditorText, compact: boolean): FormSchemaItem {
  const readings = READINGS.filter(([attribute]) => !compact || COMPACT_READINGS.has(attribute)),
    missing = (attributes ? missingReadings(attributes) : []).filter(
      attribute => !compact || COMPACT_READINGS.has(attribute),
    ),
    ordered = [...readings].sort(([a], [b]) => Number(missing.includes(b)) - Number(missing.includes(a))),
    fields = ordered.map(([attribute, , label]) =>
      field(
        readingOption(attribute),
        label,
        { entity: { domain: SETTING_DOMAINS.readings } },
        missing.includes(attribute) ? 'Your weather entity doesn’t provide this.' : undefined,
      ),
    );
  return section(
    missing.length ? say('Data sources · {count} missing').replace('{count}', String(missing.length)) : 'Data sources',
    'mdi:database-arrow-down-outline',
    [
      field(
        'forecast_entity',
        'Forecast',
        { entity: { domain: SETTING_DOMAINS.forecast_entity } },
        'Another weather entity, for forecasts and details yours lacks.',
      ),
      field(
        'condition_entity',
        'Condition',
        { entity: { domain: SETTING_DOMAINS.condition_entity } },
        'Another weather entity, or a sensor whose state is a condition.',
      ),
      ...(compact
        ? [
            ...fields.filter(item => item.name === 'temperature_entity'),
            section(
              'Conditions',
              'mdi:weather-partly-cloudy',
              fields.filter(item => item.name !== 'temperature_entity'),
            ),
          ]
        : fields),
    ],
  );
}

const advancedSection = (compact: boolean): FormSchemaItem =>
  section('Advanced', 'mdi:cog-outline', [
    field(
      'zone',
      'Location',
      { entity: { domain: SETTING_DOMAINS.zone } },
      'A zone, for weather away from home: the sky, moon and map follow it. Set its time zone below.',
    ),
    text(
      'time_zone',
      'Time zone',
      compact
        ? 'For the local clock and today’s high and low. Default: Home Assistant’s.'
        : 'For the forecast’s hours and days, as an IANA name. Default: Home Assistant’s.',
    ),
  ]);

// The form for a context: the weather entity and the layout first, then sections by what
// they change.
export function schemaFor(context: Partial<EditorContext> = {}, say: EditorText = english): FormSchemaItem[] {
  const full: EditorContext = {
    layout: context.layout ?? 'auto',
    averages: context.averages ?? 'none',
    map: context.map ?? 'none',
    attributes: context.attributes,
    narrow: context.narrow ?? false,
  };
  // Compact and the strip show the current weather alone, so they share a shorter form.
  const compact = full.layout === 'compact' || full.layout === 'strip';
  return [
    { ...field('entity', 'Weather entity', { entity: { domain: SETTING_DOMAINS.entity } }), required: true },
    choice(
      'weather_layout',
      'Layout',
      [
        { value: 'auto', label: 'Automatic' },
        { value: 'compact', label: 'Compact' },
        { value: 'strip', label: 'Strip' },
        { value: 'expanded', label: 'Expanded' },
        { value: 'page', label: 'Full page' },
      ],
      2,
      full.layout === 'strip'
        ? 'Strip shows current weather in one line. The card keeps your settings for other layouts when you switch.'
        : compact
          ? 'Compact shows current weather only. The card keeps your settings for other layouts when you switch.'
          : 'Automatic fits the card’s size. Full page adds alerts, tiles, averages and a map, and scrolls in place in a panel view.',
    ),
    ...(compact ? [actionsSection(true), flag('show_high_low', 'High and low')] : [forecastSection()]),
    ...(full.layout === 'page'
      ? [pageSection(columnsFor(full.narrow)), servicesSection(full), sensorsSection(full)]
      : []),
    lookSection(columnsFor(full.narrow), compact),
    ...(compact ? [] : [actionsSection(false)]),
    unitsSection(compact),
    sourcesSection(full.attributes, say, compact),
    advancedSection(compact),
  ];
}
// --- Settings and the form's values -------------------------------------------------
// The form shows every default; the card's settings keep only what differs from them, so
// the YAML says what was chosen. Averages appear as a source and a sensor.
const DEFAULTS: Readonly<Record<string, unknown>> = {
  ...CONFIG_DEFAULTS,
  map: 'none',
  air_quality_scale: AIR_SCALE_AUTO,
};
const averagesSource = (averages: unknown): AveragesSource =>
  averages === OPEN_METEO ? OPEN_METEO : typeof averages === 'string' && averages ? 'sensor' : 'none';
export function formData(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { averages, ...rest } = currentConfig(config);
  return {
    ...DEFAULTS,
    ...rest,
    averages_source: averagesSource(averages),
    ...(averagesSource(averages) === 'sensor' ? { averages_sensor: averages } : {}),
  };
}
// The dropdowns, which a × clears: cleared, each shows its default again rather than nothing,
// and the settings leave it out.
const DROPDOWNS: Readonly<Record<string, unknown>> = {
  map: DEFAULTS['map'],
  air_quality_scale: DEFAULTS['air_quality_scale'],
  averages_source: averagesSource(undefined),
  ...Object.fromEntries(UNIT_FIELDS.map(([name]) => [name, DEFAULTS[name]])),
};
export function filled(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = { ...data };
  for (const [name, value] of Object.entries(DROPDOWNS))
    if (result[name] === undefined || result[name] === '') result[name] = value;
  return result;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export function configFrom(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { averages_source: source, averages_sensor: sensor, map_layers: layers, ...rest } = data;
  const config: Record<string, unknown> = { type: CARD_TYPE };
  for (const [key, value] of Object.entries(rest))
    if (key !== 'type' && value !== undefined && value !== '' && !same(value, DEFAULTS[key])) config[key] = value;
  if (source === OPEN_METEO) config['averages'] = OPEN_METEO;
  else if (source === 'sensor' && typeof sensor === 'string' && sensor) config['averages'] = sensor;
  const overlays = isRecord(layers)
    ? Object.fromEntries(Object.entries(layers).filter(([, url]) => typeof url === 'string' && url.trim() !== ''))
    : {};
  if (Object.keys(overlays).length) config['map_layers'] = overlays;
  return config;
}
// The form in a language: every label, line of help, title and option.
export function inWords(schema: readonly FormSchemaItem[], say: EditorText): FormSchemaItem[] {
  return schema.map(item => {
    const { label, helper, title, selector, schema: inner } = item,
      options = selector && 'select' in selector ? selector.select.options : undefined;
    return {
      ...item,
      ...(label === undefined ? {} : { label: say(label) }),
      ...(helper === undefined ? {} : { helper: say(helper) }),
      ...(title === undefined ? {} : { title: say(title) }),
      ...(selector && 'select' in selector && options
        ? {
            selector: {
              select: { ...selector.select, options: options.map(option => ({ ...option, label: say(option.label) })) },
            },
          }
        : {}),
      ...(inner ? { schema: inWords(inner, say) } : {}),
    };
  });
}

// What decides the form's shape, from its values; the form is rebuilt only when it changes.
export function contextOf(
  data: Readonly<Record<string, unknown>>,
  attributes: EntityAttributes | undefined,
  narrow = false,
): EditorContext {
  const { weather_layout: layout, averages_source: averages, map } = data;
  return {
    layout: isLayout(layout) ? layout : 'auto',
    averages: isAveragesSource(averages) ? averages : 'none',
    map: isMapSource(map) ? map : 'none',
    attributes,
    narrow,
  };
}
// Fields typed into: their changes reach the preview after a pause (see the editor).
export const TYPED: ReadonlySet<string> = new Set([
  'name',
  'place_name',
  'time_zone',
  'map_tile_url',
  'map_layers',
  'forecast_hours',
  'forecast_days',
  'radar_refresh_minutes',
  'forecast_refresh_minutes',
]);

// --- The part of the card a setting changes ---------------------------------------
// The preview shows it while the setting is edited (see editing.ts). Settings that change the
// whole card, or nothing to be seen, have none.
const PARTS: Readonly<Record<string, EditedPart>> = {
  show_forecast: 'forecast',
  forecast_hours: 'forecast',
  weather_mode: 'forecast',
  forecast_entity: 'forecast',
  time_zone: 'forecast',
  show_daily: 'daily',
  forecast_days: 'daily',
  show_high_low: 'conditions',
  show_name: 'conditions',
  name: 'conditions',
  place_name: 'conditions',
  weather_scene: 'conditions',
  weather_animation: 'conditions',
  glass_refraction: 'forecast',
  low_power: 'conditions',
  tap_action: 'conditions',
  hold_action: 'conditions',
  double_tap_action: 'conditions',
  condition_entity: 'conditions',
  size: 'tiles',
  top_padding: 'conditions',
  sheet_style: 'tiles',
  tiles: 'tiles',
  alert_entities: 'alerts',
  next_hour_entity: 'next_hour',
  air_quality_entity: 'air_quality',
  air_quality_scale: 'air_quality',
  averages_source: 'averages',
  averages_sensor: 'averages',
  map: 'map',
  map_wind_animation: 'map',
  map_precipitation_animation: 'map',
  map_tile_url: 'map',
  map_layers: 'map',
  temperature_unit: 'conditions',
  wind_speed_unit: 'wind',
  precipitation_unit: 'precipitation',
  pressure_unit: 'pressure',
  distance_unit: 'visibility',
  [readingOption('temperature')]: 'conditions',
  [readingOption('apparent_temperature')]: 'feels_like',
  [readingOption('humidity')]: 'humidity',
  [readingOption('dew_point')]: 'humidity',
  [readingOption('pressure')]: 'pressure',
  [readingOption('uv_index')]: 'uv',
  [readingOption('wind_speed')]: 'wind',
  [readingOption('wind_gust_speed')]: 'wind',
  [readingOption('wind_bearing')]: 'wind',
  [readingOption('visibility')]: 'visibility',
  [readingOption('cloud_coverage')]: 'conditions',
  [readingOption('precipitation')]: 'precipitation',
};
// The parts a field changes, or a section's fields in turn, from the form's own record of it.
export function partsOf(item: unknown, layout?: WeatherLayout): EditedPart[] {
  if (!isRecord(item)) return [];
  const { name, schema } = item,
    part = typeof name === 'string' ? PARTS[name] : undefined;
  if (part) return [layout === 'compact' || layout === 'strip' ? 'conditions' : part];
  return Array.isArray(schema) ? [...new Set(schema.flatMap(item => partsOf(item, layout)))] : [];
}
// The parts settings changed.
export const partsChanged = (names: readonly string[], layout?: WeatherLayout): EditedPart[] => [
  ...new Set(names.flatMap(name => partsOf({ name }, layout))),
];
