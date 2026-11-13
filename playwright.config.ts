import { defineConfig } from '@playwright/test';

// `pnpm e2e`: the built file, loaded as a dashboard loads it, under a real pointer, keyboard
// and finger, in each browser engine a dashboard is opened in. What the sources do on their own
// stays with `pnpm test`, which is faster and sees more. No retries: the gestures hang on timing,
// and a retry would hide a race rather than report it.
const DESKTOP = 'touch.spec.ts';
// On Linux, WebKit's clicks time out waiting for a tile that has long since stopped moving, and no
// one's Safari is there, so it runs on a Mac, where it is the real thing. Linux takes the phone in
// Chromium.
const LINUX = process.platform === 'linux';
export default defineConfig({
  testDir: 'e2e',
  // The specs in e2e/ itself. Those in its folders are run by hand, each with a config of its own:
  // e2e/ha needs a container runtime, and e2e/look this machine's own rendering.
  testMatch: 'e2e/*.spec.ts',
  globalSetup: './e2e/build.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: DESKTOP, use: { browserName: 'chromium' } },
    { name: 'firefox', testIgnore: DESKTOP, use: { browserName: 'firefox' } },
    ...(LINUX ? [] : [{ name: 'webkit', testIgnore: DESKTOP, use: { browserName: 'webkit' as const } }]),
    {
      name: 'phone',
      testIgnore: 'input.spec.ts',
      use: {
        browserName: LINUX ? 'chromium' : 'webkit',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
