import { languageOf } from '../src/weather/language.ts';
import type { GlassStrength, WeatherLayout } from '../src/card/config.ts';
import { GLASS_DEFAULTS, GLASS_OPTIONS, GLASS_STRENGTHS } from '../src/card/glass-options.ts';
import type { CloudAltitude } from '../src/card/home-assistant.ts';
import { copyYaml } from './copy-yaml.ts';
import { House } from './house.ts';
import { type Place, findPlaces, liveWeather } from './live.ts';
import { SYMBOLS, type SymbolName } from '../src/weather/symbols.ts';
import {
  CLOUD_HEIGHTS,
  DEFAULT_CLOUDS,
  DEFAULT_WEATHER,
  LANGUAGES,
  type Theme,
  type Units,
  WEATHERS,
  type World,
  cardSettings,
  hasCloudHeight,
  sampleWorld,
  weatherById,
  withAlert,
  yaml,
} from './world.ts';

// The demo page: its controls, and the card they drive, handed a stand-in Home Assistant as a
// dashboard hands it the real one. The choices live in the address's hash, so a scene can be
// linked to.

const CARD_TAG = 'iweather-card';
type Screen = 'phone' | 'tablet' | 'desktop';
const LAYOUTS: readonly WeatherLayout[] = ['page', 'expanded', 'auto', 'homeview', 'compact', 'strip'];
const SCREENS: readonly Screen[] = ['phone', 'tablet', 'desktop'];
const UNIT_CHOICES: readonly Units[] = ['us', 'metric'];
const THEMES: readonly Theme[] = ['light', 'dark'];
const HOURS = 24;
const MINUTE = 60_000;
const OPENING_HOUR = 13;
// Each sample weather's symbol, the card's own. Wind with cloud has the wind over a cloud.
const WEATHER_SYMBOLS: Readonly<Record<string, readonly SymbolName[]>> = {
  clear: ['sun'],
  'partly-cloudy': ['cloud-sun'],
  'mostly-cloudy': ['cloud-sun'],
  cloudy: ['cloud'],
  fog: ['fog'],
  rain: ['rain'],
  downpour: ['heavy-rain'],
  thunderstorm: ['storm-rain'],
  lightning: ['sun-storm'],
  snow: ['snow'],
  sleet: ['sleet'],
  hail: ['hail'],
  windy: ['wind'],
  'wind-and-cloud': ['cloud', 'wind'],
};
// The countries that measure in °F and miles.
const FAHRENHEIT_REGIONS = /-(us|lr|mm)$/i;
// How long a position may be, and how long to wait for one.
const LOCATION_AGE = 10 * 60 * 1000;
const LOCATION_WAIT = 15 * 1000;

interface Choices {
  weather: string;
  hour: number;
  // How high the clouds stand, for a weather whose sky differs by it.
  clouds: CloudAltitude;
  layout: WeatherLayout;
  glass: boolean;
  strength: GlassStrength;
  screen: Screen;
  // A phone or tablet on its side, which only the page layout, a whole screen, shows.
  turned: boolean;
  units: Units;
  theme: Theme;
  language: string;
  alert: boolean;
}

function query<T extends Element>(selector: string, type: { new (): T; prototype: T }, root: ParentNode = document): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`The page has no ${selector}.`);
  return element;
}
const oneOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T): T =>
  choices.find(choice => choice === value) ?? fallback;

// The visitor's own language, where the card speaks it, and their units.
function opening(): Choices {
  const spoken = navigator.languages.flatMap(tag => {
    const found = LANGUAGES.find(([code]) => code === languageOf(tag));
    return found ? [found[0]] : [];
  });
  const first = navigator.languages[0] ?? 'en-US';
  return {
    weather: DEFAULT_WEATHER,
    hour: OPENING_HOUR,
    clouds: DEFAULT_CLOUDS,
    layout: 'page',
    glass: GLASS_DEFAULTS.glass_refraction,
    strength: GLASS_DEFAULTS.glass_strength,
    // The default fills the preview as the window resizes. Phone and tablet widths are opt-in.
    screen: 'desktop',
    turned: false,
    units: FAHRENHEIT_REGIONS.test(first) || first === 'en' ? 'us' : 'metric',
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    language: spoken[0] ?? 'en',
    alert: false,
  };
}
const OPENING = opening();

