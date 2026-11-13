import assert from 'node:assert/strict';
import { test } from 'vitest';
import { wordKeys } from '../scripts/word-keys.ts';
import { textTable } from '../src/weather/i18n.ts';
import { isRecord } from '../src/lib/values.ts';

// Every sentence the card says, in every language it speaks.
const LANGUAGES = Object.fromEntries(
  Object.entries(import.meta.glob('../src/weather/word-files/*.json', { import: 'default', eager: true })).map(
    ([path, words]) => [path, isRecord(words) ? words : {}],
  ),
);
const { keys, counted, faults } = wordKeys();
const codeOf = (path: string) => path.replace(/^.*\/|\.json$/gu, '');
const marks = (text: string) => (text.match(/\{[a-z]+\}|<[^>]+>/gu) ?? []).toSorted();

test('every sentence can be read from the sources', () => {
  assert.deepEqual(faults, []);
  assert.ok(keys.length > 500);
});

test('the card has a file for every language it speaks', () => {
  assert.deepEqual(
    Object.keys(LANGUAGES).map(codeOf).toSorted(),
    Object.keys(textTable)
      .filter(code => code !== 'en')
      .toSorted(),
  );
});

test('every language says every sentence, and no others', () => {
  for (const [path, language] of Object.entries(LANGUAGES))
    assert.deepEqual(Object.keys(language).toSorted(), keys.toSorted(), path);
});

test('a translation keeps its placeholders and its markup', () => {
  for (const [path, language] of Object.entries(LANGUAGES))
    for (const [english, value] of Object.entries(language)) {
      const forms =
        typeof value === 'string' ? [value] : Object.values(value ?? {}).filter(form => typeof form === 'string');
      assert.ok(forms.length && forms.every(form => form.trim()), `${path}: ${english}`);
      for (const form of forms) assert.deepEqual(marks(form), marks(english), `${path}: ${english}`);
    }
});

test('a sentence that counts has every form its language needs', () => {
  for (const [path, language] of Object.entries(LANGUAGES)) {
    const needed = new Intl.PluralRules(codeOf(path)).resolvedOptions().pluralCategories;
    for (const key of counted) {
      const value = language[key];
      if (needed.length === 1) assert.equal(typeof value, 'string', `${path}: ${key}`);
      else
        for (const form of needed)
          assert.ok(typeof value === 'object' && value !== null && form in value, `${path}: ${key} ${form}`);
    }
  }
});

// Names of units and places, written as English writes them in most languages.
const NAMES = new Set([
  'Beaufort',
  'Celsius',
  'Fahrenheit',
  'Kelvin',
  'Austria',
  'Canada',
  'China',
  'France',
  'India',
  'Mexico',
  'Singapore',
]);
// Words a language writes as English does.
const SHARED: Readonly<Record<string, readonly string[]>> = {
  cs: ['Menu', 'UV index'],
  da: ['Menu', 'Pause', 'Storm', 'Layout', 'Animation', 'Hold', 'Standard'],
  de: ['Details', 'Pause', 'Wind', 'Layout', 'Name', 'Animation', 'Standard'],
  fr: [
    'Acceptable',
    'Conditions',
    'Description',
    'Direction',
    'Distance',
    'Hectopascals (hPa)',
    'Illumination',
    'Kilopascals (kPa)',
    'Miles (mi)',
    'Millibars (mbar)',
    'Menu',
    'Options',
    'Ozone',
    'ozone',
    'Pause',
    'Animation',
    'Interactions',
    'Standard',
  ],
  it: ['Layout', 'Menu', 'Standard'],
  nb: ['Pause', 'Layout', 'Hold', 'Standard'],
  nl: ['Compact', 'Details', 'Menu', 'Wind'],
  pl: ['Menu'],
  pt: ['Menu', 'Layout'],
  sv: ['Storm', 'Layout', 'Animation', 'Standard'],
};
const EDITOR_LANGUAGES = Object.fromEntries(
  Object.entries(import.meta.glob('../src/card/editor-text/*.json', { import: 'default', eager: true })).map(
    ([path, words]) => [path, isRecord(words) ? words : {}],
  ),
);
// The words of a sentence, outside its placeholders, markup and brackets: none, and it is codes,
// symbols or marks, which every language writes alike.
const wordsOf = (text: string) =>
  text.replace(/\{\w+\}|<[^>]+>|\([^)]*\)/gu, ' ').match(/\p{L}*\p{Ll}{3,}\p{L}*/gu) ?? [];

test('a translation written as its English is a word that language shares with English, not one left untranslated', () => {
  for (const [path, language] of Object.entries({ ...LANGUAGES, ...EDITOR_LANGUAGES })) {
    const shared = new Set(SHARED[codeOf(path)] ?? []);
    for (const [english, value] of Object.entries(language)) {
      const forms = typeof value === 'string' ? [value] : Object.values(value ?? {});
      if (!forms.includes(english)) continue;
      const words = wordsOf(english);
      assert.ok(
        words.every(word => NAMES.has(word)) || shared.has(english),
        `${path}: "${english}" is left as English; translate it, or add it to SHARED if the language writes it so`,
      );
    }
  }
});
