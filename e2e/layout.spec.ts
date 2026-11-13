import { expect, test } from './card.ts';

// A preview or masonry card has a width but no parent height to inherit. Check the
// surface and its contents: a nonzero host alone can still hide an empty surface.
for (const layout of ['compact', 'strip', 'auto', 'expanded', 'page'] as const)
  test.describe(`${layout} without a dashboard height`, () => {
    test.use({ config: { local_only: true } });

    test('fits the preview width and honors an explicit height', async ({ card }) => {
      await card.evaluate((_, layout) => {
        const host = document.querySelector('iweather-card');
        if (!host) throw new Error('No card.');
        host.setConfig({ ...host.config, weather_layout: layout });
      }, layout);
      if (layout === 'compact' || layout === 'strip') {
        await expect(card.locator('.forecast')).toBeHidden();
        await expect(card.locator('.daily')).toBeHidden();
      } else await expect(card.locator('.hour').first()).toBeVisible();
      for (const width of [470, 320, 720]) {
        await card.evaluate((host, width) => {
          const pane = document.createElement('div');
          pane.style.width = `${width}px`;
          host.before(pane);
          pane.append(host);
        }, width);
        await expect
          .poll(() =>
            card.evaluate(host => {
              const bounds = host.getBoundingClientRect(),
                surface = host.shadowRoot?.querySelector('.weather')?.getBoundingClientRect(),
                brief = ['compact', 'strip'].includes(host.getAttribute('data-layout') ?? ''),
                selectors = brief ? ['.current'] : ['.current', '.forecast'];
              if (host.getAttribute('data-layout') === 'expanded' || host.getAttribute('data-layout') === 'page')
                selectors.push('.daily');
              return {
                surfaceFillsCard: surface !== undefined && Math.abs(surface.height - bounds.height) < 1,
                contentsFit: selectors.every(selector => {
                  const box = host.shadowRoot?.querySelector(selector)?.getBoundingClientRect();
                  return (
                    box !== undefined &&
                    box.width > 0 &&
                    box.height > 0 &&
                    box.left >= bounds.left - 1 &&
                    box.right <= bounds.right + 1 &&
                    box.top >= bounds.top - 1 &&
                    box.bottom <= bounds.bottom + 1
                  );
                }),
              };
            }),
          )
          .toEqual({ surfaceFillsCard: true, contentsFit: true });
      }
      await card.evaluate(host => host.style.setProperty('--iweather-height', '400px'));
      await expect
        .poll(() =>
          card.evaluate(host => {
            const surface = host.shadowRoot?.querySelector('.weather');
            return [host.getBoundingClientRect().height, surface?.getBoundingClientRect().height].every(
              height => height !== undefined && Math.abs(height - 400) < 1,
            );
          }),
        )
        .toBe(true);
    });
  });

// Compact stays a city tile, including in the short/wide sizes where Auto puts hours beside it.
test('compact keeps its four corners and context when resized or reconfigured', async ({ card }) => {
  await card.evaluate(() => {
    const host = document.querySelector('iweather-card');
    if (!host) throw new Error('No card.');
    host.setConfig({ ...host.config, weather_layout: 'compact', place_name: 'St. Louis' });
    host.addEventListener('hass-more-info', () => host.setAttribute('data-opened', 'true'));
  });
  await expect(card.locator('.location')).toHaveText('St. Louis');
  await expect(card.locator('.place-context')).toHaveText('My Location');
  await expect(card.locator('.place-home')).toHaveText('Home');
  await expect(card.locator('.range')).toContainText('H:64°');
  expect(await card.evaluate(host => host.getBoundingClientRect().height)).toBe(180);
  for (const [width, height] of [
    [320, 180],
    [504, 192],
    [720, 120],
    [240, 184],
    [470, 400],
  ] as const) {
    await card.evaluate(
      (host, size) => {
        host.style.width = `${size.width}px`;
        host.style.setProperty('--iweather-height', `${size.height}px`);
      },
      { width, height },
    );
    await expect(card.locator('.forecast')).toBeHidden();
    await expect(card.locator('.daily')).toBeHidden();
    await expect
      .poll(() =>
        card.evaluate(host => {
          const root = host.shadowRoot;
          if (!root) throw new Error('No root.');
          const box = (selector: string) => {
            const node = root.querySelector(selector);
            if (!node) throw new Error(`No ${selector}.`);
            return node.getBoundingClientRect();
          };
          const city = box('.location'),
            temperature = box('.temperature'),
            context = box('.compact-meta'),
            condition = box('.condition'),
            range = box('.range'),
            bounds = host.getBoundingClientRect();
          return (
            city.left < temperature.left &&
            city.right <= temperature.left &&
            context.top >= city.bottom &&
            condition.top > context.bottom &&
            Math.abs(condition.bottom - range.bottom) < 2 &&
            condition.right <= range.left &&
            [city, temperature, context, condition, range].every(
              part =>
                part.width > 0 &&
                part.height > 0 &&
                part.left >= bounds.left &&
                part.right <= bounds.right &&
                part.top >= bounds.top &&
                part.bottom <= bounds.bottom,
            )
          );
        }),
      )
      .toBe(true);
  }
  await card.locator('.current').click();
  await expect(card).toHaveAttribute('data-opened', 'true');
  await card.evaluate(() => {
    const host = document.querySelector('iweather-card');
    if (!host) throw new Error('No card.');
    host.setConfig({ ...host.config, show_name: false, show_high_low: false });
  });
  await expect(card.locator('.location')).toBeHidden();
  await expect(card.locator('.compact-meta')).toBeHidden();
  await expect(card.locator('.range')).toBeHidden();
  await expect(card.locator('.temperature')).toBeVisible();
  await card.evaluate(() => {
    const host = document.querySelector('iweather-card');
    if (!host) throw new Error('No card.');
    host.setConfig({ ...host.config, weather_layout: 'auto', show_name: true, show_high_low: true });
  });
  await expect(card.locator('.forecast')).toBeVisible();
  await expect(card.locator('.compact-meta')).toBeHidden();
});

test('compact shows the configured local time away from home', async ({ card }) => {
  await card.evaluate(() => {
    const host = document.querySelector('iweather-card');
    if (!host?.readHass) throw new Error('No card.');
    host.setConfig({ ...host.config, weather_layout: 'compact', place_name: 'Rome', time_zone: 'Europe/Rome' });
    const hass = host.readHass,
      state = hass.states['weather.home'];
    if (!state) throw new Error('No weather.');
    host.hass = {
      ...hass,
      states: {
        ...hass.states,
        'weather.home': {
          ...state,
          attributes: { ...state.attributes, latitude: 41.9, longitude: 12.5 },
        },
      },
    };
  });
  await expect(card.locator('.location')).toHaveText('Rome');
  await expect(card.locator('.place-context')).toHaveText('6:30 PM');
  await expect(card.locator('.place-home')).toBeHidden();
});
