import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { MAPLIBRE_DEV, buildVersion, packageVersion } from './scripts/build-constants.ts';
import { cloudPack } from './scripts/cloud-pack.ts';
import { withoutComments } from './scripts/style-comments.ts';

// MapLibre is as large as the card and only a map needs it, so it stands beside the card as files of
// its own, named by its version: a browser holds on to what it fetched from `/local/`, and these
// have no other way of saying they changed. `.js`, as installers compress only that, and a module's
// type then needs no setting on the server.
const SOURCE = 'node_modules/maplibre-gl/',
  version = packageVersion(`${SOURCE}package.json`),
  name = (part: string, extension: string) => `iweather-maplibre${part}-${version}.${extension}`,
  script = name('', 'js'),
  worker = name('-worker', 'js'),
  style = name('', 'css'),
  MAP_FILE = /\/\/# sourceMappingURL=.*$/mu;
function mapLibre(): Plugin {
  const code = (file: string) =>
    readFileSync(`${SOURCE}dist/${file}`, 'utf8').replaceAll('maplibre-gl-worker.mjs', worker).replace(MAP_FILE, '');
  return {
    name: 'iweather-maplibre',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: script, source: code('maplibre-gl.mjs') });
      this.emitFile({ type: 'asset', fileName: worker, source: code('maplibre-gl-worker.mjs') });
      this.emitFile({ type: 'asset', fileName: style, source: readFileSync(`${SOURCE}dist/maplibre-gl.css`) });
      this.emitFile({
        type: 'asset',
        fileName: 'iweather-maplibre-LICENSE.txt',
        source: readFileSync(`${SOURCE}LICENSE.txt`),
      });
    },
  };
}

// The card's styles reach its file without their comments, and otherwise as written (see
// style-comments).
function styleComments(): Plugin {
  return {
    name: 'iweather-style-comments',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      return /\.css(?:\?|$)/u.test(id) ? { code: withoutComments(code), map: null } : null;
    },
  };
}

// Every dashboard loads the card's file, so what stands beside it must stay out of it, and it grows
// only on purpose: past CARD_BYTES the build fails, and the number is raised by hand, by a little.
const CARD = 'iweather-card.js',
  CARD_BYTES = 1_020_000,
  WORD_FILES = 'src/weather/word-files/',
  // The longest sentences of each language, which the card's file must not hold.
  SENTENCES_EACH = 3;
const translated = () =>
  readdirSync(WORD_FILES).flatMap(file => {
    const words: unknown = JSON.parse(readFileSync(`${WORD_FILES}${file}`, 'utf8'));
    return typeof words === 'object' && words !== null
      ? Object.entries(words)
          .flatMap(([english, said]) => (typeof said === 'string' && said !== english ? [said] : []))
          .toSorted((a, b) => b.length - a.length)
          .slice(0, SENTENCES_EACH)
      : [];
  });
function cardFileGuard(): Plugin {
  return {
    name: 'iweather-card-file',
    apply: 'build',
    generateBundle(_, bundle) {
      const card = bundle[CARD];
      if (card?.type !== 'chunk') this.error(`No ${CARD} in the build.`);
      const bytes = Buffer.byteLength(card.code);
      if (bytes > CARD_BYTES)
        this.error(`${CARD} is ${bytes} bytes, over the ${CARD_BYTES} it may be: raise CARD_BYTES if that is meant.`);
      const beside: [string, string][] = [
        ['a picture or other file in base64', ';base64,'],
        ['MapLibre', 'maplibregl-canvas'],
        ...translated().map((sentence): [string, string] => ['a translation', sentence]),
      ];
      for (const [what, mark] of beside)
        if (card.code.includes(mark)) this.error(`${CARD} holds ${what}, which belongs beside it: ${mark}`);
      if (!card.code.includes('import.meta.url'))
        this.error(`${CARD} no longer finds its side files by its own address.`);
    },
  };
}

// `pnpm build`: the card's one file, with the styles inlined without their comments through `?inline` imports
// and the editor bundled in, loaded only when opened, and beside it the files it asks for as it needs
// them: its pictures, languages and MapLibre. Nothing goes in a folder, as release
// assets have none. Every dashboard loads the card's file, so what isn't needed at once stays out.
// `pnpm dev`: the preview pages, served from the sources, reloading on each change.
export default defineConfig(({ command }) => ({
  // The card's file can be served from anywhere, and asks for the rest from wherever that is.
  base: './',
  define: {
    __CARD_VERSION__: JSON.stringify(buildVersion()),
    __MAPLIBRE__: JSON.stringify(command === 'build' ? { script: `./${script}`, style: `./${style}` } : MAPLIBRE_DEV),
  },
  plugins: [cloudPack(), mapLibre(), styleComments(), cardFileGuard()],
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: {
    target: 'es2022',
    // The styles ship as written. Lightning CSS folds `backdrop-filter: var(…)` and its
    // `-webkit-` twin into the prefixed one alone, which Chrome and Firefox ignore, so
    // the panels lost their glass; minifying them saved only some 3 kB.
    cssMinify: false,
    modulePreload: false,
    // Whatever its size, a file asked for by address stays a file.
    assetsInlineLimit: 0,
    // MapLibre is large, and no chunk: it stands apart already.
    chunkSizeWarningLimit: 2048,
    // A map beside the card, so an error Home Assistant logs names the card's own source and lines.
    // Only a reader of the error asks for it. Without the sources themselves, which are most of it:
    // the lines it names are found in the repository.
    sourcemap: true,
    rolldownOptions: {
      input: 'src/iweather-card.ts',
      output: {
        entryFileNames: CARD,
        // Languages are data, but stand beside the card as `.js`, as installers compress only that.
        assetFileNames: ({ names }) =>
          names.some(name => name.endsWith('.json')) ? 'iweather-[name]-[hash].js' : 'iweather-[name]-[hash][extname]',
        sourcemapExcludeSources: true,
        codeSplitting: false,
        comments: { legal: false },
      },
    },
  },
}));
