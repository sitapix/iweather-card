import { expect, test, TODAY } from './card.ts';

for (const [tile, chart, count] of [
  ['feels_like', 'feels_like', 12],
  ['visibility', 'visibility', 12],
  ['humidity', 'humidity', 4],
  ['pressure', 'pressure', 12],
  ['uv', 'uv', 12],
] as const) {
  test(`${tile} chart top rows follow the day, with past labels dim and future labels bright`, async ({ card }) => {
    await card.locator(`.tile[data-tile="${tile}"]`).click();
    const sheet = card.getByRole('dialog'),
      today = sheet.locator(`${TODAY} [data-chart="${chart}"] .chart-top`);
    await expect(today.locator('span')).toHaveCount(count);
    await expect(today.locator('[data-past]')).toHaveCount(count / 2);
    await expect(today.locator('span').first()).toHaveCSS('opacity', '0.35');
    await expect(today.locator('span').last()).toHaveCSS('opacity', '1');
    if (tile === 'feels_like') {
      await expect(today.locator('svg')).toHaveCount(count);
      await sheet.locator('[data-variant="temperature"]').click();
      await expect(sheet.locator(`${TODAY} [data-chart="temperature"] .chart-top svg`)).toHaveCount(count);
      await sheet.locator('[data-variant="feels_like"]').click();
    } else if (tile === 'humidity') await expect(today.locator('span').last()).toHaveText('80%');
    else if (tile === 'uv') {
      await expect(today.locator('span')).toHaveText(Array.from({ length: count }, () => '3'));
      await expect(today.locator('svg')).toHaveCount(0);
    } else if (tile === 'pressure') await expect(today.locator('svg')).toHaveCount(count);
    else await expect(today.locator('span').last()).toHaveText(/^\d+(\.\d+)?$/);
    await sheet.locator('.detail-days [data-day="2026-10-28"]').click();
    const tomorrow = sheet.locator(`.chart-page[data-day="2026-10-28"] [data-chart="${chart}"] .chart-top`);
    await expect(tomorrow).toBeInViewport();
    await expect(tomorrow.locator('span')).toHaveCount(count);
    await expect(tomorrow.locator('[data-past]')).toHaveCount(0);
    // The row stays over the plot and within its width, including on the phone.
    const bounds = await tomorrow.evaluate(row => {
      const box = row.getBoundingClientRect();
      return [...row.children].every(child => {
        const label = child.getBoundingClientRect();
        return label.left >= box.left && label.right <= box.right && label.top >= box.top && label.bottom <= box.bottom;
      });
    });
    expect(bounds).toBe(true);
    await sheet.locator('.detail-days [data-day="2026-10-26"]').click();
    const yesterday = sheet.locator(`.chart-page[data-day="2026-10-26"] [data-chart="${chart}"] .chart-top`);
    await expect(yesterday.locator('[data-past]')).toHaveCount(count);
  });
}

for (const entry of ['.forecast .forecast-header', '.daily .day[data-key="2026-10-27"]']) {
  test(`Conditions has weather icons when opened from ${entry}`, async ({ card }) => {
    await card.locator('.modes [data-mode=conditions]').click();
    await card.locator(entry).click();
    const sheet = card.getByRole('dialog');
    await expect(sheet).toHaveAttribute('data-id', 'conditions');
    await expect(sheet.locator(`${TODAY} [data-chart=temperature] .chart-top svg`)).toHaveCount(12);
    await expect(sheet.locator(`${TODAY} [data-chart=temperature] .chart-extreme`)).toHaveText(['L', 'H']);
    await sheet.locator('[data-variant=feels_like]').click();
    await expect(sheet.locator(`${TODAY} [data-chart=feels_like] .chart-top svg`)).toHaveCount(12);
    // This fixture's apparent temperature is constant, so it has no separate extremes.
    await expect(sheet.locator(`${TODAY} [data-chart=feels_like] .chart-extreme`)).toHaveCount(0);
  });
}

// Runs in the page. How far the top rows of a picture stand from what lies under them, at each
// share of its width.
function frameContrast({ png, shares }: { png: string; shares: readonly number[] }): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas');
      context.drawImage(image, 0, 0);
      const red = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[0] ?? 0;
      resolve(
        shares.map(share => {
          const x = Math.round(image.width * share),
            ground = red(x, 8);
          return Math.max(...[0, 1, 2, 3].map(y => Math.abs(red(x, y) - ground)));
        }),
      );
    };
    image.onerror = () => reject(new Error('No image'));
    image.src = `data:image/png;base64,${png}`;
  });
}

// Runs in the page. How many of a picture's pixels are strongly yellow, and how many strongly green.
function yellowAndGreen(png: string): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height),
        count: [number, number] = [0, 0];
      for (let i = 0; i < data.length; i += 4) {
        const [red = 0, green = 0, blue = 0] = data.subarray(i, i + 3);
        if (red > 200 && green > 170 && blue < 80) count[0] += 1;
        if (red < 90 && green > 170 && blue < 130) count[1] += 1;
      }
      resolve(count);
    };
    image.onerror = () => reject(new Error('No image'));
    image.src = `data:image/png;base64,${png}`;
  });
}

// WebKit misplaces a gradient on a stroke that keeps its width under a zoom, which the card's zoom
// makes every line in one colour: the gradient's first.
test('a line takes its colour from where it stands on the scale', async ({ card, page }) => {
  await card.evaluate(host => {
    const style = document.createElement('style');
    style.textContent = '.detail .sheet-glass{background:#000!important;backdrop-filter:none!important}';
    host.shadowRoot?.append(style);
  });
  await card.getByRole('button', { name: /^UV index/ }).click();
  await page.waitForTimeout(400);
  const png = (await card.getByRole('dialog').locator(`${TODAY} .chart-plot`).screenshot()).toString('base64'),
    [yellow, green] = await page.evaluate(yellowAndGreen, png);
  // A UV index of 3 is the scale's yellow, and nothing here is as low as its green.
  expect(yellow).toBeGreaterThan(100);
  expect(green).toBe(0);
});

// The fading of the past is one mask over a drawing and its labels, which each engine does its own way.
test('everything before now is fainter, down to the frame, with a hard edge at now', async ({ card, page }) => {
  await card.evaluate(host => {
    const style = document.createElement('style');
    style.textContent =
      '.detail,.detail .sheet{background:#000!important;backdrop-filter:none!important}.detail .sheet:before,.detail .sheet:after{display:none!important}';
    host.shadowRoot?.append(style);
  });
  await card.locator('.tile[data-tile="wind"]').click();
  const chart = card.getByRole('dialog').locator(`${TODAY} .chart`).first();
  await expect(chart).toHaveAttribute('style', /--now-x:52\.1%/);
  // Past the sheet's opening, which scales it.
  await page.waitForTimeout(400);
  const png = (await chart.locator('.chart-face').screenshot()).toString('base64'),
    [early = 0, justBefore = 0, justAfter = 0, late = 0] = await page.evaluate(frameContrast, {
      png,
      shares: [0.2, 0.51, 0.535, 0.8],
    });
  expect(late).toBeGreaterThan(0);
  // .35 of the frame's own contrast, give or take the rounding of so faint a line.
  expect(early / late).toBeGreaterThan(0.2);
  expect(early / late).toBeLessThan(0.5);
  // The same either side, right up to the edge, to within a level or so of rounding.
  expect(Math.abs(justBefore - early)).toBeLessThanOrEqual(2);
  expect(Math.abs(justAfter - late)).toBeLessThanOrEqual(2);
});
