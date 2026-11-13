import { isRecord, text } from '../lib/values.ts';
import { weatherLanguage } from '../weather/i18n.ts';

// The editor's words in the user's language. Its English is its keys, so each form's text reads as
// plain English where it is written. Every language is a file of its own, beside the card's, as
// only someone setting the card up needs one, and then only theirs.
export type EditorText = (english: string) => string;
export const english: EditorText = words => words;
const FILES = import.meta.glob('./editor-text/*.json', { query: '?url', import: 'default', eager: true });
const loaded = new Map<string, Promise<EditorText>>();
async function load(language: string): Promise<EditorText> {
  const file = FILES[`./editor-text/${language}.json`];
  if (!text(file)) return english;
  const words: unknown = await fetch(file)
    .then(response => response.json())
    .catch(() => null);
  if (!isRecord(words)) return english;
  return text => {
    const word = words[text];
    return typeof word === 'string' ? word : text;
  };
}
// English until a language has come, and for good if it doesn't.
export function editorWords(language: string | undefined): Promise<EditorText> {
  const code = weatherLanguage(language);
  const words = loaded.get(code) ?? load(code);
  loaded.set(code, words);
  return words;
}
