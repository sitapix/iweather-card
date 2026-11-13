import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { MAPLIBRE_DEV, packageVersion } from './scripts/build-constants.ts';

// The card's days, hours, sun and moon follow Home Assistant's time zone, never the machine's, so its
// logic runs again where the machine's clock is least like anyone's: clocks that change at midnight,
// by half an hour, and across the date line. Each run takes about a second.
const ZONES = ['Atlantic/Azores', 'Australia/Lord_Howe', 'Pacific/Kiritimati'];
const NODE = { environment: 'node', include: ['test/*.test.ts'], exclude: ['test/*.browser.test.ts'] };

// `pnpm test`: the card's logic in Node, and the card itself in headless Chromium, laid out
// at every size a sections dashboard offers (test/*.browser.test.ts).
export default defineConfig({
  define: { __CARD_VERSION__: JSON.stringify(packageVersion()), __MAPLIBRE__: JSON.stringify(MAPLIBRE_DEV) },
  test: {
    projects: [
      { test: { name: 'node', ...NODE } },
      ...ZONES.map(zone => ({ test: { name: `node ${zone}`, ...NODE, env: { TZ: zone } } })),
      {
        test: {
          name: 'browser',
          include: ['test/*.browser.test.ts'],
          setupFiles: ['test/browser-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 900 },
          },
        },
      },
    ],
  },
});
