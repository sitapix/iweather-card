import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// What the build and the tests both write into the card (see src/globals.d.ts).
export const MAPLIBRE_DEV = {
  script: '/node_modules/maplibre-gl/dist/maplibre-gl.mjs',
  style: '/node_modules/maplibre-gl/dist/maplibre-gl.css',
};
// The version in a package.json.
export function packageVersion(path = 'package.json'): string {
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    typeof manifest === 'object' &&
    manifest !== null &&
    'version' in manifest &&
    typeof manifest.version === 'string'
  )
    return manifest.version;
  throw new Error(`${path} has no version.`);
}
// The version, with the commit it was built from where git can say, as the console names the build:
// a fix awaiting release, or a build put up by hand, carries the version of the release before it.
export function buildVersion(): string {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
    return `${packageVersion()} (${commit})`;
  } catch {
    return packageVersion();
  }
}
