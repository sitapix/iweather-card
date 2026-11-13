import { setText } from '../lib/dom.ts';
import { type EditorText, english } from './editor-words.ts';
import { SETUP_PRESETS, type SetupPreset, type SetupSource } from './setup.ts';

const STYLE = `
.quick-setup { container: quick-setup / inline-size; margin: 0 0 20px; border: 1px solid var(--divider-color, #dce1e6); border-radius: 12px; color: var(--primary-text-color, #212121); }
.quick-setup summary { padding: 14px 16px; cursor: pointer; font-weight: 600; }
.quick-body { padding: 0 16px 16px; }
.quick-body p { margin: 0 0 14px; color: var(--secondary-text-color, #60676f); font-size: 14px; line-height: 1.5; }
.quick-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.quick-option { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: start; font: inherit; padding: 12px; min-height: 100px; border: 1px solid var(--divider-color, #dce1e6); border-radius: 10px; color: inherit; background: var(--card-background-color, #fff); cursor: pointer; overflow-wrap: anywhere; }
.quick-option:hover { border-color: var(--primary-color, #03a9f4); }
.quick-option ha-icon { color: var(--primary-color, #03a9f4); --mdc-icon-size: 22px; }
.quick-option small { color: var(--secondary-text-color, #60676f); font-size: 12px; line-height: 1.5; }
.quick-setup :focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 3px; }
.quick-result { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; font-size: 13px; }
.quick-result button { font: inherit; font-weight: 600; background: none; border: 1px solid var(--divider-color, #dce1e6); border-radius: 8px; color: var(--primary-text-color, #212121); padding: 10px 14px; min-height: 44px; cursor: pointer; }
.setup-source { margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: var(--secondary-text-color, #60676f); overflow-wrap: anywhere; }
.setup-source:empty { display: none; }
@container quick-setup (max-width: 360px) { .quick-options { grid-template-columns: 1fr; } }
`;

// Stable elements keep keyboard focus and the details' open state through HA state updates,
// localization and config echoes. Only plain text is assigned from translations.
export class EditorSetup {
  readonly element = document.createElement('div');
  private readonly summary = document.createElement('summary');
  private readonly introduction = document.createElement('p');
  private readonly undo = document.createElement('button');
  private readonly result = document.createElement('span');
  private readonly source = document.createElement('div');
  private readonly options: { title: HTMLElement; description: HTMLElement; preset: SetupPreset }[] = [];
  private message = '';
  private say: EditorText = english;

  constructor(apply: (preset: SetupPreset) => void, undo: () => void) {
    const style = document.createElement('style'),
      details = document.createElement('details'),
      body = document.createElement('div'),
      choices = document.createElement('div'),
      result = document.createElement('div');
    style.textContent = STYLE;
    details.className = 'quick-setup';
    body.className = 'quick-body';
    choices.className = 'quick-options';
    for (const preset of SETUP_PRESETS) {
      const button = document.createElement('button'),
        icon = document.createElement('ha-icon'),
        title = document.createElement('strong'),
        description = document.createElement('small');
      button.type = 'button';
      button.className = 'quick-option';
      button.dataset['preset'] = preset.id;
      icon.setAttribute('icon', preset.icon);
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon, title, description);
      button.addEventListener('click', () => apply(preset));
      choices.append(button);
      this.options.push({ title, description, preset });
    }
    this.undo.type = 'button';
    this.undo.hidden = true;
    this.undo.addEventListener('click', () => {
      // Undo disappears after use, so put focus somewhere useful first.
      this.summary.focus();
      undo();
    });
    this.result.setAttribute('role', 'status');
    result.className = 'quick-result';
    result.append(this.result, this.undo);
    body.append(this.introduction, choices, result);
    details.append(this.summary, body);
    this.source.className = 'setup-source';
    this.source.setAttribute('role', 'status');
    this.element.append(style, details, this.source);
  }

  update(say: EditorText, source: SetupSource, canUndo: boolean) {
    this.say = say;
    setText(this.summary, say('Quick setup'));
    setText(
      this.introduction,
      say('Choose a starting point. Your sources, units, privacy and actions stay as they are.'),
    );
    for (const { title, description, preset } of this.options) {
      setText(title, say(preset.label));
      setText(description, say(preset.description));
    }
    setText(this.undo, say('Undo'));
    this.undo.toggleAttribute('hidden', !canUndo);
    const text = source.message
      ? say(source.message)
      : source.forecasts.length
        ? `${say('Supported forecasts')}: ${source.forecasts.map(say).join(' · ')}`
        : '';
    setText(this.source, text);
    const result = this.message ? say(this.message) : '';
    setText(this.result, result);
  }

  announce(message: string) {
    this.message = message;
    this.result.textContent = message ? this.say(message) : '';
  }
}
