import { join } from 'node:path';

// Set by global setup before Playwright launches workers.
export const BUILD_ENV = 'IWEATHER_E2E_BUILD';
export function artifact(folder: 'dist' | 'site', file = ''): string {
  const root = process.env[BUILD_ENV];
  if (!root) throw new Error('No build for this test run.');
  return join(root, folder, file);
}
