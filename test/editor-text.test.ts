import assert from 'node:assert/strict';
import { test } from 'vitest';
import { schemaFor } from '../src/card/editor-schema.ts';
import { SETUP_PRESETS } from '../src/card/setup.ts';
import type { FormSchemaItem } from '../src/card/home-assistant.ts';
import { textTable } from '../src/weather/i18n.ts';
import { isRecord } from '../src/lib/values.ts';

// Every word of the form, in every language the card speaks.
const LANGUAGES = Object.fromEntries(
  Object.entries(import.meta.glob('../src/card/editor-text/*.json', { import: 'default', eager: true })).map(
    ([path, words]) => [path, isRecord(words) ? words : {}],
  ),
);
const SETUP_WORDS = [
  'Quick setup',
  'Choose a starting point. Your sources, units, privacy and actions stay as they are.',
  'Undo',
  'Starting point applied.',
  'Previous settings restored.',
  'Choose a weather entity below.',
  'Add a weather integration in Settings → Devices & services, then choose its weather entity here.',
  'Home Assistant can’t find this weather entity. Choose another below.',
  'This weather entity is unavailable. Check its integration or choose another entity.',
  'This source reports current weather only. You can add a forecast entity in Data sources.',
  'Supported forecasts',
  'Day and night',
  ...SETUP_PRESETS.flatMap(preset => [preset.label, preset.description]),
];

const OTHER_WORDS = ['Data sources · {count} missing', 'The visual editor could not load. Use the code editor.'];
function wordsOf(items: readonly FormSchemaItem[], words = new Set<string>()): Set<string> {
  for (const { label, helper, title, selector, schema } of items) {
    for (const word of [label, helper, title]) if (word) words.add(word);
    if (selector && 'select' in selector) for (const option of selector.select.options) words.add(option.label);
    if (schema) wordsOf(schema, words);
  }
  return words;
}
const everyWord = () => {
  const words = new Set([...OTHER_WORDS, ...SETUP_WORDS]);
  for (const layout of ['auto', 'compact', 'strip', 'expanded', 'page'] as const)
    for (const averages of ['none', 'sensor', 'open-meteo'] as const)
      for (const map of ['none', 'rainviewer', 'local'] as const)
        wordsOf(schemaFor({ layout, averages, map, attributes: { temperature: 1 } }), words);
  // With nothing missing, the section is named without its count.
  wordsOf(schemaFor({ layout: 'page', attributes: undefined }), words);
  return [...words].filter(word => !word.includes(' missing') || word.includes('{count}'));
};

test('the editor has a file for every language the card speaks', () => {
  const files = Object.keys(LANGUAGES).map(path => path.replace(/^.*\/|\.json$/gu, ''));
  assert.deepEqual(
    files.toSorted(),
    Object.keys(textTable)
      .filter(code => code !== 'en')
      .toSorted(),
  );
});

test('every language has every word of the form, and no others', () => {
  const words = everyWord().toSorted();
  for (const [path, language] of Object.entries(LANGUAGES))
    assert.deepEqual(Object.keys(language).toSorted(), words, path);
});

test('nothing a value depends on is lost in translation', () => {
  // Placeholders, and a unit's symbol: what stands for something rather than says it.
  const kept = /\{[a-z]+\}|\([^ ()]{1,5}\)$/gu;
  for (const [path, language] of Object.entries(LANGUAGES))
    for (const [english, translated] of Object.entries(language)) {
      assert.ok(typeof translated === 'string' && translated.trim(), `${path}: ${english}`);
      for (const [mark] of english.matchAll(kept))
        assert.ok(translated.includes(mark), `${path}: ${english} loses ${mark}`);
    }
});
