import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// `pnpm demo`: the demo's pages in _site/, ready for any static host, with the card beside them as
// it ships, from dist/ (built first). The demo omits the source map and the line that points to it.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CARD = 'iweather-card.js',
  MAP_LINE = /\n\/\/# sourceMappingURL=\S+\s*$/u;

function shippedCard(dist: string, site: string): Plugin {
  return {
    name: 'iweather-demo-card',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      // Serve the source during development; the published demo loads the exact shipped file.
      handler: html => html.replace('src="../src/iweather-card.ts"', 'vite-ignore src="./iweather-card.js"'),
    },
    writeBundle() {
      if (!existsSync(join(dist, CARD))) throw new Error('dist/ has no card: run `pnpm build` first.');
      for (const name of readdirSync(dist))
        if (name === CARD)
          writeFileSync(join(site, name), readFileSync(join(dist, name), 'utf8').replace(MAP_LINE, '\n'));
        else if (!name.endsWith('.map')) copyFileSync(join(dist, name), join(site, name));
    },
  };
}

export const demoConfig = (dist: string, site: string) =>
  defineConfig({
    root: here('.'),
    base: './',
    publicDir: false,
    plugins: [shippedCard(dist, site)],
    build: {
      outDir: site,
      emptyOutDir: true,
      target: 'es2022',
      modulePreload: false,
      rolldownOptions: { input: { index: here('index.html'), setup: here('setup/index.html') } },
    },
  });

export default demoConfig(here('../dist/'), here('../_site/'));
