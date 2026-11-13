import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { withoutComments } from '../scripts/style-comments.ts';

test('the comments go and everything else stays as written', () => {
  assert.equal(
    withoutComments('/* Why. */\n.a { color: red; } /* After. */\n.b{backdrop-filter:var(--m)}'),
    '\n.a { color: red; } \n.b{backdrop-filter:var(--m)}',
  );
});

test('a comment written inside a string is the string’s', () => {
  const css = `.a::before { content: "/* not a comment */"; } .b::after { content: '\\'/*' }`;
  assert.equal(withoutComments(css), css);
});

test('a comment between two characters is refused, as what it stands for depends on where it is', () => {
  assert.throws(() => withoutComments('.a/**/.b{}'), /put a space beside it/u);
  assert.throws(() => withoutComments('.a{border:1px/**/solid}'), /put a space beside it/u);
  assert.throws(() => withoutComments('.a{} /* never closed'), /unclosed/u);
});

test('the card’s styles lose only their comments', () => {
  const css = readFileSync('src/iweather-card.css', 'utf8'),
    kept = withoutComments(css),
    declarations = (text: string) => text.match(/[\w-]+\s*:[^;{}]+[;}]/gu)?.length;
  assert.ok(!kept.includes('/*'));
  assert.ok(kept.length < css.length);
  assert.equal(
    kept.match(/backdrop-filter/gu)?.length,
    css.replace(/\/\*[\s\S]*?\*\//gu, '').match(/backdrop-filter/gu)?.length,
  );
  assert.equal(declarations(kept), declarations(css.replace(/\/\*[\s\S]*?\*\//gu, '')));
});