// The choices in a hash, each one checked, and the choices as one: only those not the opening's.
function fromHash(hash: string): Choices {
  const params = new URLSearchParams(hash.replace(/^#/, '')),
    hour = Number(params.get('hour') ?? OPENING.hour),
    flag = (key: 'glass' | 'turned' | 'alert') =>
      oneOf(['on', 'off'], params.get(key), OPENING[key] ? 'on' : 'off') === 'on';
  return {
    weather: weatherById(params.get('weather') ?? OPENING.weather).id,
    hour: Number.isInteger(hour) && hour >= 0 && hour < HOURS ? hour : OPENING.hour,
    clouds: oneOf(
      CLOUD_HEIGHTS.map(([height]) => height),
      params.get('clouds'),
      OPENING.clouds,
    ),
    layout: oneOf(LAYOUTS, params.get('layout'), OPENING.layout),
    glass: flag('glass'),
    strength: oneOf(GLASS_STRENGTHS, params.get('strength'), OPENING.strength),
    screen: oneOf(SCREENS, params.get('screen'), OPENING.screen),
    turned: flag('turned'),
    units: oneOf(UNIT_CHOICES, params.get('units'), OPENING.units),
    theme: oneOf(THEMES, params.get('theme'), OPENING.theme),
    language: oneOf(
      LANGUAGES.map(([code]) => code),
      params.get('language'),
      OPENING.language,
    ),
    alert: flag('alert'),
  };
}
const KEYS = [
  'weather',
  'hour',
  'clouds',
  'layout',
  'glass',
  'strength',
  'screen',
  'turned',
  'units',
  'theme',
  'language',
  'alert',
] as const satisfies readonly (keyof Choices)[];
function toHash(choices: Choices): string {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = choices[key];
    if (value !== OPENING[key]) params.set(key, typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value));
  }
  const text = params.toString();
  return text ? `#${text}` : '';
}

const form = query('form.controls', HTMLFormElement),
  stage = query('.stage', HTMLDivElement),
  frame = query('.frame', HTMLDivElement),
  code = query('code.yaml', HTMLElement),
  clock = query('output[name=clock]', HTMLOutputElement),
  hourInput = query('input[name=hour]', HTMLInputElement),
  status = query('.real-status', HTMLParagraphElement),
  places = query('ul.places', HTMLUListElement),
  real = query('fieldset.real', HTMLFieldSetElement),
  heights = query('fieldset.clouds', HTMLFieldSetElement),
  homeGlass = query('.home-glass', HTMLDivElement),
  glassBox = query('input[name=glass]', HTMLInputElement),
  glassStrength = query('fieldset.glass-strength', HTMLFieldSetElement),
  here = query('button.here', HTMLButtonElement),
  search = query('input[name=place]', HTMLInputElement),
  alertBox = query('input[name=alert]', HTMLInputElement),
  turnBox = query('input[name=turned]', HTMLInputElement),
  settingsDialog = query('dialog.settings', HTMLDialogElement),
  getYaml = query('#get-yaml', HTMLButtonElement),
  alertNote = query('.alert-note', HTMLElement),
  copy = query('button.copy', HTMLButtonElement),
  copyFeedback = query('.copy-feedback', HTMLElement);

// The controls, from the sample weather and the card's glass options and languages.
query('[data-name=strength]', HTMLDivElement).innerHTML = GLASS_OPTIONS.map(
  ({ value, label }) => `<label><input type="radio" name="strength" value="${value}"><span>${label}</span></label>`,
).join('');
query('[data-name=weather]', HTMLDivElement).innerHTML = WEATHERS.map(
  weather =>
    `<label><input type="radio" name="weather" value="${weather.id}"><span><i aria-hidden="true">${(
      WEATHER_SYMBOLS[weather.id] ?? []
    )
      .map(name => SYMBOLS[name])
      .join('')}</i>${weather.label}</span></label>`,
).join('');
query('[data-name=clouds]', HTMLDivElement).innerHTML = CLOUD_HEIGHTS.map(
  ([height, label]) => `<label><input type="radio" name="clouds" value="${height}"><span>${label}</span></label>`,
).join('');
query('select[name=language]', HTMLSelectElement).innerHTML = LANGUAGES.map(
  ([language, name]) => `<option value="${language}" lang="${language}">${name}</option>`,
).join('');

// On narrow screens the same radio choices are available in native menus.
const compactPickers = (['layout', 'weather'] as const).map(name => {
  const picker = query(`#${name}-picker`, HTMLSelectElement);
  for (const radio of form.querySelectorAll<HTMLInputElement>(`input[name=${name}]`)) {
    picker.add(new Option(radio.labels?.[0]?.textContent.trim() || radio.value, radio.value));
  }
  picker.addEventListener('input', () => {
    const radios = form.elements.namedItem(name);
    if (radios instanceof RadioNodeList) radios.value = picker.value;
  });
  return { name, picker };
});

