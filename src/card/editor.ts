import { ENTITIES_CARD, EVENTS, HA_FORM, fireEvent, type HaFormElement, type HomeAssistant } from './home-assistant.ts';
import { EDITOR_TAG, type WeatherLayout } from './config.ts';
import {
  TYPED,
  configFrom,
  contextOf,
  filled,
  formData,
  inWords,
  partsChanged,
  partsOf,
  schemaFor,
} from './editor-schema.ts';
import { type EditedPart, editParts, stopEditing } from './editing.ts';
import { type EditorText, editorWords, english } from './editor-words.ts';
import { EditorSetup } from './editor-setup.ts';
import { setupSource, type SetupPreset } from './setup.ts';
import { missingReadings } from '../weather/sources.ts';
import { isRecord } from '../lib/values.ts';

// A card class that can build its own editor, as Home Assistant's built-in cards do.
const editable = (card: unknown): card is { getConfigElement: () => unknown } =>
  typeof card === 'function' && 'getConfigElement' in card && typeof card.getConfigElement === 'function';

// HA only defines ha-form once one of its own card editors has loaded.
async function loadForm(): Promise<void> {
  if (customElements.get(HA_FORM)) return;
  const helpers = await window.loadCardHelpers();
  helpers.createCardElement({ type: 'entities', entities: [] });
  await customElements.whenDefined(ENTITIES_CARD);
  const card = customElements.get(ENTITIES_CARD);
  if (editable(card)) await card.getConfigElement();
  await customElements.whenDefined(HA_FORM);
}

// Home Assistant hands the editor its state many times a second; the form only needs it for
// its entity pickers, so it gets it at most this often (and at once for a new language).
const HASS_EVERY = 2000;
// Typing into a text field reaches the card's preview, which rebuilds the card, once the
// typing pauses for this long, or as soon as the field loses focus.
const TYPING_PAUSE = 400;
// Narrower than this (px), as on a phone, the editor puts fewer choices side by side.
const NARROW_EDITOR = 450;

// The parts of the card the field or section an event came from changes, by the form's own
// record of each on the event's way out: a field's, or else its section's.
function partsFrom(event: Event, layout: WeatherLayout): EditedPart[] {
  for (const target of event.composedPath()) {
    const schema = target instanceof Element && 'schema' in target ? target.schema : undefined,
      parts = isRecord(schema) && !Array.isArray(schema) ? partsOf(schema, layout) : [];
    if (parts.length) return parts;
  }
  return [];
}

