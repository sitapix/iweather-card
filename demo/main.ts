import { languageOf } from '../src/weather/language.ts';
import type { WeatherLayout } from '../src/card/config.ts';
import { House } from './house.ts';
import { type Place, findPlaces, liveWeather } from './live.ts';
import {
  DEFAULT_WEATHER,
  LANGUAGES,
  type Theme,
  type Units,
  WEATHERS,
  type World,
  cardSettings,
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
const LAYOUTS: readonly WeatherLayout[] = ['page', 'expanded', 'auto', 'compact', 'strip'];
const SCREENS: readonly Screen[] = ['phone', 'tablet', 'desktop'];
const UNIT_CHOICES: readonly Units[] = ['us', 'metric'];
const THEMES: readonly Theme[] = ['light', 'dark'];
const HOURS = 24;
const MINUTE = 60_000;
const OPENING_HOUR = 13;
// The countries that measure in °F and miles.
const FAHRENHEIT_REGIONS = /-(us|lr|mm)$/i;
// How long a position may be, and how long to wait for one.
const LOCATION_AGE = 10 * 60 * 1000;
const LOCATION_WAIT = 15 * 1000;
// How long the copy button says it copied.
const COPIED_FOR = 3000;

interface Choices {
  weather: string;
  hour: number;
  layout: WeatherLayout;
  screen: Screen;
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
    layout: 'page',
    screen: matchMedia('(max-width: 700px)').matches ? 'phone' : 'desktop',
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
    hour = Number(params.get('hour') ?? OPENING.hour);
  return {
    weather: weatherById(params.get('weather') ?? OPENING.weather).id,
    hour: Number.isInteger(hour) && hour >= 0 && hour < HOURS ? hour : OPENING.hour,
    layout: oneOf(LAYOUTS, params.get('layout'), OPENING.layout),
    screen: oneOf(SCREENS, params.get('screen'), OPENING.screen),
    units: oneOf(UNIT_CHOICES, params.get('units'), OPENING.units),
    theme: oneOf(THEMES, params.get('theme'), OPENING.theme),
    language: oneOf(
      LANGUAGES.map(([code]) => code),
      params.get('language'),
      OPENING.language,
    ),
    alert: params.get('alert') === 'on',
  };
}
const KEYS = [
  'weather',
  'hour',
  'layout',
  'screen',
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
  back = query('button.back', HTMLButtonElement),
  here = query('button.here', HTMLButtonElement),
  search = query('input[name=place]', HTMLInputElement),
  alertBox = query('input[name=alert]', HTMLInputElement),
  copy = query('button.copy', HTMLButtonElement),
  copyFeedback = query('.copy-feedback', HTMLElement);

// The controls, from the sample's weathers and the card's languages.
query('[data-name=weather]', HTMLDivElement).innerHTML = WEATHERS.map(
  weather => `<label><input type="radio" name="weather" value="${weather.id}"><span>${weather.label}</span></label>`,
).join('');
query('select[name=language]', HTMLSelectElement).innerHTML = LANGUAGES.map(
  ([language, name]) => `<option value="${language}" lang="${language}">${name}</option>`,
).join('');

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
      layout: field('layout'),
      screen: field('screen'),
      units: field('units'),
      theme: field('theme'),
      language: field('language'),
      alert: alertBox.checked ? 'on' : 'off',
    }).toString(),
  );
}

// --- The card ------------------------------------------------------------------------------
let house: House | undefined;
let sampleScene: { weather: string; hour: number; units: Units; minute: number; world: World } | undefined;