function show(choices: Choices): void {
  for (const [name, value] of Object.entries(choices)) {
    const field = form.elements.namedItem(name);
    if (field instanceof RadioNodeList) field.value = String(value);
    else if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === true;
    else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = String(value);
  }
}
function read(): Choices {
  const data = new FormData(form),
    weather = form.elements.namedItem('weather'),
    field = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
  return fromHash(
    new URLSearchParams({
      // Disabled sample controls still supply the scene to restore after showing real weather.
      weather: weather instanceof RadioNodeList ? weather.value : field('weather'),
      hour: hourInput.value,
      clouds: field('clouds'),
      layout: field('layout'),
      glass: glassBox.checked ? 'on' : 'off',
      strength: field('strength'),
      screen: field('screen'),
      turned: turnBox.checked ? 'on' : 'off',
      units: field('units'),
      theme: field('theme'),
      language: field('language'),
      alert: alertBox.checked ? 'on' : 'off',
    }).toString(),
  );
}

// --- The card ------------------------------------------------------------------------------
let house: House | undefined;
let sampleScene:
  | { weather: string; hour: number; clouds: CloudAltitude; units: Units; minute: number; world: World }
  | undefined;

// Presentation controls don't change the sample forecast. Keep it until its inputs or clock change.
function sampleFor({ weather, hour, clouds, units }: Choices, now: number): World {
  const minute = Math.floor(now / MINUTE);
  if (
    !sampleScene ||
    sampleScene.weather !== weather ||
    sampleScene.hour !== hour ||
    sampleScene.clouds !== clouds ||
    sampleScene.units !== units ||
    sampleScene.minute !== minute
  )
    sampleScene = {
      weather,
      hour,
      clouds,
      units,
      minute,
      world: sampleWorld({ weather: weatherById(weather), hour, units, clouds }, now),
    };
  return sampleScene.world;
}
// The card, once its file has loaded and defined it.
const shown: { card?: HTMLElementTagNameMap[typeof CARD_TAG] } = {};
let shownSettings = '';
// Whether the controls are the sample's or a real place's; the sample shows until a place answers.
let source: 'sample' | 'real' = 'sample';
// The place whose real weather shows, and its weather once it came, in the units it came in.
let live: { place: Place; units: Units; world: World | null } | undefined;
let request: AbortController | undefined;
function nextRequest() {
  request?.abort();
  request = new AbortController();
  places.hidden = true;
  return request.signal;
}

const clockFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', timeZone: 'UTC' });

function render(): void {
  const choices = read(),
    now = Date.now();
  for (const { name, picker } of compactPickers) picker.value = choices[name];
  stage.dataset['screen'] = choices.screen;
  stage.dataset['layout'] = choices.layout;
  homeGlass.hidden = choices.layout !== 'homeview';
  glassStrength.hidden = !choices.glass;
  const turns = choices.layout === 'page' && choices.screen !== 'desktop';
  turnBox.disabled = !turns;
  stage.dataset['turned'] = String(turns && choices.turned);
  document.documentElement.dataset['theme'] = choices.theme;
  clock.value = live ? 'Now' : clockFormat.format(Date.UTC(2000, 0, 1, choices.hour));
  hourInput.setAttribute('aria-valuetext', clock.value);
  // Only the page layout shows alerts.
  alertBox.disabled = choices.layout !== 'page';
  const which = form.elements.namedItem('source');
  if (which instanceof RadioNodeList) which.value = source;
  real.hidden = source === 'sample';
  real.disabled = real.hidden;
  for (const fieldset of form.querySelectorAll<HTMLFieldSetElement>('fieldset.weather, fieldset.time')) {
    fieldset.disabled = live !== undefined;
    fieldset.hidden = source === 'real';
  }
  // Offered only for a weather whose sky differs by it.
  heights.disabled = live !== undefined;
  heights.hidden = source === 'real' || !hasCloudHeight(weatherById(choices.weather));
  history.replaceState(null, '', toHash(choices) || `${location.pathname}${location.search}`);

  const settings = cardSettings(choices),
    written = yaml(settings);
  alertNote.hidden = !('alert_entities' in settings);
  if (code.textContent !== written) code.textContent = written;
  const { card } = shown;
  if (!card) return;
  if (written !== shownSettings) {
    shownSettings = written;
    card.setConfig(settings);
  }
  card.lang = choices.language;
  const world = live ? live.world : sampleFor(choices, now);
  if (world) {
    house ??= new House(world);
    card.hass = house.hass(withAlert(world, choices.alert, now), choices.language, choices.theme);
  }
}

