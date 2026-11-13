import { defineConfig } from '@playwright/test';
import { HOME } from './home-assistant.ts';

// `pnpm e2e:ha`: the built file on a real Home Assistant, which setup.ts starts in a container for
// the run (see there for HA_RUNTIME and HA_VERSION). By hand only: neither `pnpm e2e` nor
// `pnpm check` runs it. Its tests share the one Home Assistant and change what it reports, so they
// run one at a time. Home Assistant is slow to start and slower to answer while it settles, so
// the waits are long, and nothing is retried: a retry would hide a race rather than report it.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './setup.ts',
  outputDir: '../../test-results/ha',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  forbidOnly: Boolean(process.env['CI']),
  reporter: 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    timezoneId: HOME.timeZone,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
});