export class IWeatherCardEditor extends HTMLElement {
  private readonly root: ShadowRoot;
  private readHass: HomeAssistant | undefined;
  private _config: Record<string, unknown> | undefined;
  // The form's values, which can hold what the settings can't yet (an averages sensor still
  // to be chosen), and the settings last sent, which Home Assistant hands straight back.
  private _data: Record<string, unknown> = {};
  private _sent: string | undefined;
  private _form: HaFormElement | undefined;
  private _schemaKey: string | null = null;
  private _say: EditorText = english;
  private _language: string | undefined;
  private _hassAt = 0;
  private _hassTimer: number | undefined;
  private _sendTimer: number | undefined;
  private _narrow = false;
  private _resize: ResizeObserver | undefined;
  // A box of its own, as it measures its width; inline, it would measure none.
  private readonly _style = Object.assign(document.createElement('style'), { textContent: ':host{display:block}' });
  private readonly _setup = new EditorSetup(
    preset => this._applyPreset(preset),
    () => this._undoPreset(),
  );
  // The settings before the last starting point was applied, for one Undo.
  private _previous: { data: Record<string, unknown>; config: Record<string, unknown> } | undefined;
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    // Leaving a text field sends what was typed straight away.
    this.root.addEventListener('focusout', () => this._send());
    // The preview shows the part of the card a field changes as it is focused, and a section's
    // as it is opened (see editing.ts).
    this.root.addEventListener('focusin', event => editParts(this, partsFrom(event, this.layout), true));
    this.root.addEventListener('expanded-changed', event => {
      const detail: unknown = 'detail' in event ? event.detail : undefined;
      if (isRecord(detail) && detail['expanded'] === true) editParts(this, partsFrom(event, this.layout), true);
    });
  }
  private get layout(): WeatherLayout {
    return contextOf(this._data, undefined).layout;
  }
  connectedCallback() {
    this._resize = new ResizeObserver(([entry]) => {
      const narrow = (entry?.contentRect.width ?? NARROW_EDITOR) < NARROW_EDITOR;
      if (narrow === this._narrow) return;
      this._narrow = narrow;
      this._schema();
    });
    this._resize.observe(this);
    loadForm()
      .then(() => this._render())
      .catch(() => {
        this.root.textContent = this._say('The visual editor could not load. Use the code editor.');
      });
  }
  disconnectedCallback() {
    this._send();
    stopEditing(this);
    this._resize?.disconnect();
    window.clearTimeout(this._hassTimer);
    this._hassTimer = undefined;
  }
  set hass(value: HomeAssistant) {
    const language =
      (value.locale?.language ?? value.language) !== (this.readHass?.locale?.language ?? this.readHass?.language);
    this.readHass = value;
    if (!this._form) return;
    const wait = HASS_EVERY - (Date.now() - this._hassAt);
    if (language || wait <= 0) this._passHass();
    else this._hassTimer ??= window.setTimeout(() => this._passHass(), wait);
  }
  _passHass() {
    window.clearTimeout(this._hassTimer);
    this._hassTimer = undefined;
    this._hassAt = Date.now();
    if (!this._form) return;
    this._form.hass = this.readHass;
    this._schema();
  }
  // The form's shape follows the layout, the averages' source, the map and what the weather
  // entity lacks; it is rebuilt only when one of those changes.
  _schema() {
    if (!this._form || !this._config) return;
    const language = this.readHass?.locale?.language ?? this.readHass?.language;
    if (language !== this._language) {
      this._language = language;
      void editorWords(language).then(say => {
        if (language !== this._language) return;
        this._say = say;
        this._schemaKey = null;
        this._schema();
      });
    }
    this._setup.update(this._say, setupSource(this._config, this.readHass), this._previous !== undefined);
    const entity = this._config['entity'],
      attributes = typeof entity === 'string' ? this.readHass?.states[entity]?.attributes : undefined,
      context = contextOf(this._data, attributes, this._narrow),
      key = JSON.stringify([
        context.layout,
        context.averages,
        context.map,
        context.narrow,
        attributes ? missingReadings(attributes) : null,
      ]);
    if (this._schemaKey === key) return;
    this._schemaKey = key;
    this._form.schema = inWords(schemaFor(context, this._say), this._say);
  }
  setConfig(config: Record<string, unknown>) {
    this._config = { ...config };
    // The settings this editor just sent come back unchanged; the form already shows them.
    if (this._form && JSON.stringify(config) === this._sent) return;
    this._previous = undefined;
    this._setup.announce('');
    this._data = formData(this._config);
    if (!this._form) {
      this._render();
      return;
    }
    this._schema();
    this._form.data = this._data;
  }
  _render() {
    if (!this._config || !customElements.get(HA_FORM)) return;
    if (!this._form) {
      const form = document.createElement(HA_FORM);
      this._form = form;
      this._schemaKey = null;
      form.computeLabel = item => item.label ?? item.name;
      form.computeHelper = item => item.helper;
      form.addEventListener(EVENTS.valueChanged, event => {
        event.stopPropagation();
        // Home Assistant fires a plain Event with `detail` set on it, not a CustomEvent.
        const detail: unknown = 'detail' in event ? event.detail : undefined,
          value = isRecord(detail) ? detail['value'] : undefined;
        if (!isRecord(value)) return;
        const before = this._config ?? {},
          // Layout changes may remove controls from the form. Keep their values, and unknown
          // YAML options, when a form reports only its visible fields. Explicit clears still win.
          data = { ...this._data, ...value },
          config = configFrom(data);
        this._previous = undefined;
        this._setup.announce('');
        // A cleared dropdown shows its default again.
        this._data = filled(data);
        this._config = config;
        form.data = this._data;
        this._schema();
        // Typing waits for a pause; any other change goes to the preview at once.
        const changed = [...new Set([...Object.keys(before), ...Object.keys(config)])].filter(
          key => JSON.stringify(before[key]) !== JSON.stringify(config[key]),
        );
        editParts(this, partsChanged(changed, this.layout));
        window.clearTimeout(this._sendTimer);
        if (changed.length && changed.every(key => TYPED.has(key)))
          this._sendTimer = window.setTimeout(() => this._send(), TYPING_PAUSE);
        else this._send(true);
      });
      this.root.replaceChildren(this._style, this._setup.element, form);
    }
    this._passHass();
    this._form.data = this._data;
  }
  // A starting point sets ordinary options, keeping what was there for one Undo.
  private _applyPreset(preset: SetupPreset) {
    if (!this._config || !this._form) return;
    this._previous = { data: { ...this._data }, config: { ...this._config } };
    this._data = { ...this._data, ...preset.config };
    this._config = configFrom(this._data);
    this._form.data = this._data;
    this._schema();
    stopEditing(this);
    this._setup.announce('Starting point applied.');
    this._send(true);
  }
  private _undoPreset() {
    if (!this._previous || !this._form) return;
    this._data = this._previous.data;
    this._config = this._previous.config;
    this._previous = undefined;
    this._form.data = this._data;
    this._schema();
    stopEditing(this);
    this._setup.announce('Previous settings restored.');
    this._send(true);
  }
  // The card's settings to Home Assistant, which updates the preview and the YAML. `now`:
  // whatever is waiting or not.
  _send(now = false) {
    if (this._sendTimer === undefined && !now) return;
    window.clearTimeout(this._sendTimer);
    this._sendTimer = undefined;
    if (!this._config) return;
    this._sent = JSON.stringify(this._config);
    fireEvent(this, EVENTS.configChanged, { config: this._config });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [EDITOR_TAG]: IWeatherCardEditor;
  }
}
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, IWeatherCardEditor);