// Presentation controls don't change the sample forecast. Keep it until its inputs or clock change.
function sampleFor({ weather, hour, units }: Choices, now: number): World {
  const minute = Math.floor(now / MINUTE);
  if (
    !sampleScene ||
    sampleScene.weather !== weather ||
    sampleScene.hour !== hour ||
    sampleScene.units !== units ||
    sampleScene.minute !== minute
  )
    sampleScene = {
      weather,
      hour,
      units,
      minute,
      world: sampleWorld({ weather: weatherById(weather), hour, units }, now),
    };
  return sampleScene.world;
}
// The card, once its file has loaded and defined it.
const shown: { card?: HTMLElementTagNameMap[typeof CARD_TAG] } = {};
let shownSettings = '';
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
  stage.dataset['screen'] = choices.screen;
  stage.dataset['layout'] = choices.layout;
  document.documentElement.dataset['theme'] = choices.theme;
  clock.value = live ? 'Now' : clockFormat.format(Date.UTC(2000, 0, 1, choices.hour));
  hourInput.setAttribute('aria-valuetext', clock.value);
  alertBox.disabled = choices.layout !== 'page';
  form.dataset['live'] = String(live !== undefined);
  for (const fieldset of form.querySelectorAll<HTMLFieldSetElement>('fieldset.weather, fieldset.time'))
    fieldset.disabled = live !== undefined;
  history.replaceState(null, '', toHash(choices) || `${location.pathname}${location.search}`);

  const settings = cardSettings(choices),
    written = yaml(settings);
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
  back.hidden = false;
  status.textContent = `Asking for the weather at ${place.name}…`;
  render();
  try {
    const world = await liveWeather(place, units, url => fetch(url, { signal }), Date.now());
    // Another place, or the sample, was asked for meanwhile.
    if (signal.aborted) return;
    live = { place, units, world };
    status.textContent = `The weather at ${[place.name, place.detail].filter(Boolean).join(', ')} now, from Open-Meteo.`;
  } catch {
    if (signal.aborted) return;
    live = undefined;
    back.hidden = true;
    status.textContent = `Open-Meteo sent nothing for ${place.name}, so the sample weather is back.`;
  }
  render();
}

function sample(): void {
  request?.abort();
  live = undefined;
  back.hidden = true;
  places.hidden = true;
  status.textContent = '';
  render();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const words = search.value.trim();
  if (!words) return;
  const signal = nextRequest();
  status.textContent = `Looking for ${words}…`;
  findPlaces(words, url => fetch(url, { signal }))
    .then(found => {
      if (signal.aborted) return;
      const [first] = found;
      if (!first) {
        status.textContent = `Open-Meteo knows no place called ${words}.`;
        return;
      }
      if (found.length === 1) {
        void showPlace(first);
        return;
      }
      status.textContent = 'Which one?';
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
      if (!signal.aborted) status.textContent = 'Open-Meteo didn’t answer. Try again in a moment.';
    });
});

here.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    status.textContent = 'This browser can’t tell where you are.';
    return;
  }
  const signal = nextRequest();
  status.textContent = 'Asking where you are…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (!signal.aborted)
        void showPlace({ name: 'Your location', detail: '', latitude: coords.latitude, longitude: coords.longitude });
    },
    () => {
      if (!signal.aborted) status.textContent = 'Location unavailable. Look up a town or city instead.';
    },
    { maximumAge: LOCATION_AGE, timeout: LOCATION_WAIT },
  );
});
back.addEventListener('click', sample);

form.addEventListener('input', event => {
  if (event.target === search) return;
  // Real weather in other units is asked for again, as an integration would send it.
  if (live && event.target instanceof HTMLInputElement && event.target.name === 'units' && read().units !== live.units)
    void showPlace(live.place);
  else render();
});

let feedbackTimer: number | undefined;
async function copyYaml() {
  let message: string;
  try {
    await navigator.clipboard.writeText(code.textContent);
    message = 'Copied';
  } catch {
    message = 'Select the YAML and copy it manually.';
  }
  clearTimeout(feedbackTimer);
  copyFeedback.textContent = '';
  requestAnimationFrame(() => {
    copyFeedback.textContent = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      copyFeedback.textContent = '';
    }, COPIED_FOR);
  });
}
if ('CommandEvent' in window && 'commandForElement' in HTMLButtonElement.prototype)
  code.addEventListener('command', event => {
    if (event instanceof CommandEvent && event.command === '--copy') void copyYaml();
  });
else copy.addEventListener('click', () => void copyYaml());

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
