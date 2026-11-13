// Every sentence the card says, read from its sources: what `say`, `sayCount` and `phrase` are given.
// Run it for the list a translation needs (node scripts/word-keys.ts); the tests hold the language
// files to it. Each must be a plain string in the call, so a sentence with a value in it uses a
// placeholder.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CALL =
  /\b(say|phrase|sayCount)\(\s*(?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|([^\s'`][^,)]*))(?:\s*,\s*(?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`))?/gu;
const plain = (text: string) => text.replace(/\\(.)/gu, '$1');
const sources = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !/^(words|editor)/u.test(entry.name) ? [path] : [];
  });
export interface WordKeys {
  // What a language must say: each sentence, and for a count its plural.
  keys: string[];
  // Those that change with a count.
  counted: string[];
  // Calls the list can't see: a variable, which is fine for `say` where the table marks its words
  // with `phrase`, or a template with a value in it, which isn't.
  faults: string[];
}
export function wordKeys(root = 'src'): WordKeys {
  const keys = new Set<string>(),
    counted = new Set<string>(),
    faults: string[] = [];
  for (const path of sources(root))
    for (const match of readFileSync(path, 'utf8').matchAll(CALL)) {
      const [call, name, quoted, template, variable, plural, pluralTemplate] = match,
        text = quoted ?? template,
        other = plural ?? pluralTemplate;
      if ((template ?? '').includes('${')) faults.push(`${path}: ${call}`);
      if (name === 'sayCount') {
        if (text === undefined || other === undefined) faults.push(`${path}: ${call}`);
        else {
          keys.add(plain(other));
          counted.add(plain(other));
        }
      } else if (text !== undefined) keys.add(plain(text));
      else if (name === 'phrase' || !variable) faults.push(`${path}: ${call}`);
    }
  return { keys: [...keys].toSorted(), counted: [...counted].toSorted(), faults };
}
if (import.meta.main) console.log(JSON.stringify(wordKeys(), null, 1));
