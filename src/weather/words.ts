import { isRecord, text } from '../lib/values.ts';
import { weatherLanguage } from './i18n.ts';

// The card's sentences in the user's language. Their English is their keys, so each reads as plain
// English where it is written, and with no language loaded the card reads exactly as it is written.
// A page has one language, so these are the page's. Each language is a file of its own beside the
// card's, as nobody needs more than one. Say a sentence whole, with what changes as a placeholder:
// word order and agreement differ by language, so one built from pieces can't be translated.

// A word's forms by Intl.PluralRules' categories, for a language with more than one.
type Forms = Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;
type Word = string | Forms;
type Words = Readonly<Record<string, Word>>;
type Values = Readonly<Record<string, string | number>>;
const ENGLISH = 'en';
const NONE: Words = {};
const FILES = import.meta.glob('./word-files/*.json', { query: '?url', import: 'default', eager: true });
const loaded = new Map<string, Promise<Words>>();
let language = ENGLISH;
let requestedLanguage = ENGLISH;
let words = NONE;

// A sentence that opens on a value opens with a capital, as a weekday doesn't have one in every
// language.
const fill = (text: string, values: Values | undefined) => {
  if (!values) return text;
  const filled = text.replace(/\{(\w+)\}/gu, (mark, name: string) => String(values[name] ?? mark));
  return text.startsWith('{') ? filled.charAt(0).toLocaleUpperCase(language) + filled.slice(1) : filled;
};
// Marks a sentence kept in a table, to be said later, so it is translated with the rest.
export const phrase = <T extends string>(english: T): T => english;
// A sentence in the page's language.
export function say(english: string, values?: Values): string {
  const found = words[english];
  return fill(typeof found === 'string' ? found : english, values);
}
// A sentence that changes with a count, which is `{count}` in it unless `values` says otherwise.
export function sayCount(one: string, other: string, count: number, values?: Values): string {
  const found = words[other],
    english = count === 1 ? one : other,
    forms = typeof found === 'object' ? found : undefined,
    form = forms && (forms[new Intl.PluralRules(language).select(count)] ?? forms.other);
  return fill(form ?? (typeof found === 'string' ? found : english), { count, ...values });
}

const isWord = (entry: [string, unknown]): entry is [string, Word] =>
  typeof entry[1] === 'string' || isRecord(entry[1]);
async function read(code: string): Promise<Words> {
  const file = FILES[`./word-files/${code}.json`];
  if (!text(file)) return NONE;
  const table: unknown = await fetch(file)
    .then(response => response.json())
    .catch(() => null);
  return isRecord(table) ? Object.fromEntries(Object.entries(table).filter(isWord)) : NONE;
}
// Sets the page's words; for a test, or from a file (see loadWords).
export function useWords(code: string, table: Words) {
  requestedLanguage = code;
  language = code;
  words = table;
}
// Brings in a language, and says whether the words changed. English until it has come, and for good
// if it doesn't.
export async function loadWords(requested: string | undefined): Promise<boolean> {
  const code = weatherLanguage(requested);
  requestedLanguage = code;
  if (code === language) return false;
  const pending = loaded.get(code) ?? read(code);
  loaded.set(code, pending);
  const table = await pending;
  // A slower previous language must not replace the one the page now asks for.
  if (requestedLanguage !== code) return false;
  useWords(code, table);
  // English or a failed load also replaces the previous language, so every waiting card redraws.
  return true;
}
