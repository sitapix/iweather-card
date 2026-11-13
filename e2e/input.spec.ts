import type { Locator, Page } from '@playwright/test';
import { expect, landed, MAP, test, TODAY } from './card.ts';

// What only real input shows. Events a test dispatches skip the browser's own part: the focus a
// press moves, pointer capture, the click a press and a release make between them, and Escape
// closing a dialog.
const PAST_HOLD = 1200;
const UV = /^UV index/;
// A day far enough on that a slide to it takes a while.
const FAR_DAY = 7;
// Half a tile above a tile, as a share of its height.
const ABOVE = -0.5;

// A point on a part of the card, as fractions of its box.
async function spot(part: Locator, across = 0.5, down = 0.5) {
  const box = await part.boundingBox();
  if (!box) throw new Error('Not on screen.');
  return { x: box.x + box.width * across, y: box.y + box.height * down };
}
// Presses at one spot and moves to another, still held.
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

test('the first Tab from the dashboard shows the focus ring inside the card', async ({ card, page }) => {
  await card.evaluate(node => {
    const entry = document.createElement('button');
    node.before(entry);
    entry.focus();
  });
  await page.keyboard.press('Tab');
  const focused = card.locator(':focus-visible').first();
  await expect(focused).toBeFocused();
  await expect(focused).toHaveCSS('outline-style', 'solid');
});

test('a clicked tile opens, Escape closes it, and the focus comes back to the tile', async ({ card, page }) => {
  const uv = card.getByRole('button', { name: UV }),
    sheet = card.getByRole('dialog');
  await uv.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(uv).toBeFocused();
});

