import { expect, test, TODAY } from './card.ts';

// The card on a phone, under a finger: what a mouse never reaches.
const UV = /^UV index/;

test('the page fits the screen, with nothing to scroll sideways', async ({ card, page }) => {
  await expect(card.getByRole('button', { name: UV })).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});

test('the panels stand 20 in, over days 50 tall and tiles as tall as they are wide', async ({ card, page }) => {
  const NONE = { x: 0, y: 0, width: 0, height: 0 };
  const box = async (selector: string) => (await card.locator(selector).first().boundingBox()) ?? NONE,
    whole = (await page.locator('iweather-card').boundingBox()) ?? NONE;
  expect((await box('.forecast')).x - whole.x).toBeCloseTo(20, 0);
  expect((await box('.day')).height).toBeCloseTo(50, 0);
  const square = await box('.tile[data-tile=uv]'),
    wide = await box('.tile[data-tile=wind]');
  expect(square.height).toBeCloseTo(square.width, 0);
  expect(Math.abs(wide.height - square.height)).toBeLessThan(1);
});

test('every title stands exactly on the light it adds', async ({ card }) => {
  const off = await card.locator('.tile').evaluateAll(tiles =>
    tiles.flatMap(tile => {
      const words = tile.querySelector('header .title')?.getBoundingClientRect(),
        light = tile.querySelector('.tile-content > .lift')?.getBoundingClientRect();
      return words && light ? [Math.abs(words.x - light.x) + Math.abs(words.y - light.y)] : [];
    }),
  );
  expect(off.length).toBeGreaterThan(0);
  expect(Math.max(...off)).toBeLessThan(0.5);
  const words = (await card.locator('.measure > svg').boundingBox()) ?? { y: 0, height: 0 },
    light = (await card.locator('.forecast-content > .lift').first().boundingBox()) ?? { y: 1, height: 0 };
  expect(Math.abs(words.y + words.height / 2 - (light.y + light.height / 2))).toBeLessThan(0.5);
});

test('with the toolbar hidden the page keeps a menu button, and with it there has none', async ({ card, page }) => {
  const button = card.getByRole('button', { name: 'Menu' });
  await expect(button).toBeHidden();
  await page.addStyleTag({ content: 'html{--kiosk-header-height:0px}' });
  await expect(button).toBeVisible();
  const asked = page.evaluate(
    () => new Promise(done => addEventListener('hass-toggle-menu', () => done(true), { once: true })),
  );
  await button.tap();
  expect(await asked).toBe(true);
});

test('a tapped tile opens, and its close button closes it', async ({ card }) => {
  await card.getByRole('button', { name: UV }).tap();
  const sheet = card.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).tap();
  await expect(sheet).toBeHidden();
});

test('a sheet’s unit is picked from its glass menu, and Escape puts only the menu away', async ({ card, page }) => {
  await card.locator('.tile[data-tile=pressure]').tap();
  const sheet = card.getByRole('dialog'),
    unit = sheet.getByRole('button', { name: /^Unit/ }),
    menu = sheet.getByRole('menu', { name: 'Unit' });
  await expect(unit).toContainText('inHg');
  await unit.scrollIntoViewIfNeeded();
  await unit.tap();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(sheet).toBeVisible();
  await unit.tap();
  await menu.getByRole('menuitemradio', { name: 'Millibars (mbar)' }).tap();
  await expect(menu).toBeHidden();
  await expect(unit).toContainText('mbar');
  await expect(sheet.locator('.detail-summary').first()).toContainText('mbar');
});

test('a backdrop tap puts away the sheet menu before the sheet', async ({ card, page }) => {
  await card.evaluate(node => node.style.setProperty('--safe-area-inset-top', '40px'));
  await card.locator('.tile[data-tile=pressure]').tap();
  const sheet = card.getByRole('dialog'),
    unit = sheet.getByRole('button', { name: /^Unit/ });
  await unit.tap();
  const menu = sheet.getByRole('menu', { name: 'Unit' });
  await expect(menu).toBeVisible();
  await page.touchscreen.tap(2, 2);
  await expect(menu).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.touchscreen.tap(2, 2);
  await expect(sheet).toBeHidden();
});

test('a tapped row dips its whole list as it lifts, and opens its day', async ({ card }) => {
  const scale = () => card.locator('.daily').evaluate(list => new DOMMatrix(getComputedStyle(list).transform).a);
  await card.locator('.daily .day').nth(3).tap();
  await expect.poll(scale).toBeLessThan(1);
  await expect(card.getByRole('dialog')).toBeVisible();
});

test('a tapped chart is left as drawn', async ({ card }) => {
  await card.getByRole('button', { name: UV }).tap();
  const chart = card.getByRole('dialog').locator(`${TODAY} .chart`).first();
  await chart.locator('.chart-plot').tap();
  await expect(chart).not.toHaveAttribute('data-scrubbing');
  await expect(chart).not.toHaveAttribute('data-kept');
  await expect(chart.locator('.chart-cursor')).toHaveCount(0);
});
