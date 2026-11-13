import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { isRecord } from '../src/lib/values.ts';
import { phrase, say, sayCount, useWords } from '../src/weather/words.ts';

afterEach(() => {
  useWords('en', {});
});

test('with no language a sentence reads as it is written', () => {
  assert.equal(say('Rain until {time}.', { time: '4PM' }), 'Rain until 4PM.');
  assert.equal(say('Plain.'), 'Plain.');
  assert.equal(phrase('Kept for later'), 'Kept for later');
});

test('a language says the sentence its own way round', () => {
  useWords('ja', { 'Rain until {time}.': '{time}まで雨。' });
  assert.equal(say('Rain until {time}.', { time: '16時' }), '16時まで雨。');
  assert.equal(say('Not translated.'), 'Not translated.', 'English stands in for what a language lacks');
});

test('a placeholder with no value stays, so a fault shows', () => {
  assert.equal(say('Rain until {time}.', {}), 'Rain until {time}.');
});

test('a count takes the form its language wants', () => {
  assert.equal(sayCount('{count} day', '{count} days', 1), '1 day');
  assert.equal(sayCount('{count} day', '{count} days', 2), '2 days');
  useWords('pl', {
    '{count} days': { one: '{count} dzień', few: '{count} dni', many: '{count} dni', other: '{count} dnia' },
  });
  assert.equal(sayCount('{count} day', '{count} days', 1), '1 dzień');
  assert.equal(sayCount('{count} day', '{count} days', 5), '5 dni');
  useWords('ko', { '{count} days': '{count}일' });
  assert.equal(sayCount('{count} day', '{count} days', 1), '1일', 'a language with one form has one form');
});

test('a sentence that opens on a value opens with a capital', () => {
  useWords('fr', { 'On {weekday}, it rains.': '{weekday}, il pleut.' });
  assert.equal(say('On {weekday}, it rains.', { weekday: 'lundi' }), 'Lundi, il pleut.');
  assert.equal(say('Rain until {time}.', { time: 'midi' }), 'Rain until midi.', 'a value further in is left as it is');
});

test('a setting the card cannot honour is explained in the page’s language, the setting kept as written', () => {
  const german: unknown = JSON.parse(readFileSync('src/weather/word-files/de.json', 'utf8'));
  if (!isRecord(german)) throw new Error('No German words.');
  useWords(
    'de',
    Object.fromEntries(
      Object.entries(german).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  );
  assert.throws(
    () => normalizeConfig({ entity: 'weather.home', forecast_days: 99 }),
    /^Error: Die Einstellung forecast_days muss eine ganze Zahl von \d+ bis \d+ sein\.$/u,
  );
});
