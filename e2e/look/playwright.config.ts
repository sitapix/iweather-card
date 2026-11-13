import { defineConfig } from '@playwright/test';

// `pnpm e2e:look`: pictures of the built card, compared with baselines kept in baselines/. By hand
// only: neither `pnpm e2e` nor `pnpm check` runs these. A picture depends on the fonts, the GPU and
// the browser builds of the machine that took it, so the baselines belong to the machine that made
// them, and carry its platform in their names. A difference fails the run and leaves the picture
// taken, the baseline and their difference in test-results/look. Nothing updates a baseline but
// `pnpm e2e:look --update-snapshots`, run on purpose once a change to the look is meant; a missing
// one fails too, rather than being written.
// Firefox is left out: its screenshots skip backdrop-filter, so its glass would be pictured wrong.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: '../build.ts',
  outputDir: '../../test-results/look',
  snapshotPathTemplate: '{testDir}/baselines/{arg}-{projectName}-{platform}{ext}',
  updateSnapshots: 'none',
  fullyParallel: true,
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  reporter: 'list',
  expect: {
    toHaveScreenshot: {
      // Runs on one machine differ only by a level or a few of colour, at the edges of blurred
      // glass and small icons, which the per-pixel threshold doesn't count: they come out the same.
      // Up to 5 pixels in 10,000 may still differ, room for a stray edge after a driver update,
      // while moving one tile rule by 1 px changes 16 or more in 10,000 of every picture of tiles.
      maxDiffPixelRatio: 0.0005,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