for (const key of ['Enter', 'Space']) {
  test(`${key} opens the tile that has the focus, without scrolling the page`, async ({ card, page }) => {
    await card.getByRole('button', { name: UV }).focus();
    const scrolled = await page.evaluate(() => scrollY);
    await page.keyboard.press(key);
    await expect(card.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(scrolled);
  });
}

test('with a mouse a sheet’s unit is the system’s own menu, laid over the unit it shows', async ({ card, page }) => {
  await card.locator('.tile[data-tile=pressure]').click();
  const sheet = card.getByRole('dialog'),
    unit = sheet.getByRole('combobox', { name: 'Unit' });
  await expect(unit).toHaveValue('inHg');
  await expect(sheet.getByRole('button', { name: /^Unit/ })).toHaveCount(0);
  // The click on the unit lands on it.
  await unit.scrollIntoViewIfNeeded();
  await unit.click();
  await unit.selectOption({ label: 'Millibars (mbar)' });
  await expect(unit).toHaveValue('mbar');
  await expect(sheet.locator('.sheet-option .option-value>span')).toHaveText('mbar');
  await expect(sheet.locator('.detail-summary').first()).toContainText('mbar');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('a tile held opens without being let go, and letting go leaves it open', async ({ card, page }) => {
  const sheet = card.getByRole('dialog');
  await card.getByRole('button', { name: UV }).hover();
  await page.mouse.down();
  await expect(sheet).toBeVisible();
  await page.mouse.up();
  await expect(sheet).toBeVisible();
});

test('a row clicked holds its list still, and opens the sheet of the view showing on its own day', async ({
  card,
  page,
}) => {
  await card.locator('.modes [data-mode=wind]').click();
  const row = card.locator('.daily .day').nth(3),
    key = await row.getAttribute('data-key'),
    sheet = card.getByRole('dialog'),
    // Read two frames on, by when a press would have begun to shrink it.
    scale = () =>
      card.locator('.daily').evaluate(async list => {
        for (let frame = 0; frame < 2; frame++) await new Promise(done => requestAnimationFrame(done));
        return new DOMMatrix(getComputedStyle(list).transform).a;
      });
  await row.hover();
  await page.mouse.down();
  expect(await scale()).toBe(1);
  await page.mouse.up();
  await expect(sheet).toHaveAttribute('data-id', 'wind');
  await expect(sheet.locator(`.detail-days [data-day="${key ?? ''}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(row).toBeFocused();
});

test('a pressed row takes the light of its place in the list, and only while pressed', async ({ card, page }) => {
  const rows = card.locator('.daily .day'),
    press = (row: Locator) => row.locator('.day-press > svg'),
    corners = (row: Locator) => press(row).evaluate(light => getComputedStyle(light).borderRadius),
    count = await rows.count(),
    last = rows.nth(count - 1);
  await expect(press(rows.first())).toBeHidden();
  for (const [row, flat] of [
    [rows.first(), /px 0px 0px$/],
    [rows.nth(4), /^0px$/],
    [last, /^0px 0px /],
  ] as const) {
    await row.hover();
    await page.mouse.down();
    await expect(press(row)).toBeVisible();
    expect(await corners(row)).toMatch(flat);
    await expect(row).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
    // Move off it, or letting go opens its sheet.
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await expect(press(row)).toBeHidden();
    expect(await page.evaluate(() => (getSelection()?.toString() ?? '').trim())).toBe('');
  }
});

// Still, so the list doesn't shrink under the measuring.
test('a pressed row keeps its list’s columns, held and let go', async ({ card, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const row = card.locator('.daily .day').nth(2),
    columns = () =>
      row
        .locator(':scope > :not(.day-press)')
        .evaluateAll(parts => parts.map(part => [part.getBoundingClientRect().x, part.getBoundingClientRect().width])),
    before = await columns();
  await row.hover();
  await page.mouse.down();
  expect(await columns()).toEqual(before);
  await expect(row.locator('.day-press > svg')).toBeVisible();
  expect(await columns()).toEqual(before);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  expect(await columns()).toEqual(before);
});

for (const key of ['Enter', 'Space']) {
  test(`${key} opens the row that has the focus, in the view showing`, async ({ card, page }) => {
    await card.locator('.modes [data-mode=wind]').click();
    await card.locator('.daily .day').nth(2).focus();
    await page.keyboard.press(key);
    await expect(card.getByRole('dialog')).toHaveAttribute('data-id', 'wind');
  });
}

// A mouse keeps a tile pressed for as long as its button is down, wherever the pointer goes. Off
// it means above it, clear of the screen's edge, which would scroll the page under the pointer.
test('a mouse held off its tile keeps it pressed, and opens nothing, held or let go', async ({ card, page }) => {
  const uv = card.getByRole('button', { name: UV }),
    sheet = card.getByRole('dialog'),
    scale = () => uv.evaluate(tile => new DOMMatrix(getComputedStyle(tile).transform).a);
  await uv.scrollIntoViewIfNeeded();
  await dragTo(page, await spot(uv), await spot(uv, 0.5, ABOVE));
  await page.waitForTimeout(PAST_HOLD);
  expect(await scale()).toBeLessThan(1);
  await expect(sheet).toBeHidden();
  await page.mouse.up();
  await expect(sheet).toBeHidden();
  await expect.poll(scale).toBe(1);
});

test('a mouse held past the hold opens the tile as it comes back over it', async ({ card, page }) => {
  const uv = card.getByRole('button', { name: UV }),
    sheet = card.getByRole('dialog');
  await uv.scrollIntoViewIfNeeded();
  const middle = await spot(uv);
  await dragTo(page, middle, await spot(uv, 0.5, ABOVE));
  await page.waitForTimeout(PAST_HOLD);
  await expect(sheet).toBeHidden();
  await page.mouse.move(middle.x, middle.y, { steps: 8 });
  await expect(sheet).toBeVisible();
  await page.mouse.up();
  await expect(sheet).toBeVisible();
});

for (const fallback of [false, true]) {
  test(`a backdrop press closes the sheet but dragging out does not (${fallback ? 'fallback' : 'browser default'})`, async ({
    card,
    page,
  }) => {
    if (fallback) await page.evaluate(() => Reflect.deleteProperty(HTMLDialogElement.prototype, 'closedBy'));
    await card.getByRole('button', { name: UV }).click();
    const sheet = card.getByRole('dialog');
    await expect(sheet).toBeVisible();
    if (fallback) await expect(sheet).not.toHaveAttribute('closedby');
    await dragTo(page, await spot(sheet.getByRole('heading').first()), { x: 2, y: 2 });
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(sheet).toBeHidden();
  });
}

test("a chart's reading follows the mouse and stays where a press leaves it", async ({ card, page }) => {
  await card.getByRole('button', { name: UV }).click();
  const sheet = card.getByRole('dialog'),
    chart = sheet.locator(`${TODAY} .chart`).first(),
    plot = chart.locator('.chart-plot');
  await plot.hover({ position: { x: 40, y: 20 } });
  await expect(chart).toHaveAttribute('data-scrubbing', '');
  const hovered = await chart.getAttribute('data-at');

  await page.mouse.down();
  const { x, y } = await spot(plot, 0.75);
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await expect(chart).not.toHaveAttribute('data-at', hovered ?? '');
  await expect(chart).toHaveAttribute('data-kept', '');

  await page.mouse.move(2, 2);
  await expect(chart).toHaveAttribute('data-kept', '');
  await sheet.getByRole('heading').first().click();
  await expect(chart).not.toHaveAttribute('data-kept', '');
});

test('the conditions sheet reads its temperature and its chance each alone', async ({ card }) => {
  await card.locator('.tile[data-tile="feels_like"]').click();
  const sheet = card.getByRole('dialog'),
    chart = sheet.locator(`${TODAY} .chart[data-chart=feels_like]`),
    chance = sheet.locator(`${TODAY} .chart[data-chart=chance]`);
  // A new forecast draws the sheet again, which puts a reading away, so it comes first.
  await expect(chart).toHaveAttribute('data-line', /"reads":\[\[/);
  // Opening positions today's page; hovering while it is still scrolling loses
  // the reading as soon as that scroll arrives.
  await expect
    .poll(() => sheet.locator('.chart-pages').evaluate(pages => pages.scrollLeft / pages.clientWidth))
    .toBe(1);
  await chart.locator('.chart-plot').hover({ position: { x: 200, y: 40 } });
  await expect(chart).toHaveAttribute('data-scrubbing', '');
  await expect(chance).not.toHaveAttribute('data-scrubbing', '');
  await expect(chance.locator('.chart-cursor')).toHaveCount(0);
  await chance.locator('.chart-plot').hover({ position: { x: 200, y: 40 } });
  await expect(chance).toHaveAttribute('data-scrubbing', '');
  await expect(chart).not.toHaveAttribute('data-scrubbing', '');
  await expect(chart.locator('.chart-cursor')).toHaveCount(0);
  await expect(sheet.locator('.chance-reading .detail-time')).toHaveText(/^\d{1,2}:00\s?[AP]M$/);
});

test('both of a sheet’s charts read the hour under the mouse, the chance only from now on, and leaving puts them away', async ({
  card,
  page,
}) => {
  await card.locator('.tile[data-tile="precipitation"]').click();
  const sheet = card.getByRole('dialog'),
    rain = sheet.locator(`${TODAY} .chart[data-chart=precipitation]`),
    chance = sheet.locator(`${TODAY} .chart[data-chart=chance]`);
  // A new forecast draws the sheet again, which puts a reading away, so it comes first: its hours
  // reach back to midnight.
  await expect(rain).toHaveAttribute('data-points', /^\[\[[\d.]+,-100,"12AM - 1AM/);
  await rain.locator('.chart-plot').hover({ position: { x: 200, y: 40 } });
  await expect(chance).toHaveAttribute('data-scrubbing', '');
  await expect(sheet.locator('.detail-reading .detail-time').first()).toHaveText(/^\d+[AP]M - \d+[AP]M$/);
  await expect(sheet.locator('.chance-reading .detail-time')).toHaveText(/^\d+[AP]M - \d+[AP]M$/);
  await page.mouse.move(2, 2);
  await expect(rain).not.toHaveAttribute('data-scrubbing', '');
  await expect(chance).not.toHaveAttribute('data-scrubbing', '');
  // Halfway to now, the hour is over: the rain reads it, and the chance, with nothing there, keeps
  // its heading.
  const plot = rain.locator('.chart-plot'),
    box = await plot.boundingBox(),
    now = await chance.evaluate(chart => parseFloat(chart.style.getPropertyValue('--now-x')));
  if (!box || !(now > 0)) throw new Error('No plot, or no past.');
  await plot.hover({ position: { x: (box.width * now) / 200, y: 40 } });
  await expect(rain).toHaveAttribute('data-scrubbing', '');
  await expect(chance).not.toHaveAttribute('data-scrubbing', '');
  await expect(sheet.locator('.chance-reading h4')).toHaveText('Chance of Precipitation');
});

test('the arrows, the days and a sideways scroll all turn the charts’ pages, and agree', async ({ card, page }) => {
  await card.getByRole('button', { name: UV }).click();
  const sheet = card.getByRole('dialog'),
    strip = sheet.locator('.chart-pages'),
    date = sheet.locator('.detail-date span');
  const left = () => strip.evaluate(pages => pages.scrollLeft / pages.clientWidth);
  await expect.poll(left).toBe(1);
  await sheet.getByRole('button', { name: 'Next day' }).click();
  await expect(date).toContainText('October 28');
  await expect.poll(left).toBe(2);
  await sheet.locator('.detail-days button').nth(4).click();
  await expect(date).toContainText('October 30');
  await expect.poll(left).toBe(4);
  // A mouse has no finger to swipe with, but a trackpad or a tilted wheel scrolls sideways.
  await strip.locator('.chart-page[data-day="2026-10-30"] .chart-plot').hover();
  await page.mouse.wheel(300, 0);
  await expect.poll(left).toBeGreaterThan(4);
  await expect.poll(async () => Number.isInteger(await left())).toBe(true);
  const turned = await left();
  await expect(sheet.locator('.detail-days button').nth(turned)).toHaveAttribute('aria-pressed', 'true');
});

test('a sideways scroll on the way to a day takes the slide over, and the pages settle on one', async ({
  card,
  page,
}) => {
  await card.getByRole('button', { name: UV }).click();
  const sheet = card.getByRole('dialog'),
    strip = sheet.locator('.chart-pages'),
    days = sheet.locator('.detail-days button');
  const left = () => strip.evaluate(pages => pages.scrollLeft / pages.clientWidth);
  await expect.poll(left).toBe(1);
  // Over a chart once the sheet has risen into place, or it rises out from under the mouse.
  await landed(sheet);
  await strip.locator(`${TODAY} .chart-plot`).hover();
  // Pressed from here, so the mouse stays over the charts.
  await days.nth(FAR_DAY).evaluate(day => {
    if (day instanceof HTMLElement) day.click();
  });
  // On its way, for the wheel to take over.
  await expect(strip).toHaveAttribute('data-sliding', '');
  await page.mouse.wheel(300, 0);
  await expect(strip).not.toHaveAttribute('data-sliding', '');
  // Firefox can acknowledge the wheel before its scroll settles. Read the page
  // and its selected day together instead of keeping a soon-stale index. A short
  // gesture can also settle back on the starting page, as it does in WebKit.
  await expect
    .poll(async () => {
      const turned = await left();
      return (
        Number.isInteger(turned) && turned < FAR_DAY && (await days.nth(turned).getAttribute('aria-pressed')) === 'true'
      );
    })
    .toBe(true);
});

test("dragging the forecast's switch picks the mode it is let go on", async ({ card, page }) => {
  const last = card.locator('.modes [data-mode]').last(),
    picked = card.locator('.modes [aria-pressed=true]');
  await expect(last).toHaveAttribute('aria-pressed', 'false');
  await dragTo(page, await spot(picked), await spot(last));
  await page.mouse.up();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(picked).toHaveCount(1);
});

test('a turn back past the strip’s start brings the labels in, and they go again', async ({ card, page }) => {
  await card.locator('.modes [data-mode=rain]').click();
  // The last view's picture fades out over the strip first (see crossFade).
  await expect(card.locator('.hours[inert]')).toHaveCount(0);
  const hours = card.locator('.hours');
  await expect(hours.locator('.strip-labels')).toBeAttached();
  const { x, y } = await spot(hours);
  await page.mouse.move(x, y);
  // They don't stay to be looked at, so the strip notes that they came all the way in.
  await hours.evaluate(strip => {
    const seen = new MutationObserver(() => {
      if (!(strip instanceof HTMLElement) || strip.style.getPropertyValue('--reveal') !== '1.000') return;
      seen.disconnect();
      strip.dataset['allIn'] = '';
    });
    seen.observe(strip, { attributes: true });
  });
  await page.mouse.wheel(-600, 0);
  await expect(hours).toHaveAttribute('data-all-in');
  await expect(hours).not.toHaveAttribute('data-pulled');
  await expect(hours).not.toHaveAttribute('data-settling');
  await expect(hours).toHaveJSProperty('scrollLeft', 0);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`the hourly arrows press their whole panel without opening its sheet (${reducedMotion})`, async ({
    card,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const panel = card.locator('.forecast'),
      hours = card.locator('.hours'),
      scale = () => panel.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).a);
    for (const edge of ['end', 'start']) {
      await panel.hover();
      const arrow = panel.locator(`.hours-arrow[data-edge=${edge}]`);
      await expect(arrow).toHaveAttribute('data-more');
      await arrow.hover();
      await page.mouse.down();
      if (reducedMotion === 'reduce') expect(await scale()).toBe(1);
      else await expect.poll(scale).toBeLessThan(1);
      // Holding a navigation arrow must not become a hold on the panel itself.
      await page.waitForTimeout(PAST_HOLD);
      await expect(card.getByRole('dialog')).toBeHidden();
      if (edge === 'end') await expect.poll(() => hours.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      else await expect(hours).toHaveJSProperty('scrollLeft', 0);
      await page.mouse.up();
      await expect.poll(scale).toBe(1);
      await expect(card.getByRole('dialog')).toBeHidden();
    }
    await panel.locator('.heading').click();
    await expect(card.getByRole('dialog')).toBeVisible();
  });
}

test('the switch still works with the hourly panel pinned, and pressing it opens nothing', async ({ card, page }) => {
  // A set height makes the page scroll in place, its hourly panel pinning under the band.
  await card.evaluate(node => {
    if (node instanceof HTMLElement) node.style.height = '640px';
  });
  await expect(card.locator('.weather[data-scroll=true]')).toBeAttached();
  const pinned = card.locator('.pinned-heading'),
    switched = card.locator('.modes [data-mode=wind]'),
    { x, y } = await spot(card.locator('.forecast'));
  await page.mouse.move(x, y);
  await expect(async () => {
    await page.mouse.wheel(0, 60);
    await expect(pinned).toHaveCSS('opacity', '1', { timeout: 200 });
  }).toPass();
  await switched.click();
  await expect(switched).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('dialog')).toBeHidden();
});

test.describe('the map', () => {
  test.use({ config: MAP });

  async function largeMap(card: Locator) {
    await expect(card.locator('.tile[data-tile=map] .radar [data-frame]').first()).toBeAttached();
    await card.locator('.tile[data-tile=map]').click();
    const view = card.locator('.radar.large');
    await expect(view.locator('.wind-time')).toBeVisible();
    return view;
  }

  test('follows a drag, and rests away from home', async ({ card, page }) => {
    const view = await largeMap(card),
      home = view.locator('[data-home]');
    await expect(home).toHaveAttribute('data-here', '');
    // Hovering waits for the map to finish growing, and this corner is clear of its pin and tools.
    await view.hover({ position: { x: 200, y: 200 } });
    await page.mouse.down();
    await page.mouse.move(300, 300, { steps: 8 });
    await expect(view).toHaveAttribute('data-dragging', '');
    await expect(view).toHaveCSS('cursor', 'default');
    await page.mouse.up();
    await expect(view).not.toHaveAttribute('data-dragging', '');
    await expect(home).not.toHaveAttribute('data-here', '');
  });

  test('a drag stops its timeline playing, where it is let go', async ({ card, page }) => {
    const view = await largeMap(card),
      track = view.locator('.wind-track');
    await view.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(view.getByRole('button', { name: 'Pause' })).toBeVisible();
    await dragTo(page, await spot(track, 0.9), await spot(track, 0.25));
    await page.mouse.up();
    await expect(view.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const last = Number(await track.getAttribute('aria-valuemax')),
      at = Number(await track.getAttribute('aria-valuenow'));
    expect(at).toBeGreaterThanOrEqual(Math.floor(last * 0.15));
    expect(at).toBeLessThanOrEqual(Math.ceil(last * 0.35));
  });
});

test.describe('a page scrolling in place on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(({ isMobile }) => isMobile, 'The phone has its own engine here: this one runs in all three.');
  const STEP = 16,
    STILL = 3;

  // Takes the tile from where it reaches the band until little more than its header is left, and
  // says where its title stood, and the foot of its glass, at each step.
  const passing = (card: Locator, tile: string) =>
    card.evaluate(
      async (host, { tile, step, still }) => {
        const root = host.shadowRoot,
          scroller = root?.querySelector('.weather-content'),
          panel = root?.querySelector(`.tile[data-tile=${tile}]`),
          header = panel?.querySelector('header');
        if (!scroller || !panel || !header) throw new Error('No tile.');
        const frame = () =>
            new Promise(done => {
              requestAnimationFrame(done);
            }),
          // A browser may tell of a scroll a frame or two late, so it's drawn once the title stays put.
          drawn = async () => {
            for (let held = 0, at = NaN; held < still; ) {
              await frame();
              const now = header.getBoundingClientRect().top;
              held = now === at ? held + 1 : 0;
              at = now;
            }
          };
        const go = async (top: number) => {
          scroller.scrollTo({ top, behavior: 'instant' });
          await drawn();
        };
        let top = 0;
        await go(top);
        while (!panel.hasAttribute('data-cut') && top < scroller.scrollHeight) {
          top += step;
          await go(top);
        }
        const steps = [];
        const { height } = panel.getBoundingClientRect();
        for (let at = step; at < height; at += step) {
          await go(top + at);
          steps.push({
            band: scroller.getBoundingClientRect().top,
            title: header.getBoundingClientRect().top,
            foot: header.getBoundingClientRect().bottom,
            glass: panel.querySelector(':scope > .glass')?.getBoundingClientRect().bottom ?? 0,
            shown: Number(getComputedStyle(header).opacity),
          });
        }
        return steps;
      },
      { tile, step: STEP, still: STILL },
    );

  for (const tile of ['moon', 'uv'])
    test(`the ${tile} tile’s title holds its place at the band, on its glass, all the way under`, async ({ card }) => {
      await card.evaluate(node => {
        if (node instanceof HTMLElement) node.style.height = '640px';
      });
      await expect(card.locator('.weather[data-scroll=true]')).toBeAttached();
      const steps = await passing(card, tile),
        [first] = steps;
      if (!first) throw new Error('It never reached the band.');
      expect(steps.length).toBeGreaterThan(2);
      for (const { title, foot, glass } of steps) {
        expect(Math.abs(title - first.title)).toBeLessThan(1);
        expect(foot).toBeLessThanOrEqual(glass);
      }
      // Once the glass is down to what the title keeps, it has as much room below it as above.
      const fading = steps.filter(({ shown }) => shown < 1);
      expect(fading.length).toBeGreaterThan(0);
      for (const { band, title, foot, glass } of fading)
        expect(Math.abs(title - band - (glass - foot))).toBeLessThan(1);
    });
});

test.describe('words too long for the room beside the switch', () => {
  test.use({ language: 'de', viewport: { width: 320, height: 700 } });
  test.skip(({ isMobile }) => isMobile, 'The phone has its own engine here: this one runs in all three.');

  // Where words end if nothing stops them, where whatever cuts them off ends, and where the switch begins.
  const room = (card: Locator, words: string) =>
    card.evaluate((host, words) => {
      const text = host.shadowRoot?.querySelector(words),
        start = host.shadowRoot?.querySelector('.modes')?.getBoundingClientRect().left;
      if (!text || start === undefined) throw new Error('Nothing to measure.');
      // Words drawn as a shape have a box of their own. A line of text has its box from its parent.
      const range = document.createRange();
      range.selectNodeContents(text);
      const { right } = (text instanceof SVGElement ? text : range).getBoundingClientRect();
      let cut = right;
      for (let at: Element | null = text; at; at = at.parentElement) {
        const { overflowX, maskImage } = getComputedStyle(at);
        if (overflowX !== 'visible' || maskImage !== 'none') cut = Math.min(cut, at.getBoundingClientRect().right);
      }
      return { right, cut, start };
    }, words);

  test('a subtitle stops short of the switch', async ({ card }) => {
    await card.locator('.modes [data-mode=rain]').click();
    await expect(card.locator('.modes [data-mode=rain]')).toHaveAttribute('aria-pressed', 'true');
    const { right, cut, start } = await room(card, '.measure > span');
    expect(right, 'these words must be too long for this to mean anything').toBeGreaterThan(start);
    expect(cut).toBeLessThanOrEqual(start);
  });

  const ends = (card: Locator, part: string) =>
    card.evaluate((host, part) => host.shadowRoot?.querySelector(part)?.getBoundingClientRect().right ?? NaN, part);

  test('the light under a subtitle ends where its words do', async ({ card }) => {
    const words = await ends(card, '.measure'),
      light = await ends(card, '.forecast-content > .lift');
    expect(Math.abs(words - light)).toBeLessThan(1);
  });

  test('the pinned heading stops short of the switch too', async ({ card }) => {
    await card.evaluate(node => {
      if (node instanceof HTMLElement) node.style.height = '640px';
    });
    await expect(card.locator('.weather[data-scroll=true]')).toBeAttached();
    const { right, cut, start } = await room(card, '.pinned-heading .title g text');
    expect(right, 'these words must be too long for this to mean anything').toBeGreaterThan(start);
    expect(cut).toBeLessThanOrEqual(start);
    const light = await ends(card, '.forecast-content > .lift + .lift');
    expect(Math.abs(light - (await ends(card, '.pinned-heading')))).toBeLessThan(1);
  });
});

test('keyboard chart selection announces the time and humidity and updates the visible reading', async ({
  card,
  page,
}) => {
  await card.locator('[data-tile=humidity]').click();
  const sheet = card.getByRole('dialog'),
    chart = sheet.locator(`${TODAY} .chart[data-chart=humidity]`),
    slider = chart.getByRole('slider', { name: 'Time' });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', /%/);
  const first = await slider.getAttribute('aria-valuetext');
  await page.keyboard.press('ArrowRight');
  await expect(slider).not.toHaveAttribute('aria-valuetext', first ?? '');
  await expect(chart).toHaveAttribute('data-scrubbing', '');
  await expect(sheet.locator('.detail-reading .detail-headline').first()).toContainText('%');
  await page.keyboard.press('End');
  await expect(slider).toHaveValue((await slider.getAttribute('max')) ?? '');
});
