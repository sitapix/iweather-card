import { expect, MAP, test } from './card.ts';

// What only the built file shows: the sources, which `pnpm test` runs, are never bundled. Every
// test here and elsewhere also proves the file and what stands beside it are all it needs, as a
// request for anything beyond them fails the test.

// A rainy sky has over 2000 colours in every engine, and some 500 without its clouds.
const CLOUDY_SKY = 1000;
// Long enough for the forecast to answer, and for all it sets off to be asked for.
const SETTLED = 1000;

test('has its styles from the moment it joins the page', async ({ card }) => {
  const zoom = await card.evaluate(host => {
    const fresh = document.createElement('iweather-card');
    fresh.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
    host.after(fresh);
    const value = getComputedStyle(fresh).getPropertyValue('--zoom');
    fresh.remove();
    return value;
  });
  expect(zoom).not.toBe('');
});

test('draws the weather it is given', async ({ card }) => {
  await expect(card).toContainText('Chicago');
  await expect(card).toContainText('58°');
  await expect(card.getByRole('button', { name: /^Humidity 80%/ })).toBeVisible();
});

test('fills what the entity leaves out, and credits where it came from', async ({ card }) => {
  await expect(card.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toBeVisible();
  await card.locator('.modes [data-mode=wind]').click();
  await expect(card.locator('.measure')).toContainText('Gusts');
});

test('the panels keep their glass', async ({ card }) => {
  const filter = await card
    .locator('.tile')
    .first()
    .evaluate(tile => getComputedStyle(tile, '::before').backdropFilter);
  expect(filter).toContain('blur');
});

test('keeps full-weight text when the page turns font smoothing off', async ({ card, page, browserName }) => {
  test.skip(browserName === 'firefox' && process.platform !== 'darwin', 'Firefox has this on a Mac alone.');
  await page.addStyleTag({
    content: 'body{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
  });
  const smoothing = await card
    .locator('.tile')
    .first()
    .evaluate(tile => {
      const style = getComputedStyle(tile);
      return [style.getPropertyValue('-webkit-font-smoothing'), style.getPropertyValue('-moz-osx-font-smoothing')];
    });
  expect(smoothing.filter(Boolean).every(value => value === 'auto')).toBe(true);
  expect(smoothing.filter(Boolean).length).toBeGreaterThan(0);
});

test('paints the sky, clouds and all', async ({ card }) => {
  await expect
    .poll(() =>
      card.locator('canvas.sky').evaluate(sky => {
        const copy = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        if (!copy || !(sky instanceof HTMLCanvasElement) || !sky.width) return 0;
        copy.drawImage(sky, 0, 0);
        const { data } = copy.getImageData(0, 0, copy.canvas.width, copy.canvas.height);
        return new Set(new Uint32Array(data.buffer)).size;
      }),
    )
    .toBeGreaterThan(CLOUDY_SKY);
});

test.describe('with motion on', () => {
  test.use({ config: { weather_animation: true } });

  test('the sky keeps moving', async ({ card }) => {
    const frame = () =>
      card.locator('canvas.sky').evaluate(sky => (sky instanceof HTMLCanvasElement ? sky.toDataURL() : ''));
    const first = await frame();
    await expect.poll(frame).not.toBe(first);
  });
});

test.describe('with radar motion on', () => {
  test.use({ config: { ...MAP, weather_animation: true, weather_scene: false } });

  test('the unopened precipitation map plays by default and honors its toggle and reduced motion', async ({
    card,
    page,
  }) => {
    const map = card.locator('.tile[data-tile=map] .radar'),
      frames = map.locator('canvas.radar-layer.frame'),
      shown = () => map.locator('canvas[data-on]').getAttribute('data-frame');
    await expect(frames).toHaveCount(10);
    const first = await shown();
    await expect.poll(shown).not.toBe(first);
    await expect(card.locator('dialog[open]')).toHaveCount(0);
    await expect(map.locator('.wind-time')).toHaveCount(0);

    await page.evaluate(() => {
      const host = document.querySelector('iweather-card');
      host?.setConfig({ ...host.config, map_precipitation_animation: false });
    });
    await expect(frames).toHaveCount(1);
    await expect(map.locator('canvas[data-on]')).toHaveAttribute('data-frame', '9');
    await page.waitForTimeout(SETTLED);
    await expect(map.locator('canvas[data-on]')).toHaveAttribute('data-frame', '9');

    await page.evaluate(() => {
      const host = document.querySelector('iweather-card');
      host?.setConfig({ ...host.config, map_precipitation_animation: true });
    });
    await expect(frames).toHaveCount(10);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(frames).toHaveCount(1);
    await expect(map.locator('canvas[data-on]')).toHaveAttribute('data-frame', '9');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(frames).toHaveCount(10);
    await expect.poll(shown).not.toBe('9');
  });
});

test('the wind dial stands its letters at its four edges', async ({ card }) => {
  const dial = card.locator('.tile[data-tile=wind] svg.dial');
  const seen = await dial.evaluate(element => {
    const whole = element.getBoundingClientRect(),
      letters = [...element.querySelectorAll('[data-at]')].flatMap(letter => {
        const box = letter.getBoundingClientRect();
        return box.width > 0
          ? [{ at: letter.getAttribute('data-at'), x: box.x + box.width / 2, y: box.y + box.height / 2 }]
          : [];
      });
    return { middle: { x: whole.x + whole.width / 2, y: whole.y + whole.height / 2 }, reach: whole.width / 2, letters };
  });
  const offset = (at: string) => {
    const letter = seen.letters.find(each => each.at === at);
    return { x: (letter?.x ?? 0) - seen.middle.x, y: (letter?.y ?? 0) - seen.middle.y };
  };
  const NEAR_THE_EDGE = seen.reach / 2;
  expect(seen.letters).toHaveLength(4);
  expect(offset('N').y).toBeLessThan(-NEAR_THE_EDGE);
  expect(offset('S').y).toBeGreaterThan(NEAR_THE_EDGE);
  expect(offset('E').x).toBeGreaterThan(NEAR_THE_EDGE);
  expect(offset('W').x).toBeLessThan(-NEAR_THE_EDGE);
});

test('stands beside everything it asks for, however it is served', async ({ card, page }) => {
  await expect(card).toBeAttached();
  const files = await page.evaluate(async () => {
    const file = document.querySelector('script')?.src ?? '',
      code = await (await fetch(file)).text(),
      named = new Set(code.match(/iweather-[\w.-]+\.(?:avif|json|js|css)\b/gu));
    return Promise.all([...named].map(async name => ({ name, ok: (await fetch(new URL(name, file))).ok })));
  });
  expect(files.length).toBeGreaterThan(5);
  expect(files.filter(({ ok }) => !ok)).toEqual([]);
});

test('its map library loads from beside it, and finds its worker there', async ({ card, page }) => {
  await expect(card).toBeAttached();
  const loaded = await page.evaluate(async () => {
    const file = document.querySelector('script')?.src ?? '',
      code = await (await fetch(file)).text(),
      [script] = /iweather-maplibre-\d[\w.]*\.js/u.exec(code) ?? [],
      module: unknown = await import(new URL(script ?? '', file).href),
      library = await (await fetch(new URL(script ?? '', file))).text(),
      [worker] = /iweather-maplibre-worker-[\w.]+\.js/u.exec(library) ?? [];
    return {
      map: typeof module === 'object' && module !== null && 'Map' in module,
      worker: worker ? (await fetch(new URL(worker, file))).ok : false,
      mapFile: library.includes('sourceMappingURL'),
    };
  });
  expect(loaded).toEqual({ map: true, worker: true, mapFile: false });
});

test('says which build it is', async ({ card, spoken }) => {
  await expect(card).toBeAttached();
  expect(spoken).toHaveLength(1);
  expect(spoken[0]).toMatch(/^iWeather \d+\.\d+\.\d+/u);
});

test('tells the card picker of itself', async ({ card, page }) => {
  await expect(card).toBeAttached();
  const listed = await page.evaluate(() => window.customCards?.map(entry => entry.type));
  expect(listed).toContain('iweather-card');
});

test('carries its editor', async ({ card, page }) => {
  await expect(card).toBeAttached();
  const drawn = await page.evaluate(async () => {
    const hasEditor = (value: unknown): value is { getConfigElement(): Promise<HTMLElement> } =>
        typeof value === 'function' && 'getConfigElement' in value,
      Card = customElements.get('iweather-card');
    if (!hasEditor(Card)) return null;
    const editor = await Card.getConfigElement();
    document.body.append(editor);
    return editor.shadowRoot !== null;
  });
  expect(drawn).toBe(true);
});

test.describe('with no air quality sensor and no forecast filled in', () => {
  test.use({ config: { open_meteo_forecast: false } });
  test('shows the air quality filled in for the place, and credits where it came from', async ({ card, asked }) => {
    const tile = card.locator('.tile[data-tile=air_quality]');
    await expect(tile).toContainText('58');
    await expect(tile).toContainText('Moderate');
    expect(asked).toContain('air-quality-api.open-meteo.com');
    await expect(card.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toBeVisible();
  });
});

test.describe('local only, with every setting that reaches out', () => {
  test.use({ config: { local_only: true, map: 'rainviewer', averages: 'open-meteo' } });
  test('asks nothing beyond Home Assistant, and shows no map without tiles', async ({ card, asked, page }) => {
    await page.waitForTimeout(SETTLED);
    expect(asked).toEqual([]);
    await expect(card.locator('.tile[data-tile=map]')).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toHaveCount(0);
  });
});

test.describe('local only, on tiles of the user’s own', () => {
  test.use({ config: { ...MAP, local_only: true } });
  test('asks for those tiles and nothing else, with the map open too', async ({ card, asked, page }) => {
    await card.locator('.tile[data-tile=map]').click();
    await expect(card.locator('.radar.large')).toBeVisible();
    await page.waitForTimeout(SETTLED);
    expect(new Set(asked)).toEqual(new Set(['tiles.test']));
  });
});

test.describe('on a map', () => {
  test.use({ config: MAP });
  test('the ground follows the screen’s colour scheme as it changes, with the page open', async ({ card, page }) => {
    const map = card.locator('.tile[data-tile=map] .radar');
    await expect(map).not.toHaveAttribute('data-night');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(map).toHaveAttribute('data-night');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(map).not.toHaveAttribute('data-night');
  });
});
