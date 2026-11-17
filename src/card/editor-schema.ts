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
import { isList, isRecord } from '../lib/values.ts';
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
  // What the home view's form goes by: whether there is a live sky, whether it is drawn at low
  // power, whether the temperature is glass, and whether an air quality sensor is set.
  sky: boolean;
  lowPower: boolean;
  glass: boolean;
  air: boolean;
  // What the other forms go by: which forecasts and whether the place's name are shown, whether
  // the card keeps to Home Assistant, whether Open-Meteo fills the forecast, and whether the page
  // has its averages tile.
  showForecast: boolean;
  showDaily: boolean;
  showName: boolean;
  localOnly: boolean;
  fill: boolean;
  averagesTile: boolean;
}
// Three choices stand side by side, or two to a row where the editor is narrow, so their labels
// aren't cut short. Four stand two by two.
const COLUMNS = 3;
const columnsFor = (narrow: boolean): number => (narrow ? 2 : COLUMNS);
// Where averages come from: nowhere, Open-Meteo, or a sensor the form asks for.
const AVERAGES_SOURCES = ['none', OPEN_METEO, 'sensor'] as const;
type AveragesSource = (typeof AVERAGES_SOURCES)[number];
const isAveragesSource = (value: unknown): value is AveragesSource => AVERAGES_SOURCES.some(source => source === value);

// A forecast's length shows with the forecast, and the view while either is there to take it. The
// page's tiles and sheets go by the days whether or not its list shows them.
const forecastSection = ({ layout, showForecast, showDaily }: EditorContext): FormSchemaItem =>
  section(
    'Forecast',
    'mdi:calendar-clock',
    [
      showForecast
        ? grid([flag('show_forecast', 'Hourly forecast'), amount('forecast_hours', 'Hours')])
        : flag('show_forecast', 'Hourly forecast'),
      showDaily || layout === 'page'
        ? grid([flag('show_daily', 'Daily forecast'), amount('forecast_days', 'Days')])
        : flag('show_daily', 'Daily forecast'),
      flag('show_high_low', 'Today’s high and low'),
      ...(showForecast || showDaily ? [forecastView()] : []),
    ],
    true,
  );
const forecastView = (): FormSchemaItem =>
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
        'Larger sizes fit fewer columns and make the page easier to read from across the room.',
      ),
      field(
        'top_padding',
        'Top padding (%)',
        { number: { ...TOP_PADDING_LIMITS, step: 1, mode: 'box' } },
        '50% leaves half the usual space above the weather. Set this to 0 to remove the gap.',
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
        'Automatic opens a sheet on phones and a popover beside the tile on larger screens.',
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
        'Drag tiles to reorder them. Poor air quality, a noticeable feels-like difference or an unusual daily high can move a tile up.',
      ),
    ],
    true,
  );

