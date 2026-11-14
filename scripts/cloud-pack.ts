import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { isList, isRecord } from '../src/lib/values.ts';
import { CLOUD_ART } from '../src/sky/cloud-art.ts';

const CHANNELS = 7;
const DIMENSIONS = 4;
const DIGITS = 3;
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const rectangle = (value: unknown): value is readonly [number, number, number, number] =>
  isList(value) && value.length === DIMENSIONS && value.every(integer);

// A local atlas has one rectangle per numbered shape and seven matching grayscale images.
export function cloudPack(
  directory = process.env['WEATHER_CLOUD_PACK'] ??
    (existsSync('.local/cloud-atlas/atlas.json') ? '.local/cloud-atlas' : ''),
): Plugin | undefined {
  if (!directory) return undefined;
  const paths = Array.from({ length: CHANNELS }, (_, channel) => join(directory, `clouds-${channel}.avif`));
  const phaseFile = join(directory, 'moon-phases.webp');
  const hasPhases = existsSync(phaseFile);
  const effects = Object.entries({
    wind: 'wind-streaks.webp',
    frost: 'frost-crystals.webp',
    near: 'foreground-particles.webp',
    falling: 'falling-particles.webp',
    rain: 'rain-streaks.webp',
    noise: 'weather-noise.webp',
    fringe: 'cloud-fringe.webp',
  }).filter(([, name]) => existsSync(join(directory, name)));
  const manifest: unknown = JSON.parse(readFileSync(join(directory, 'atlas.json'), 'utf8'));
  if (!isRecord(manifest)) throw new Error('The cloud atlas needs a manifest.');
  const { width, height, sprites } = manifest;
  if (!integer(width) || width <= 0 || !integer(height) || height <= 0 || !isRecord(sprites))
    throw new Error('The cloud atlas needs positive dimensions and sprite rectangles.');
  const rects = Object.entries(CLOUD_ART).flatMap(([art, group]) =>
    group.sizes.map((_, index) => {
      const key = `${art}_${String(index).padStart(DIGITS, '0')}`;
      const rect: unknown = sprites[key];
      if (!rectangle(rect)) throw new Error(`Invalid cloud atlas rectangle: ${key}.`);
      const [x, y, w, h] = rect;
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height)
        throw new Error(`Cloud atlas rectangle outside its image: ${key}.`);
      return [x, y, w, h];
    }),
  );
  let serving = false;
  return {
    name: 'local-cloud-pack',
    configResolved(config) {
      serving = config.command === 'serve';
    },
    enforce: 'pre',
    config: () => ({ define: { __CLOUD_ATLAS__: JSON.stringify({ width, height, rects }) } }),
    configureServer(server) {
      for (const [, name] of effects) {
        const image = readFileSync(join(directory, name));
        server.middlewares.use(`/@cloud-maps/${name}`, (_request, response) => {
          response.setHeader('Content-Type', 'image/webp');
          response.end(image);
        });
      }
      if (hasPhases) {
        const image = readFileSync(phaseFile);
        server.middlewares.use('/@cloud-maps/moon.webp', (_request, response) => {
          response.setHeader('Content-Type', 'image/webp');
          response.end(image);
        });
      }
      const images = paths.map(path => readFileSync(path));
      for (const [channel, image] of images.entries()) {
        server.middlewares.use(`/@cloud-maps/${channel}.avif`, (_request, response) => {
          response.setHeader('Content-Type', 'image/avif');
          response.end(image);
        });
      }
    },
    load(id) {
      if (id.endsWith('/src/sky/effect-atlases.ts')) {
        const entries = effects.map(([kind, name]) => {
          if (serving) return `${kind}: '/@cloud-maps/${name}'`;
          const file = join(directory, name);
          this.addWatchFile(file);
          const ref = this.emitFile({ type: 'asset', name, source: readFileSync(file) });
          return `${kind}: import.meta.ROLLUP_FILE_URL_${ref}`;
        });
        return `export const EFFECT_ATLASES = {${entries.join(',')}};`;
      }
      if (hasPhases && id.endsWith('/src/sky/moon-atlas.ts')) {
        if (serving) return "export const PHASE_ATLAS = '/@cloud-maps/moon.webp';";
        this.addWatchFile(phaseFile);
        const reference = this.emitFile({ type: 'asset', name: 'moon-phases.webp', source: readFileSync(phaseFile) });
        return `export const PHASE_ATLAS = import.meta.ROLLUP_FILE_URL_${reference};`;
      }
      if (!id.endsWith('/src/sky/cloud-maps.ts')) return null;
      const urls = paths.map((file, channel) => {
        if (serving) return JSON.stringify(`/@cloud-maps/${channel}.avif`);
        this.addWatchFile(file);
        const reference = this.emitFile({ type: 'asset', name: `clouds-${channel}.avif`, source: readFileSync(file) });
        return `import.meta.ROLLUP_FILE_URL_${reference}`;
      });
      return `export const CLOUD_MAPS = [${urls.join(',')}];`;
    },
  };
}
