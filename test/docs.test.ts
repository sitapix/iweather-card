import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { parse } from 'yaml';
import { CARD_TYPE, CONFIG_DEFAULTS, normalizeConfig } from '../src/card/config.ts';
import { isList, isRecord } from '../src/lib/values.ts';

// What the docs say against what the card does: every example a working card, every setting it uses
// documented, and every default as documented.
const PAGES = ['README.md', 'docs/configuration.md', 'docs/examples.md'],
  REFERENCE = readFileSync('docs/configuration.md', 'utf8');

// Every YAML example on a page.
const examples = (page: string) =>
  [...readFileSync(page, 'utf8').matchAll(/^```yaml\n([\s\S]*?)^```/gmu)].map(([, yaml]) => yaml ?? '');

// The card's settings in an example: each card in it, or the example itself where it shows only a
// few settings of one.
function cardsIn(value: unknown): Record<string, unknown>[] {
  if (isList(value)) return value.flatMap(cardsIn);
  if (!isRecord(value)) return [];
  if (value['type'] === CARD_TYPE) return [value];
  const nested = Object.values(value).flatMap(cardsIn);
  return nested.length || 'type' in value || 'views' in value ? nested : [{ entity: 'weather.home', ...value }];
}

// The settings the reference documents, by the first column of its tables (one setting or several),
// with their defaults.
const documented = new Map(
  [...REFERENCE.matchAll(/^\| ((?:`[a-z_]+`(?:, )?)+) \| ([^|]+) \|/gmu)].flatMap(([, names, fallback]) =>
    [...(names ?? '').matchAll(/`([a-z_]+)`/gu)].map(([, name]) => [name ?? '', fallback?.trim()] as const),
  ),
);

test('every example is a card the card takes as it is written', () => {
  let cards = 0;
  for (const page of PAGES)
    for (const yaml of examples(page))
      for (const card of cardsIn(parse(yaml))) {
        cards += 1;
        assert.doesNotThrow(() => normalizeConfig(card), `${page}: ${JSON.stringify(card)}`);
      }
  assert.ok(cards > PAGES.length);
});

test('every setting an example uses is documented', () => {
  for (const page of PAGES)
    for (const yaml of examples(page))
      for (const card of cardsIn(parse(yaml)))
        for (const name of Object.keys(card))
          assert.ok(name === 'type' || documented.has(name), `${page}: ${name} is not in docs/configuration.md`);
});

test('every setting with a default is documented, with that default', () => {
  // Read none, and the tables have changed shape rather than all being well.
  assert.ok(documented.size > Object.keys(CONFIG_DEFAULTS).length);
  for (const [name, fallback] of Object.entries(CONFIG_DEFAULTS)) {
    const written = documented.get(name);
    assert.ok(written !== undefined, `${name} is not in docs/configuration.md`);
    if (typeof fallback !== 'object') assert.equal(written, `\`${String(fallback)}\``, name);
  }
});