// What the page asks of services outside Home Assistant, and the map, with its base tiles and
// optional overlays. Local only comes first, as it overrules the rest.
function servicesSection(context: EditorContext): FormSchemaItem {
  // Each interval shows while the card asks its service: the radar's with the online map, and the
  // forecast's while Open-Meteo fills it.
  const online = !context.localOnly,
    refreshes = [
      ...(online && context.map === 'rainviewer'
        ? [
            field(
              'radar_refresh_minutes',
              'Radar refresh (minutes)',
              { number: { ...REFRESH_LIMITS.radar_refresh_minutes, step: 1, mode: 'box' } },
              'How often to check RainViewer for new radar images while the card is visible. Your integrations update on their own schedules.',
            ),
          ]
        : []),
      ...(online && context.fill
        ? [
            field(
              'forecast_refresh_minutes',
              'Forecast refresh (minutes)',
              { number: { ...REFRESH_LIMITS.forecast_refresh_minutes, step: 1, mode: 'box' } },
              'How often to check Open-Meteo for missing forecast data while the card is visible. Your integrations update on their own schedules.',
            ),
          ]
        : []),
    ];
  return section('Map and online services', 'mdi:earth', [
    flag(
      'local_only',
      'Local only',
      'Turns off the built-in online services. A map needs a custom base tile URL. Use local URLs for the base map and overlays to keep requests on your network.',
    ),
    ...(context.localOnly
      ? []
      : [
          flag(
            'open_meteo_forecast',
            'Fill forecast gaps with Open-Meteo',
            'Sends the forecast location to Open-Meteo for missing values, such as rain chances, wind gusts or extra days. Your weather entity takes priority.',
          ),
        ]),
    ...mapFields(context),
    ...(refreshes.length ? [section('Refresh intervals', 'mdi:timer-sync-outline', refreshes)] : []),
  ]);
}
// The map's settings. They stay without the map's tile, as the wind's and the air's sheets draw it too.
function mapFields(context: EditorContext): FormSchemaItem[] {
  return [
    select(
      'map',
      'Map',
      [
        { value: 'none', label: 'None' },
        { value: 'rainviewer', label: 'Online weather and radar' },
        { value: 'local', label: 'Home Assistant weather' },
      ],
      context.localOnly
        ? 'With Local only on, both map sources use Home Assistant readings. Enter your base tile URL under Map tiles.'
        : 'Online adds radar and weather across the map. Home Assistant shows readings at your location and uses OpenStreetMap unless you supply base tiles.',
    ),
    ...(context.map === 'none'
      ? []
      : [
          flag('map_wind_animation', 'Animate wind on the map tile', 'Turn this off for a still preview of the wind.'),
          ...(context.map === 'local' || context.localOnly
            ? []
            : [
                flag(
                  'map_precipitation_animation',
                  'Animate precipitation on the map tile',
                  'Turn this off to show the latest radar image on the tile.',
                ),
              ]),
          section('Map tiles', 'mdi:map-outline', [
            text('map_tile_url', 'Base map', 'Enter an HTTPS tile URL containing {z}, {x} and {y}.', 'url'),
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
  ];
}

// The page's alerts, next hour, air quality and averages. Averages come from nowhere, Open-Meteo
// or a temperature sensor, which the form asks for once chosen.
function sensorsSection(context: EditorContext): FormSchemaItem {
  return section('Alerts and sensors', 'mdi:alert-outline', [
    field(
      'alert_entities',
      'Weather alert sensors',
      { entity: { multiple: true, domain: SETTING_DOMAINS.alert_entities } },
      context.localOnly
        ? 'Choose the Home Assistant sensors that report weather alerts for this location.'
        : 'Choose sensors from NWS Alerts, Meteoalarm or another alert integration. In the US, the card can fetch NWS alerts if you leave this empty.',
    ),
    field(
      'next_hour_entity',
      'Next-hour precipitation',
      { entity: { domain: SETTING_DOMAINS.next_hour_entity } },
      'Choose a weather entity with a short-term precipitation forecast or a sensor with minute-by-minute readings.',
    ),
    field(
      'air_quality_entity',
      'Air quality index',
      { entity: { domain: SETTING_DOMAINS.air_quality_entity } },
      context.localOnly
        ? 'Choose an air quality sensor to compare today’s index with yesterday’s.'
        : 'Choose an AQI sensor to compare today’s reading with yesterday’s. Without a sensor, the page can use Open-Meteo.',
    ),
    // The scale is the sensor's, and the averages are their tile's.
    ...(context.air ? [airScale()] : []),
    ...(context.averagesTile ? averagesFields(context) : []),
  ]);
}
const airScale = (): FormSchemaItem =>
  select(
    'air_quality_scale',
    'Air quality scale',
    [
      { value: AIR_SCALE_AUTO, label: 'Automatic' },
      ...AIR_SCALE_IDS.map(value => ({ value, label: AIR_SCALES[value].name })),
    ],
    'Automatic looks for a scale in the sensor’s name and uses the US scale if it finds no match.',
  );
function averagesFields(context: EditorContext): FormSchemaItem[] {
  return [
    select(
      'averages_source',
      'Averages',
      [
        { value: 'none', label: 'None' },
        { value: OPEN_METEO, label: 'Open-Meteo (1991–2020 averages)' },
        { value: 'sensor', label: 'Temperature sensor history' },
      ],
      context.localOnly
        ? 'For local averages, choose a temperature sensor with at least two years of statistics.'
        : 'Compare today’s high with the average for this date. Open-Meteo also compares precipitation totals for the past 30 days.',
    ),
    ...(context.averages === 'sensor'
      ? [
          field(
            'averages_sensor',
            'Temperature sensor',
            { entity: { domain: SETTING_DOMAINS.averages } },
            'Choose a sensor with at least two years of long-term statistics.',
          ),
        ]
      : []),
  ];
}

// Each field shows where it changes something. The home view names no place; elsewhere a name
// hidden needs no words, though the page's map still names its pin by the town. Without a sky
// there is nothing to animate, to draw at low power, or to see through the raindrops, which low
// power doesn't draw, and which only the layouts with panels have.
const lookSection = (
  columns: number,
  { layout, showName, sky, lowPower, map }: EditorContext,
  compact: boolean,
  home: boolean,
): FormSchemaItem =>
  section('Appearance', 'mdi:palette-outline', [
    ...(home
      ? []
      : showName
        ? [
            grid([
              flag('show_name', 'Show place name'),
              text('name', 'Name', 'Leave blank to use the weather entity’s name.'),
            ]),
            text(
              'place_name',
              'Town or city',
              layout === 'page'
                ? 'Shown in the page heading and on the map pin for locations away from home.'
                : 'If set, this takes priority over Name.',
            ),
          ]
        : [
            flag('show_name', 'Show place name'),
            ...(layout === 'page' && map !== 'none'
              ? [text('place_name', 'Town or city', 'Labels the map pin for locations away from home.')]
              : []),
          ]),
    ...(sky
      ? [
          grid([
            flag('weather_scene', 'Live sky'),
            flag('weather_animation', 'Animation', 'Animation pauses when your device uses reduced motion.'),
          ]),
        ]
      : [flag('weather_scene', 'Live sky')]),
    ...(compact || home || !sky || lowPower
      ? []
      : [
          flag(
            'glass_refraction',
            'Raindrop refraction',
            'Raindrops bend the sky behind them. Turn this off for simpler drops that use less graphics power.',
          ),
        ]),
    ...(sky
      ? [
          flag(
            'low_power',
            'Low power',
            'Draws fewer frames, raindrops and snowflakes to save power on an always-on display.',
          ),
        ]
      : []),
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
            'Moon timeline gives a light tap as you scroll the timeline or move through a detail menu. Everything adds feedback on charts, tiles and forecast controls.',
          ),
        ]),
  ]);

// What the home view shows around its temperature.
// Each field shows only where it changes something: the glass with a sky to bend, its strength
// with the glass on, and the air's scale with a sensor to read.
const homeSection = (columns: number, { sky, lowPower, glass, air }: EditorContext): FormSchemaItem => {
  // Glass is made of the sky, and low power draws none.
  const glassy = sky && !lowPower;
  return homeFields(columns, glassy, glass, air);
};
const homeFields = (columns: number, sky: boolean, glass: boolean, air: boolean): FormSchemaItem =>
  section(
    'Home view',
    'mdi:tablet-dashboard',
    [
      grid([flag('show_high_low', 'Today’s high and low'), flag('show_clock', 'Clock')]),
      ...(sky
        ? [flag('glass_refraction', 'Glass effect on temperature', 'The sky shows through the temperature digits.')]
        : []),
      ...(sky && glass
        ? [
            choice(
              'glass_strength',
              'Glass strength',
              [
                { value: 'subtle', label: 'Subtle' },
                { value: 'standard', label: 'Standard' },
                { value: 'strong', label: 'Strong' },
                { value: 'clear', label: 'Clear' },
              ],
              columns,
              'Stronger settings give the digits a wider edge and bend more of the sky behind them.',
            ),
          ]
        : []),
      choice(
        'homeview_row',
        'Bottom row',
        [
          { value: 'days', label: 'Days ahead' },
          { value: 'details', label: 'Current readings' },
        ],
        columns,
        'Choose which row appears first. Swipe to switch rows or tap an item for details.',
      ),
      choice(
        'sheet_style',
        'Details open as',
        [
          { value: 'auto', label: 'Automatic' },
          { value: 'card', label: 'Over the card' },
          { value: 'popover', label: 'Popover' },
        ],
        columns,
        'Automatic opens details from the bottom of the screen. When the card fills most of the screen, details open within the card.',
      ),
      field(
        'air_quality_entity',
        'Air quality index',
        { entity: { domain: SETTING_DOMAINS.air_quality_entity } },
        'Shows air quality in the bottom row. Leave blank to show the UV index when available.',
      ),
      ...(air ? [airScale()] : []),
    ],
    true,
  );

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
// Compact shows a temperature alone; the home view, the wind beside it and precipitation in its sheets.
const HOME_UNITS: ReadonlySet<string> = new Set(['temperature_unit', 'wind_speed_unit', 'precipitation_unit']);
const unitsSection = (compact: boolean, home = false): FormSchemaItem =>
  section(
    'Units',
    'mdi:ruler',
    UNIT_FIELDS.filter(([name]) => (!compact || name === 'temperature_unit') && (!home || HOME_UNITS.has(name))).map(
      ([name, label]) =>
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
// The home view shows or opens every reading but the pressure.
const HOME_READINGS: ReadonlySet<Reading> = new Set(
  READINGS.map(([attribute]) => attribute).filter(each => each !== 'pressure'),
);
function sourcesSection(
  attributes: EntityAttributes | undefined,
  say: EditorText,
  compact: boolean,
  home = false,
): FormSchemaItem {
  const used = compact ? COMPACT_READINGS : home ? HOME_READINGS : undefined,
    readings = READINGS.filter(([attribute]) => !used || used.has(attribute)),
    missing = (attributes ? missingReadings(attributes) : []).filter(attribute => !used || used.has(attribute)),
    ordered = [...readings].sort(([a], [b]) => Number(missing.includes(b)) - Number(missing.includes(a))),
    fields = ordered.map(([attribute, , label]) =>
      field(
        readingOption(attribute),
        label,
        { entity: { domain: SETTING_DOMAINS.readings } },
        missing.includes(attribute)
          ? 'Your weather entity doesn’t report this reading. You can add a sensor here.'
          : undefined,
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
        'Choose a second weather entity to fill gaps in forecasts and current readings.',
      ),
      field(
        'condition_entity',
        'Condition',
        { entity: { domain: SETTING_DOMAINS.condition_entity } },
        'Choose an entity that reports a weather condition such as sunny or rainy.',
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
      'Choose the Home Assistant zone for this forecast. The sky, moon and map use its coordinates.',
    ),
    text(
      'time_zone',
      'Time zone',
      compact
        ? 'Sets the local clock and the date for today’s high and low. Leave blank to use your profile’s time zone.'
        : 'Use a time zone such as Europe/Paris for forecast dates and times. Leave blank to use your profile’s setting.',
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
    sky: context.sky ?? true,
    lowPower: context.lowPower ?? false,
    glass: context.glass ?? true,
    air: context.air ?? false,
    showForecast: context.showForecast ?? true,
    showDaily: context.showDaily ?? true,
    showName: context.showName ?? true,
    localOnly: context.localOnly ?? false,
    fill: context.fill ?? true,
    averagesTile: context.averagesTile ?? true,
  };
  // Compact and the strip show the current weather alone, so they share a shorter form.
  const compact = full.layout === 'compact' || full.layout === 'strip',
    home = full.layout === 'homeview';
  return [
    { ...field('entity', 'Weather entity', { entity: { domain: SETTING_DOMAINS.entity } }), required: true },
    choice(
      'weather_layout',
      'Layout',
      [
        { value: 'auto', label: 'Automatic' },
        { value: 'compact', label: 'Compact' },
        { value: 'strip', label: 'Strip' },
        { value: 'homeview', label: 'Home view' },
        { value: 'expanded', label: 'Expanded' },
        { value: 'page', label: 'Full page' },
      ],
      2,
      full.layout === 'homeview'
        ? 'A large temperature display and clock, with a four-day forecast or current readings along the bottom.'
        : full.layout === 'strip'
          ? 'Current weather in one row. Wider cards also show today’s high and low.'
          : compact
            ? 'A small tile with the location, temperature, conditions and today’s high and low.'
            : 'Automatic fits the space on your dashboard. Expanded shows hourly and daily forecasts. Full page adds alerts and detail tiles.',
    ),
    ...(home
      ? [homeSection(columnsFor(full.narrow), full), actionsSection(false)]
      : compact
        ? [actionsSection(true), flag('show_high_low', 'Today’s high and low')]
        : [forecastSection(full)]),
    ...(full.layout === 'page'
      ? [pageSection(columnsFor(full.narrow)), servicesSection(full), sensorsSection(full)]
      : []),
    lookSection(columnsFor(full.narrow), full, compact, home),
    ...(compact || home ? [] : [actionsSection(false)]),
    unitsSection(compact, home),
    sourcesSection(full.attributes, say, compact, home),
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
  const { weather_layout: layout, averages_source: averages, map, tiles } = data;
  return {
    layout: isLayout(layout) ? layout : 'auto',
    averages: isAveragesSource(averages) ? averages : 'none',
    map: isMapSource(map) ? map : 'none',
    attributes,
    narrow,
    sky: data['weather_scene'] !== false,
    lowPower: data['low_power'] === true,
    glass: data['glass_refraction'] !== false,
    air: typeof data['air_quality_entity'] === 'string' && data['air_quality_entity'] !== '',
    showForecast: data['show_forecast'] !== false,
    showDaily: data['show_daily'] !== false,
    showName: data['show_name'] !== false,
    localOnly: data['local_only'] === true,
    fill: data['open_meteo_forecast'] !== false,
    averagesTile: !isList(tiles) || tiles.includes('averages'),
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
  show_clock: 'conditions',
  homeview_row: 'conditions',
  glass_strength: 'conditions',
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
  if (part) return [layout === 'compact' || layout === 'strip' || layout === 'homeview' ? 'conditions' : part];
  return Array.isArray(schema) ? [...new Set(schema.flatMap(item => partsOf(item, layout)))] : [];
}
// The parts settings changed.
export const partsChanged = (names: readonly string[], layout?: WeatherLayout): EditedPart[] => [
  ...new Set(names.flatMap(name => partsOf({ name }, layout))),
];