// --- Real weather -----------------------------------------------------------------------------

async function showPlace(place: Place): Promise<void> {
  const units = read().units,
    signal = nextRequest();
  live = { place, units, world: live?.place === place ? live.world : null };
  source = 'real';
  status.textContent = 'Loading forecast…';
  render();
  try {
    const world = await liveWeather(place, units, url => fetch(url, { signal }), Date.now());
    // Another place, or the sample, was asked for meanwhile.
    if (signal.aborted) return;
    live = { place, units, world };
    status.textContent = `${[place.name, place.detail].filter(Boolean).join(', ')} · Forecast from Open-Meteo`;
  } catch {
    if (signal.aborted) return;
    live = undefined;
    status.textContent = 'Couldn’t load the forecast. Showing sample weather.';
  }
  render();
}

function sample(): void {
  request?.abort();
  live = undefined;
  source = 'sample';
  places.hidden = true;
  status.textContent = '';
  render();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const words = search.value.trim();
  if (!words) {
    status.textContent = 'Enter a town or city to search.';
    search.focus();
    return;
  }
  const signal = nextRequest();
  status.textContent = `Searching for “${words}”…`;
  findPlaces(words, url => fetch(url, { signal }))
    .then(found => {
      if (signal.aborted) return;
      const [first] = found;
      if (!first) {
        status.textContent = `No matches for “${words}”. Try a nearby town or a different spelling.`;
        return;
      }
      if (found.length === 1) {
        void showPlace(first);
        return;
      }
      status.textContent = 'Choose a location to see its forecast.';
      places.replaceChildren(
        ...found.map(place => {
          const item = document.createElement('li'),
            button = document.createElement('button');
          button.type = 'button';
          button.textContent = [place.name, place.detail].filter(Boolean).join(', ');
          button.addEventListener('click', () => void showPlace(place));
          item.append(button);
          return item;
        }),
      );
      places.hidden = false;
    })
    .catch(() => {
      if (!signal.aborted) status.textContent = 'Location search is unavailable. Try again in a moment.';
    });
});

here.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    status.textContent = 'This browser can’t provide your location. Search for a town or city.';
    return;
  }
  const signal = nextRequest();
  status.textContent = 'Getting your location…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (!signal.aborted)
        void showPlace({ name: 'Your location', detail: '', latitude: coords.latitude, longitude: coords.longitude });
    },
    () => {
      if (!signal.aborted) status.textContent = 'Couldn’t get your location. Search for a town or city.';
    },
    { maximumAge: LOCATION_AGE, timeout: LOCATION_WAIT },
  );
});

form.addEventListener('input', event => {
  const { target } = event;
  if (target === search || !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.name === 'source') {
    if (target.value === 'sample') sample();
    else {
      source = 'real';
      status.textContent = 'Showing sample weather until you choose a location.';
      render();
    }
    return;
  }
  // Real weather in other units is asked for again, as an integration would send it.
  if (live && target.name === 'units' && read().units !== live.units) void showPlace(live.place);
  else render();
});

getYaml.addEventListener('click', () => {
  copyFeedback.textContent = '';
  settingsDialog.showModal();
});
settingsDialog.addEventListener('close', () => getYaml.focus({ preventScroll: true }));

async function copyDashboardYaml() {
  const message = await copyYaml(code);
  copyFeedback.textContent = '';
  requestAnimationFrame(() => {
    if (settingsDialog.open) copyFeedback.textContent = message;
  });
}
if ('CommandEvent' in window && 'commandForElement' in HTMLButtonElement.prototype)
  code.addEventListener('command', event => {
    if (event instanceof CommandEvent && event.command === '--copy') void copyDashboardYaml();
  });
else copy.addEventListener('click', () => void copyDashboardYaml());

addEventListener('hashchange', () => {
  show(fromHash(location.hash));
  render();
});

show(fromHash(location.hash));
render();

// The card, loaded as a dashboard loads it, then made once and kept: a change of setting or of
// weather reaches it as it would on a dashboard.
await customElements.whenDefined(CARD_TAG);
shown.card = document.createElement(CARD_TAG);
frame.replaceChildren(shown.card);
render();
