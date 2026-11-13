import type { Locator, Page } from '@playwright/test';
import { TODAY, expect, landed, test } from './card.ts';

// A sheet's frame, in each engine: its size comes from the styles alone, through a zoom each
// engine does its own way, so a measurement in one says nothing about the others. Lengths here
// are the sheet's own px, which a standard card draws at .8.
const ZOOM = 0.8,
  NEAR = 0.1,
  WIDTH = 400,
  HEIGHT = 800,
  // Long enough for a press to have shrunk the tile, short of what opens it held.
  PRESSED = 250,
  WHOLE_PIXELS = 2,
  FAR = 2000,
  // Tall enough for a sheet beside a tile to stand level with it.
  TALL = { width: 1280, height: 1000 };

// A box's top, from the top of the sheet's rounded rectangle.
async function top(dialog: Locator, selector: string) {
  const sheetTop = await dialog.evaluate(node => node.getBoundingClientRect().top),
    box = await dialog.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No ${selector}.`);
  return (box.y - sheetTop) / ZOOM;
}
const frameOf = (dialog: Locator) =>
  dialog.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  });
const opened = async (card: Locator, tile: string) => {
  await card.locator(`.tile[data-tile=${tile}]`).click();
  const dialog = card.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await landed(dialog);
  return dialog;
};

test.describe('at the desk', () => {
  test.skip(({ isMobile }) => isMobile, 'A phone has its own test below.');

  for (const tile of ['uv', 'wind', 'moon', 'precipitation'])
    test(`the ${tile} sheet is the one size`, async ({ card }) => {
      const dialog = await opened(card, tile),
        frame = await frameOf(dialog);
      expect(frame.width).toBeCloseTo(WIDTH * ZOOM, 1);
      expect(frame.height).toBeCloseTo(HEIGHT * ZOOM, 1);
    });

  test('tabs and days move nothing, and nothing under the tabs', async ({ card }) => {
    await card.locator('.modes [data-mode=conditions]').click();
    await card.locator('.daily .day').first().click();
    const dialog = card.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await landed(dialog);
    const frame = await frameOf(dialog),
      chance = await top(dialog, '.detail-chance'),
      pressed = async (name: string) => {
        await dialog.getByRole('button', { name, exact: true }).click();
        expect(await frameOf(dialog)).toEqual(frame);
        expect(Math.abs((await top(dialog, '.detail-chance')) - chance)).toBeLessThan(NEAR);
      };
    await pressed('Feels Like');
    await pressed('Actual');
    await pressed('Next day');
    expect(await frameOf(dialog)).toEqual(frame);
  });

  test('a screen too short for it shrinks it to fit, and the sheet scrolls', async ({ card, page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    const dialog = await opened(card, 'uv'),
      frame = await frameOf(dialog),
      sheet = dialog.locator('.sheet');
    expect(frame.height).toBeCloseTo(500 - 24, 1);
    expect(frame.width).toBeCloseTo(WIDTH * ZOOM, 1);
    expect(frame.top).toBeGreaterThanOrEqual(0);
    expect(frame.top + frame.height).toBeLessThanOrEqual(500);
    expect(await sheet.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  });

  test('the title and what follows it keep their places, and the bar is 80 tall once scrolled', async ({ card }) => {
    const dialog = await opened(card, 'uv'),
      sheet = dialog.locator('.sheet'),
      band = dialog.locator('.sheet-band'),
      title = await dialog.locator('.sheet > header h2').boundingBox(),
      sheetTop = await dialog.evaluate(node => node.getBoundingClientRect().top);
    if (!title) throw new Error('No title.');
    expect(((title.y + title.height / 2 - sheetTop) / ZOOM - 40) ** 2).toBeLessThan(1);
    expect(await top(dialog, '.detail-days')).toBeCloseTo(92.5, 0);
    expect(await top(dialog, '.detail-date')).toBeCloseTo(158.75, 0);
    expect(await top(dialog, '.detail-reading')).toBeCloseTo(215, 0);
    expect(await top(dialog, '.chart')).toBeCloseTo(284.4, 0);
    // At rest the bar has no fill and no line, and the title is the sheet's own.
    const glass = () => band.evaluate(node => Number(getComputedStyle(node, '::before').opacity));
    expect(await glass()).toBe(0);
    await sheet.evaluate(node => {
      node.scrollTop = 200;
    });
    await expect.poll(glass).toBe(1);
    const box = await band.boundingBox(),
      moved = await band.locator('h2').boundingBox();
    if (!box || !moved) throw new Error('No bar.');
    expect(box.height / ZOOM).toBeCloseTo(80, 0);
    expect(box.y).toBeCloseTo(sheetTop, 0);
    expect(moved.y).toBeCloseTo(title.y, 0);
    await expect(dialog.locator('.sheet > header h2')).toHaveCSS('opacity', '0');
    await expect(band.locator('h2')).toBeVisible();
  });

  test('the glass is the same in every engine, its blur scaled with the sheet', async ({ card }) => {
    const dialog = await opened(card, 'uv'),
      look = await dialog.locator('.sheet-glass').evaluate(node => {
        const style = getComputedStyle(node);
        return [style.getPropertyValue('--popover-blur'), style.backgroundColor, style.zoom];
      });
    expect(look).toEqual(['blur(10px) saturate(1.5)', 'rgba(107, 110, 115, 0.5)', String(ZOOM)]);
  });

  test('a pointer has no close button, as a press outside closes the sheet', async ({ card, page }) => {
    const dialog = await opened(card, 'uv');
    await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0);
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
  });

  // The UV tile with room beside it for its sheet, as a page without air quality leaves it.
  test.describe('beside its tile', () => {
    test.use({
      config: {
        tiles: [
          'wind',
          'moon',
          'sun',
          'uv',
          'map',
          'feels_like',
          'averages',
          'precipitation',
          'visibility',
          'humidity',
          'pressure',
        ],
      },
    });
    test('a sheet lies 13 from the tile a press left, and stays when the press has let go', async ({ card, page }) => {
      await page.setViewportSize(TALL);
      const tile = card.locator('.tile[data-tile=uv]'),
        rest = await tile.boundingBox();
      if (!rest) throw new Error('No tile.');
      await tile.hover();
      await page.mouse.down();
      await page.waitForTimeout(PRESSED);
      await page.mouse.up();
      const dialog = card.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await landed(dialog);
      const frame = await frameOf(dialog),
        side = await dialog.getAttribute('data-side');
      expect(side === 'left' ? rest.x - (frame.left + frame.width) : frame.left - (rest.x + rest.width)).toBeCloseTo(
        13,
        0,
      );
      expect(frame.top + frame.height / 2).toBeCloseTo(rest.y + rest.height / 2, 0);
      await dialog.getByRole('button', { name: 'Next day' }).click();
      expect(await frameOf(dialog)).toEqual(frame);
    });
  });

  test('the strip moves on its own, the least that shows the day', async ({ card, page }) => {
    const dialog = await opened(card, 'uv'),
      strip = dialog.locator('.detail-days'),
      next = dialog.getByRole('button', { name: 'Next day' }),
      // Each engine rounds to its own pixels.
      scrolledTo = (left: number) => async () =>
        Math.abs((await strip.evaluate(node => node.scrollLeft)) - left) < WHOLE_PIXELS,
      from = await page.evaluate(() => scrollY);
    await expect(strip.getByRole('button')).toHaveCount(11);
    await expect(dialog.getByRole('button', { name: 'Previous day' })).toBeEnabled();
    for (let i = 0; i < 6; i += 1) await next.click();
    await expect.poll(scrolledTo(6.25)).toBe(true);
    await next.click();
    await expect.poll(scrolledTo(56.25)).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBe(from);
    for (let i = 0; i < 8; i += 1) await dialog.getByRole('button', { name: 'Previous day' }).click();
    await expect(dialog.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    await expect.poll(scrolledTo(0)).toBe(true);
    await expect(strip.locator('[aria-pressed=true]')).toHaveAttribute('data-tense', 'past');
  });

  test('the thumb slides between the tabs, in every engine', async ({ card }) => {
    await card.locator('.modes [data-mode=conditions]').click();
    await card.locator('.daily .day').first().click();
    const dialog = card.getByRole('dialog');
    await landed(dialog);
    const thumb = dialog.locator('.segmented .thumb'),
      left = async () => (await thumb.boundingBox())?.x ?? Number.NaN,
      from = await left(),
      width = (await thumb.boundingBox())?.width;
    await dialog.getByRole('button', { name: 'Feels Like', exact: true }).click();
    await expect.poll(left).toBeCloseTo(from + 187.5 * ZOOM, 0);
    expect((await thumb.boundingBox())?.width).toBeCloseTo(width ?? Number.NaN, 1);
  });

  test('a sheet goes with its tile as the page scrolls behind it, and closes once that is off screen', async ({
    card,
    page,
  }) => {
    await page.setViewportSize(TALL);
    await page.evaluate(far => {
      document.body.style.paddingBottom = `${far}px`;
    }, FAR);
    const tile = card.locator('.tile[data-tile=uv]');
    // Keep the anchor centred so scrolling does not cross a popover placement threshold.
    await tile.evaluate(node => node.scrollIntoView({ block: 'center' }));
    const dialog = await opened(card, 'uv'),
      apart = async () => {
        const box = await tile.boundingBox(),
          frame = await frameOf(dialog);
        return (box?.y ?? Number.NaN) - frame.top;
      },
      was = await apart(),
      scrolled = await page.evaluate(() => scrollY);
    await page.mouse.move(2, 300);
    await page.mouse.wheel(0, 60);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrolled);
    await expect.poll(apart).toBeCloseTo(was, 0);
    await expect(dialog).toBeVisible();
    await page.mouse.wheel(0, FAR);
    await expect(dialog).toBeHidden();
  });

  test('a change of window size closes a sheet', async ({ card, page }) => {
    const dialog = await opened(card, 'uv');
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect(dialog).toBeHidden();
  });

  test('the pointer stays an arrow over the page and a sheet on it', async ({ card }) => {
    // Browsers give links and controls cursors of their own, each engine its own, so this reads
    // what each one works out rather than what the styles ask for.
    const others = () =>
      card.evaluate(host =>
        [...(host.shadowRoot?.querySelectorAll('*') ?? [])]
          .filter(node => getComputedStyle(node).cursor !== 'default')
          .map(node => `${node.localName}.${node.getAttribute('class') ?? ''}`),
      );
    expect(await others()).toEqual([]);
    await opened(card, 'uv');
    expect(await others()).toEqual([]);
  });
});

test('on a phone a tile opens a sheet the width of the screen, down to its foot', async ({ card, page, isMobile }) => {
  test.skip(!isMobile, 'Only a phone is this narrow.');
  await card.locator('.tile[data-tile=uv]').tap();
  const dialog = card.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-bottom', '');
  await landed(dialog);
  const frame = await frameOf(dialog),
    sheet = await dialog.locator('.sheet').boundingBox(),
    viewport = page.viewportSize();
  if (!sheet || !viewport) throw new Error('No sheet.');
  expect(frame.width).toBeCloseTo(viewport.width, 0);
  expect(sheet.x).toBeCloseTo(0, 0);
  // Its frame reaches the foot of the screen, with its content running on below.
  expect(frame.top + frame.height).toBeCloseTo(viewport.height, 0);
  expect(sheet.y + sheet.height).toBeGreaterThanOrEqual(viewport.height - 1);
  expect(sheet.y).toBeGreaterThanOrEqual(0);
});

// A phone 402 points across draws a sheet a shade larger than its own px, where WebKit reads a
// scroll near its start a pixel on.
test.describe('on a phone 402 points across', () => {
  test.use({ viewport: { width: 402, height: 874 } });
  test('a sheet’s strip of days opens at its start, its first day 8 px in, and stays there once drawn again', async ({
    card,
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Only a phone is this narrow.');
    await card.locator('.tile[data-tile=uv]').tap();
    const dialog = card.getByRole('dialog');
    await landed(dialog);
    // The sheet is 400 of its own px across, drawn to the width of the screen.
    const firstDay = () =>
      dialog.locator('.detail-days').evaluate(strip => {
        const scale = strip.getBoundingClientRect().width / 400,
          day = strip.querySelector('button');
        return day ? (day.getBoundingClientRect().left - strip.getBoundingClientRect().left) / scale : Number.NaN;
      });
    expect(await firstDay()).toBeCloseTo(8, 0);
    // Its history comes and it is drawn again; then a tap draws it again too.
    await page.waitForTimeout(500);
    await dialog.locator('.detail-summary, .detail-note').first().tap();
    expect(await firstDay()).toBeCloseTo(8, 0);
  });
});

test('on a phone a sheet of a day’s readings turns to another from its menu', async ({ card, page, isMobile }) => {
  test.skip(!isMobile, 'Only a phone is this narrow.');
  await card.locator('.tile[data-tile=uv]').tap();
  const dialog = card.getByRole('dialog', { name: 'UV Index' });
  await expect(dialog).toBeVisible();
  await landed(dialog);
  await dialog.getByRole('button', { name: 'Weather details' }).tap();
  const menu = dialog.getByRole('menu', { name: 'Weather details' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'UV Index' })).toHaveAttribute('aria-checked', 'true');
  // Grown to its whole size, on the screen.
  await menu.evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  const box = await menu.boundingBox(),
    viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('No menu.');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await menu.getByRole('menuitemradio', { name: 'Wind' }).tap();
  await expect(card.getByRole('dialog', { name: 'Wind' })).toBeVisible();
  await expect(menu).toBeHidden();
});

test('on a phone a sheet’s unit is picked from a menu that rises over its row, and the card keeps it', async ({
  card,
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Only a phone is this narrow.');
  await card.locator('.tile[data-tile=pressure]').tap();
  const dialog = card.getByRole('dialog', { name: 'Pressure' });
  await landed(dialog);
  await dialog.evaluate(node => {
    node.scrollTop = node.scrollHeight;
  });
  const unit = dialog.getByRole('button', { name: /^Unit/ }),
    menu = dialog.getByRole('menu', { name: 'Unit' });
  await unit.tap();
  await expect(menu).toBeVisible();
  await menu.evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  // Over the row, its foot a little under the row's middle, and on the screen.
  const box = await menu.boundingBox(),
    row = await unit.boundingBox(),
    viewport = page.viewportSize();
  if (!box || !row || !viewport) throw new Error('No menu.');
  expect(box.y).toBeLessThan(row.y);
  expect(box.y + box.height).toBeGreaterThan(row.y + row.height / 2);
  expect(box.y + box.height).toBeLessThan(row.y + row.height);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await menu.getByRole('menuitemradio', { name: 'Hectopascals (hPa)' }).tap();
  await expect(menu).toBeHidden();
  await expect(unit).toContainText('hPa');
  await expect(dialog.locator('.detail-summary').first()).toContainText('hPa');
  // Its chart's scale is worked out again in the unit, from the forecast's hours too, which come from
  // another source: worked out from both before that was converted, it would run from about 30 to
  // 1,013 in a few hundred steps, and stay so while the sheet is open. So again going back.
  const scale = dialog.locator(`${TODAY} .chart-y span`);
  await expect
    .poll(() => scale.allTextContents())
    .toEqual(expect.arrayContaining([expect.stringMatching(/^1,0\d\d$/u)]));
  expect((await scale.allTextContents()).every(tick => /^1,0\d\d$/u.test(tick))).toBe(true);
  expect(await scale.count()).toBeLessThan(10);
  await unit.tap();
  await menu.getByRole('menuitemradio', { name: 'Inches of mercury (inHg)' }).tap();
  await expect(unit).toContainText('inHg');
  await expect.poll(async () => (await scale.allTextContents()).every(tick => /^\d\d(\.\d+)?$/u.test(tick))).toBe(true);
  expect(await scale.count()).toBeLessThan(10);
  const kept: unknown = JSON.parse(await page.evaluate(() => localStorage.getItem('iweather-units') ?? '{}'));
  expect(kept).toEqual({ pressure_unit: { unit: 'inHg', over: 'auto' } });
});

test.describe('with popovers chosen', () => {
  test.use({ config: { sheet_style: 'popover' } });
  test('on a phone a tile keeps to the desk’s popover, on the screen whole', async ({ card, page, isMobile }) => {
    test.skip(!isMobile, 'Only a phone is this narrow.');
    await card.locator('.tile[data-tile=uv]').tap();
    const dialog = card.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await landed(dialog);
    const frame = await frameOf(dialog),
      sheet = await dialog.locator('.sheet').boundingBox(),
      viewport = page.viewportSize();
    if (!sheet || !viewport) throw new Error('No sheet.');
    expect(frame.width).toBeCloseTo(WIDTH * ZOOM, 1);
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(viewport.height);
  });
});

test.describe('a sheet from the foot, under a mouse', () => {
  test.use({ config: { sheet_style: 'sheet' }, viewport: { width: 390, height: 844 } });
  test.skip(({ isMobile }) => isMobile, 'A phone has no mouse.');
  const STEPS = 12,
    // Short of half way, slowly enough to come back.
    NEAR_PULL = 200,
    FAR_PULL = 500,
    SETTLED = 200,
    // Kept clear of the window's edge.
    EDGE = 8;
  // A press at `from`, taken `by` px down, and held there until its speed has died away.
  const pulled = async (page: Page, from: { x: number; y: number }, by: number) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + by, { steps: STEPS });
  };
  const place = (dialog: Locator) => dialog.evaluate(node => node.getBoundingClientRect().top);
  // A point on `part`, its middle where there is room, with `by` px of the window below it: a
  // mouse taken past the window's edge isn't heard there in every browser.
  const centre = async (part: Locator, by: number) => {
    const box = await part.boundingBox(),
      height = part.page().viewportSize()?.height;
    if (!box || height === undefined) throw new Error('Nothing there.');
    const y = Math.min(box.y + box.height / 2, height - by - EDGE);
    if (y < box.y) throw new Error(`No room to pull ${by}px from it.`);
    return { x: box.x + box.width / 2, y };
  };

  for (const [where, selector] of [
    ['its title', '.sheet > header h2'],
    ['what it holds', '.detail-summary'],
  ] as const)
    test(`pulled from ${where} it follows, and comes back from near`, async ({ card, page }) => {
      const dialog = await opened(card, 'humidity'),
        rest = await place(dialog);
      await pulled(page, await centre(dialog.locator(selector).first(), NEAR_PULL), NEAR_PULL);
      await expect.poll(() => place(dialog)).toBeCloseTo(rest + NEAR_PULL, 0);
      await page.waitForTimeout(SETTLED);
      expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('');
      await page.mouse.up();
      await expect.poll(() => place(dialog)).toBeCloseTo(rest, 0);
      await expect(dialog).toBeVisible();
    });

  test('pulled far it goes', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity');
    await pulled(page, await centre(dialog.locator('.sheet > header h2'), FAR_PULL), FAR_PULL);
    await page.waitForTimeout(SETTLED);
    await page.mouse.up();
    await expect(dialog).toBeHidden();
  });

  test('a day pressed and pulled is not chosen', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await place(dialog),
      day = dialog.locator('.detail-days button[aria-pressed=true] + button'),
      chosen = await dialog.locator('.detail-days button[aria-pressed=true]').textContent();
    await pulled(page, await centre(day, NEAR_PULL), NEAR_PULL);
    await expect.poll(() => place(dialog)).toBeCloseTo(rest + NEAR_PULL, 0);
    await page.waitForTimeout(SETTLED);
    await page.mouse.up();
    await expect(dialog.locator('.detail-days button[aria-pressed=true]')).toHaveText(chosen ?? '');
  });

  test('a press on a chart reads it, and the sheet stays where it is', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await place(dialog);
    await pulled(page, await centre(dialog.locator(`${TODAY} .chart-plot`).first(), NEAR_PULL / 2), NEAR_PULL / 2);
    await expect(dialog.locator('.chart[data-scrubbing]').first()).toBeAttached();
    expect(await place(dialog)).toBeCloseTo(rest, 0);
    await page.mouse.up();
  });

  test('a mouse that wavers as it sets off still pulls', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await place(dialog),
      from = await centre(dialog.locator('.sheet > header h2'), NEAR_PULL);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 2, from.y);
    await page.mouse.move(from.x + 2, from.y + NEAR_PULL, { steps: STEPS });
    await expect.poll(() => place(dialog)).toBeGreaterThan(rest + NEAR_PULL / 2);
    await page.mouse.up();
  });

  test('a mouse going sideways leaves it be', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await place(dialog),
      from = await centre(dialog.locator('.sheet > header h2'), NEAR_PULL);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + NEAR_PULL / 2, from.y + 2, { steps: STEPS });
    await page.mouse.move(from.x + NEAR_PULL / 2, from.y + NEAR_PULL, { steps: STEPS });
    expect(await place(dialog)).toBeCloseTo(rest, 0);
    await page.mouse.up();
  });
});

test.describe('a sheet from the foot, under a finger', () => {
  test.use({ config: { sheet_style: 'sheet' }, viewport: { width: 390, height: 844 }, hasTouch: true });
  // A finger through the browser's own input, which Chromium alone takes from a script: the
  // browser's own scrolling moves the sheet, so nothing short of that would.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Only Chromium takes a finger from a script.');
  const STEPS = 12,
    FRAME = 16,
    MS = 1000,
    // Short of half way, held still before letting go.
    NEAR_PULL = 200,
    FAR_PULL = 500,
    // Short of half way, and fast enough to send it, by some way, since a busy machine slows the
    // browser's own finger: in px, and px a second.
    FLICK = { by: 200, speed: 3000 },
    // Short and slow, let go still moving: nowhere near going, however it is let go.
    TUG = { by: 80, speed: 200 },
    HELD = 250,
    // The scroll the content is given before a pull.
    SCROLLED_BY = 120,
    // From letting a flick go to a finger setting off up the page: long after the sheet is on its
    // way, long before a scroll would have come to rest.
    THEN_UP = 100,
    // A flick that sends the sheet has it on its way out by this many ms after it ends.
    SENT = 300,
    // Flicks given to get a sheet on its way out, as a busy machine can stall the browser's finger.
    SEND_WITHIN = 5000;
  type Point = { x: number; y: number };
  // The browser reads a finger's speed from when each of its moves says it came, so each says so
  // exactly, a frame after the last: when a script's message happens to land would make a flick
  // of a pull now and then. The card reads a flick's from when its moves reach the page, so the
  // browser makes those itself, each as it happens: a script's, waiting on a busy page, come late.
  const fingerOn = async (page: Page) => {
    const cdp = await page.context().newCDPSession(page),
      now = () => Date.now() / MS,
      frame = FRAME / MS;
    let last = 0;
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: Point | undefined, timestamp: number) => {
      last = timestamp;
      return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [at] : [], timestamp });
    };
    // From `from`, `by` px across and down in even steps, a frame apart, once `held` has had it
    // held still for as long as that takes, if it is given.
    const stroke = async (from: Point, by: Point, steps: number, held?: () => Promise<void>) => {
      let start = now();
      await send('touchStart', from, start);
      if (held) {
        await held();
        start = now();
      }
      for (let step = 1; step <= steps; step++) {
        await send(
          'touchMove',
          { x: from.x + (by.x * step) / steps, y: from.y + (by.y * step) / steps },
          start + step * frame,
        );
        await page.waitForTimeout(FRAME);
      }
    };
    return {
      // Down at `from`, then `by` px down (up if less than 0).
      pull: (from: Point, by: number, steps = STEPS, held?: () => Promise<void>) =>
        stroke(from, { x: 0, y: by }, steps, held),
      // Down at `from`, held still until `held` is done, then `by` px across and down.
      slide: (from: Point, by: Point, held: () => Promise<void>) => stroke(from, by, STEPS, held),
      // Down at `from`, `by` px down (up if less than 0) at `speed` px a second, and let go as it
      // moves.
      flick: (from: Point, { by, speed }: { by: number; speed: number }) =>
        cdp.send('Input.synthesizeScrollGesture', {
          ...from,
          yDistance: by,
          speed,
          gestureSourceType: 'touch',
          preventFling: false,
        }),
      // Down at `from`, `by` px down at `speed` px a second, a frame at a time, and let go still moving.
      // Unlike `flick`, which the browser answers only once the scroll it sets off has run its course,
      // this is done the moment the finger lifts.
      throw: async (from: Point, { by, speed }: { by: number; speed: number }) => {
        await stroke(from, { x: 0, y: by }, Math.max(1, Math.round(((by / speed) * MS) / FRAME)));
        await send('touchEnd', undefined, last + frame);
      },
      // Across, `by` px to the right (left if less than 0), and let go.
      async swipe(from: Point, by: number) {
        await stroke(from, { x: by, y: 0 }, STEPS);
        await send('touchEnd', undefined, last + frame);
      },
      // Let go, held still since the last move.
      letGo: () => send('touchEnd', undefined, now()),
    };
  };
  const sheetTop = (dialog: Locator) => dialog.locator('.sheet').evaluate(node => node.getBoundingClientRect().top);
  const centre = async (part: Locator) => {
    const box = await part.boundingBox();
    if (!box) throw new Error('Nothing there.');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // Its content scrolled: the dialog's one scroll, past the sheet's place a screen down it.
  const scrolled = (dialog: Locator) =>
    dialog.evaluate(async (node, by) => {
      node.scrollTop = node.clientHeight + by;
      await new Promise(done => setTimeout(done, 200));
    }, SCROLLED_BY);
  const contentScrolled = (dialog: Locator) => dialog.evaluate(node => node.scrollTop - node.clientHeight);
  // The middle of the screen, on whatever of the sheet shows there.
  const middle = (page: Page) => {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('No viewport.');
    return { x: viewport.width / 2, y: viewport.height / 2 };
  };

  for (const [where, selector] of [
    ['its title', '.sheet > header h2'],
    ['what it holds', '.detail-summary'],
  ] as const)
    test(`pulled from ${where} it follows, and comes back from near`, async ({ card, page }) => {
      const dialog = await opened(card, 'humidity'),
        rest = await sheetTop(dialog),
        finger = await fingerOn(page);
      await finger.pull(await centre(dialog.locator(selector).first()), NEAR_PULL);
      await page.waitForTimeout(HELD);
      const held = await sheetTop(dialog);
      // Some of a pull goes on the browser making out that it is one.
      expect(held).toBeGreaterThan(rest + NEAR_PULL / 2);
      expect(held).toBeLessThanOrEqual(rest + NEAR_PULL + WHOLE_PIXELS);
      await finger.letGo();
      await expect.poll(() => sheetTop(dialog)).toBeCloseTo(rest, 0);
      await expect(dialog).toBeVisible();
    });

  test('pulled far and held, it goes once let go', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      finger = await fingerOn(page);
    await finger.pull(await centre(dialog.locator('.sheet > header h2')), FAR_PULL);
    await page.waitForTimeout(HELD);
    await expect(dialog).toBeVisible();
    await finger.letGo();
    await expect(dialog).toBeHidden();
  });

  test('a short slow pull let go still moving comes back', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await sheetTop(dialog),
      finger = await fingerOn(page);
    await finger.flick(await centre(dialog.locator('.detail-summary').first()), TUG);
    await expect.poll(() => sheetTop(dialog)).toBeCloseTo(rest, 0);
    await expect(dialog).toBeVisible();
  });

  test('a short flick sends it', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      finger = await fingerOn(page);
    await finger.flick(await centre(dialog.locator('.detail-summary').first()), FLICK);
    await expect(dialog).toBeHidden();
  });

  test('on its way out nothing brings it back, as a finger setting off up the page straight after', async ({
    card,
    page,
  }) => {
    const dialog = await opened(card, 'humidity'),
      finger = await fingerOn(page),
      viewport = page.viewportSize();
    if (!viewport) throw new Error('No viewport.');
    // On its way out first. A busy machine can hold the finger's moves back, and they are timed as
    // they reach the page, so the sheet rightly takes them for a slow pull and comes back: it is
    // thrown again until it goes. What it does once on its way is what is tested, never retried.
    const from = await centre(dialog.locator('.detail-summary').first());
    await expect(async () => {
      await finger.throw(from, FLICK);
      // Out of the page's reading once on its way, it is found by its mark.
      await expect(card.locator('dialog[data-thrown]')).toBeAttached({ timeout: SENT });
    }).toPass({ timeout: SEND_WITHIN });
    await page.waitForTimeout(THEN_UP);
    await finger.flick({ x: viewport.width / 2, y: viewport.height / 2 }, { ...FLICK, by: -NEAR_PULL });
    await expect(dialog).toBeHidden();
  });

  test('its content flicked up to its top stops there, and a pull straight after moves the sheet', async ({
    card,
    page,
  }) => {
    const dialog = await opened(card, 'wind'),
      rest = await sheetTop(dialog),
      finger = await fingerOn(page);
    await scrolled(dialog);
    await finger.flick(middle(page), { ...FLICK, by: FLICK.by * 2 });
    await expect.poll(() => contentScrolled(dialog)).toBeCloseTo(0, 0);
    expect(await sheetTop(dialog)).toBeCloseTo(rest, 0);
    await finger.pull(middle(page), NEAR_PULL);
    await page.waitForTimeout(HELD);
    expect(await sheetTop(dialog)).toBeGreaterThan(rest + NEAR_PULL / 2);
    await finger.letGo();
    await expect.poll(() => sheetTop(dialog)).toBeCloseTo(rest, 0);
  });

  test('the dimming behind it goes as it does', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      dim = () => dialog.evaluate(node => Number(getComputedStyle(node, '::backdrop').opacity)),
      finger = await fingerOn(page);
    expect(await dim()).toBe(1);
    await finger.pull(await centre(dialog.locator('.sheet > header h2')), FAR_PULL);
    await page.waitForTimeout(HELD);
    const shown = await dialog.evaluate(node => node.scrollTop / node.clientHeight);
    expect(shown).toBeLessThan(1 - FAR_PULL / 2 / (page.viewportSize()?.height ?? 1));
    expect(await dim()).toBeCloseTo(shown, 1);
    await finger.letGo();
  });

  test('a pull begun with its content scrolled only scrolls it, however far it goes', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await sheetTop(dialog),
      finger = await fingerOn(page);
    await scrolled(dialog);
    await finger.pull(middle(page), 2 * NEAR_PULL);
    await page.waitForTimeout(HELD);
    expect(await sheetTop(dialog)).toBeCloseTo(rest, 0);
    expect(await contentScrolled(dialog)).toBeCloseTo(0, 0);
    await finger.letGo();
    await expect(dialog).toBeVisible();
  });

  // Where its title bar stands: at the top of the sheet, however far its content has scrolled.
  const barTop = (dialog: Locator) =>
    dialog.locator('.sheet > header').evaluate(node => node.getBoundingClientRect().top);

  test('scrolled, a pull from its title bar draws the whole sheet down, its content held, and it comes back from near', async ({
    card,
    page,
  }) => {
    const dialog = await opened(card, 'humidity'),
      finger = await fingerOn(page);
    await scrolled(dialog);
    const rest = await barTop(dialog);
    await finger.pull(await centre(dialog.locator('.sheet > header h2')), NEAR_PULL);
    await page.waitForTimeout(HELD);
    const held = await barTop(dialog);
    expect(held).toBeGreaterThan(rest + NEAR_PULL / 2);
    expect(held).toBeLessThanOrEqual(rest + NEAR_PULL + WHOLE_PIXELS);
    expect(await contentScrolled(dialog)).toBeCloseTo(SCROLLED_BY, 0);
    await finger.letGo();
    await expect.poll(() => barTop(dialog)).toBeCloseTo(rest, 0);
    expect(await contentScrolled(dialog)).toBeCloseTo(SCROLLED_BY, 0);
    await expect(dialog).toBeVisible();
  });

  test('scrolled, pulled far from its title bar and held, it goes once let go', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      finger = await fingerOn(page);
    await scrolled(dialog);
    await finger.pull(await centre(dialog.locator('.sheet > header h2')), FAR_PULL);
    await page.waitForTimeout(HELD);
    await expect(dialog).toBeVisible();
    await finger.letGo();
    await expect(dialog).toBeHidden();
  });

  test('pushed up from its place it scrolls its content, and the sheet stays where it is', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      title = dialog.locator('.sheet > header'),
      rest = await title.evaluate(node => node.getBoundingClientRect().top),
      finger = await fingerOn(page);
    await finger.pull(middle(page), -NEAR_PULL);
    await page.waitForTimeout(HELD);
    expect(await contentScrolled(dialog)).toBeGreaterThan(NEAR_PULL / 2);
    expect(await title.evaluate(node => node.getBoundingClientRect().top)).toBeCloseTo(rest, 0);
    await finger.letGo();
  });

  test('a pull that starts on a chart at once moves the sheet and leaves no reading behind', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await sheetTop(dialog),
      readings = dialog.locator('.chart[data-scrubbing], .chart[data-kept]'),
      finger = await fingerOn(page);
    await finger.pull(await centre(dialog.locator(`${TODAY} .chart-plot`).first()), NEAR_PULL);
    await page.waitForTimeout(HELD);
    expect(await sheetTop(dialog)).toBeGreaterThan(rest + NEAR_PULL / 2);
    await expect(readings).toHaveCount(0);
    await finger.letGo();
    await expect.poll(() => sheetTop(dialog)).toBeCloseTo(rest, 0);
    await expect(readings).toHaveCount(0);
  });

  // Along a chart a finger drifts down a little as it goes; straight down it reads the same place.
  for (const [how, by] of [
    ['along it', { x: 120, y: 40 }],
    ['straight down', { x: 0, y: NEAR_PULL }],
  ] as const)
    test(`a finger held on a chart long enough to read it keeps the reading as it moves ${how}, and the sheet stays where it is`, async ({
      card,
      page,
    }) => {
      const dialog = await opened(card, 'humidity'),
        rest = await sheetTop(dialog),
        reading = dialog.locator('.chart[data-scrubbing]').first(),
        finger = await fingerOn(page),
        from = await centre(dialog.locator(`${TODAY} .chart-plot`).first());
      let first: string | null = null;
      await finger.slide({ x: from.x - by.x / 2, y: from.y }, by, async () => {
        await expect(reading).toBeAttached();
        first = await reading.getAttribute('data-at');
      });
      await page.waitForTimeout(HELD);
      await expect(reading).toBeAttached();
      if (by.x) expect(await reading.getAttribute('data-at')).not.toBe(first);
      expect(await sheetTop(dialog)).toBeCloseTo(rest, 0);
      await finger.letGo();
      await expect(dialog.locator('.chart[data-scrubbing], .chart[data-kept]')).toHaveCount(0);
      expect(await sheetTop(dialog)).toBeCloseTo(rest, 0);
    });

  test('a swipe across a day’s charts turns the day, and the sheet stays where it is', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await sheetTop(dialog),
      strip = dialog.locator('.chart-pages'),
      finger = await fingerOn(page);
    const shown = () => strip.evaluate(pages => pages.scrollLeft / pages.clientWidth);
    const from = await shown();
    await finger.swipe(await centre(dialog.locator(`${TODAY} .chart-plot`).first()), -NEAR_PULL);
    await expect.poll(shown).toBe(from + 1);
    await expect(dialog.locator('.detail-days button').nth(from + 1)).toHaveAttribute('aria-pressed', 'true');
    expect(await sheetTop(dialog)).toBeCloseTo(rest, 0);
    await expect(dialog).toBeVisible();
  });

  test('a swipe across the days scrolls them, and the sheet stays where it is', async ({ card, page }) => {
    const dialog = await opened(card, 'humidity'),
      rest = await sheetTop(dialog),
      strip = dialog.locator('.detail-days'),
      finger = await fingerOn(page);
    const from = await strip.evaluate(node => node.scrollLeft);
    await finger.swipe(await centre(strip), -NEAR_PULL);
    await expect.poll(() => strip.evaluate(node => node.scrollLeft)).toBeGreaterThan(from);
    expect(await sheetTop(dialog)).toBeCloseTo(rest, 0);
  });
});
