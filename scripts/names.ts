// Names this project never writes: of other products and apps, and of where a behaviour came from.
// Each rule is said on its own terms instead. Checked over every file git keeps (`pnpm lint`), the
// staged files and each commit message (.githooks).
//
// Each name is kept as the first 16 hex digits of the SHA-256 of its words, in lower case and joined
// by a space, as a list of the names themselves would be what it forbids. A name of several words
// also keeps its first word's, so only the phrases that could be one are hashed. To add a name, run
// `node scripts/names.ts --digest "Some Name"` and add what it prints.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NAMES = new Set([
  '3a7bd3e2360a3d29',
  'a0c0485eff9c817d',
  '48ee046028069a9c',
  'b33e13c3c5be0ac7',
  '241c1e30ed886aa4',
  'de0ba1b766697343',
  '98c001ea23f7c22a',
  '93478651d8675b6b',
  '4ab4d2674bb001b6',
  'dced3c9b82dbfd5e',
  '15c5e1679f6a2c48',
  '9a4e6e09fe2f827a',
  '5ef2c394d5b63e41',
  '2401ae75cadf5486',
  'b20aef8327cbd7ad',
  '5536a646767eeca5',
  'b27a0107538ddcf1',
  '9622c460e5a7b974',
]);
const FIRST_WORDS = new Set([
  '2df44271fb4e3dff',
  '52367a6622b19f08',
  'b96482290a873ee9',
  'df4ac416257333cf',
  '43385991f0be5fed',
  'd8198efa3604d164',
]);
// Words in the longest name.
const LONGEST = 3;
// Letters, digits and underscores make a word, so a name inside an identifier such as `ios_saf`
// is part of another word, not the name.
const WORD = /[\p{L}\p{N}_]+/gu;
const DIGITS = 16;

const hashed = new Map<string, string>();
// A name's digest, as kept above.
export function digest(name: string): string {
  const key = (name.toLowerCase().match(WORD) ?? []).join(' ');
  let found = hashed.get(key);
  if (found === undefined) {
    found = createHash('sha256').update(key).digest('hex').slice(0, DIGITS);
    hashed.set(key, found);
  }
  return found;
}

export interface NameLists {
  names: ReadonlySet<string>;
  firstWords: ReadonlySet<string>;
}
const KEPT: NameLists = { names: NAMES, firstWords: FIRST_WORDS };
// The names in `text`, as written there, with the line each is on.
export function namesIn(text: string, { names, firstWords }: NameLists = KEPT): { line: number; name: string }[] {
  const found: { line: number; name: string }[] = [];
  text.split('\n').forEach((line, index) => {
    const words = line.match(WORD) ?? [];
    words.forEach((word, at) => {
      const first = digest(word);
      if (names.has(first)) found.push({ line: index + 1, name: word });
      if (!firstWords.has(first)) return;
      for (let length = 2; length <= LONGEST && at + length <= words.length; length += 1) {
        const phrase = words.slice(at, at + length).join(' ');
        if (names.has(digest(phrase))) found.push({ line: index + 1, name: phrase });
      }
    });
  });
  return found;
}

// A file's text, unless it holds bytes no text does.
function textOf(path: string): string | undefined {
  try {
    const bytes = readFileSync(path);
    return bytes.includes(0) ? undefined : bytes.toString('utf8');
  } catch {
    return undefined;
  }
}

function main(args: string[]): number {
  if (args[0] === '--digest') {
    const name = args.slice(1).join(' '),
      [first] = name.toLowerCase().match(WORD) ?? [];
    console.log(`name: '${digest(name)}'`);
    if (first !== undefined && first !== name.toLowerCase().trim()) console.log(`first word: '${digest(first)}'`);
    return 0;
  }
  // A commit message, without the lines git adds as comments.
  const sources: [string, string | undefined][] =
    args[0] === '--message'
      ? [
          [
            'the commit message',
            textOf(args[1] ?? '')
              ?.split('\n')
              .filter(line => !line.startsWith('#'))
              .join('\n'),
          ],
        ]
      : (args.length
          ? args
          : execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
        ).map((path): [string, string | undefined] => [path, textOf(path)]);
  let faults = 0;
  for (const [where, text] of sources)
    for (const { line, name } of text === undefined ? [] : namesIn(text)) {
      console.error(`${where}:${line}: "${name}" names another product, or where something came from.`);
      faults += 1;
    }
  return faults ? 1 : 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
