import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { demoConfig } from '../demo/vite.config.ts';
import { artifact, BUILD_ENV } from './artifacts.ts';

// Every worker in this run serves the same immutable card and matching demo assets.
export default async function buildCard(): Promise<() => void> {
  const root = mkdtempSync(join(tmpdir(), 'iweather-e2e-'));
  process.env[BUILD_ENV] = root;
  const clean = () => rmSync(root, { recursive: true, force: true });
  try {
    const dist = artifact('dist');
    await build({ logLevel: 'warn', build: { outDir: dist, emptyOutDir: true } });
    await build({ ...demoConfig(dist, artifact('site')), configFile: false, logLevel: 'warn' });
    return clean;
  } catch (error) {
    clean();
    throw error;
  }
}
