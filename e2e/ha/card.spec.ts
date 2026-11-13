import { isList, isRecord, text } from '../../src/lib/values.ts';
import { recording } from '../recordings.ts';
import { DASHBOARD, RESOURCE, VIEW, expect, test, type Page } from './home-assistant.ts';

// The card on a real Home Assistant: its resource, its dashboard, its forecasts through the
// websocket, its units and its editor, each as Home Assistant itself provides them.

const MET = recording('met.live'),
  ZAMG = recording('zamg.live');

// Every forecast the page is sent through its subscriptions, by type, as they arrive. Home
// Assistant sends a message alone or several in a list.
function forecastsSent(page: Page): Map<string, (readonly unknown[])[]> {
  const sent = new Map<string, (readonly unknown[])[]>();
  page.on('websocket', socket => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return;
      const parsed: unknown = JSON.parse(payload),
        messages: readonly unknown[] = isList(parsed) ? parsed : [parsed];
      for (const message of messages) {
        const event = isRecord(message) ? message['event'] : undefined,
          type = isRecord(event) ? event['type'] : undefined,
          forecast = isRecord(event) ? event['forecast'] : undefined;
        if (text(type) && isList(forecast)) sent.set(type, [...(sent.get(type) ?? []), forecast]);
      }
    });
  });
  return sent;
}

test('loads on a dashboard from the resource Home Assistant serves, with no errors', async ({ open, page, faults }) => {
  const served = page.waitForResponse(response => new URL(response.url()).pathname === RESOURCE);
  const card = await open(MET);
  expect((await served).ok()).toBe(true);
  await expect(card.locator('.tile[data-tile]').nth(1)).toBeVisible();
  await expect(card.locator('.hero .location')).toHaveText('Stand-in');
  // Long enough for what the card asks of Home Assistant to have answered.
  await page.waitForTimeout(2000);
  expect(faults).toEqual([]);
});

test('shows the readings Home Assistant reports, and its hours from the forecast subscription', async ({
  open,
  page,
}) => {
  const sent = forecastsSent(page),
    hours = MET.forecasts['hourly'],
    card = await open(MET);
  if (!Array.isArray(hours)) throw new Error('met.live has no hours.');
  // 5.9 °C, as the card rounds it.
  await expect(card.locator('.hero .temperature')).toHaveText('6°');
  await expect(card.locator('.hours .hour').nth(1)).toBeVisible();
  // The hourly forecast came over the websocket, every hour of it, and the strip draws its first
  // hour: 5.7 °C and cloudy, at 20:00 UTC.
  expect(sent.get('hourly')?.at(-1)).toHaveLength(hours.length);
  await expect(card.locator('.hours .hour').nth(1)).toHaveAttribute('aria-label', /, Cloudy, 5\.7 °C$/);
});

test('says it is loading while the forecast is held back, and fills in once it comes', async ({ open, ha }) => {
  await ha.service('hold');
  try {
    const card = await open(MET, { drawn: false }),
      status = card.locator('.status');
    await expect(status.locator('span')).toHaveText('Loading forecast…');
    await expect(card.locator('.hours')).toBeHidden();
    await ha.service('release');
    await expect(card.locator('.hours .hour').nth(1)).toBeVisible();
    await expect(status).toBeHidden();
  } finally {
    await ha.service('release');
  }
});

test('follows Home Assistant into US units', async ({ open, ha }) => {
  const card = await open(MET);
  await expect(card.locator('.hero .temperature')).toHaveText('6°');
  await ha.socket.send({ type: 'config/core/update', unit_system: 'us_customary' });
  try {
    // The integration's next update, which Home Assistant converts to its new units.
    await ha.play(MET);
    // 5.9 °C is 42.6 °F, which Home Assistant rounds to a whole degree.
    await expect(card.locator('.hero .temperature')).toHaveText('43°');
    await expect(card.locator('.measure').first()).toContainText('°F');
    await expect(card.getByRole('button', { name: /^Wind 9 mph/ })).toBeVisible();
  } finally {
    await ha.socket.send({ type: 'config/core/update', unit_system: 'metric' });
    await ha.play(MET);
  }
});

test('shows the readings of an entity that gives no condition', async ({ open }) => {
  const card = await open(ZAMG);
  await expect(card.locator('.hero .temperature')).toHaveText('7°');
  // A tile by what it shows, whether or not it opens a sheet.
  await expect(card.locator('.tile[data-tile=humidity]')).toHaveAccessibleName(/^Humidity 77%/);
  await expect(card.locator('.tile[data-tile=wind]')).toHaveAccessibleName(/^Wind 16 km\/h/);
  await expect(card.locator('.hero')).not.toContainText('unknown');
});

test('opens a tile’s sheet', async ({ open }) => {
  const card = await open(MET);
  await card.getByRole('button', { name: /^Humidity 76%/ }).click();
  const dialog = card.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2').first()).toHaveText('Humidity');
});

test('opens its editor from the dashboard’s edit mode, with its form', async ({ open, page, ha }) => {
  await open(MET);
  await page.goto(`${ha.url}/${DASHBOARD}/${VIEW}?edit=1`);
  await page.locator('hui-card-options').getByRole('button', { name: 'Edit' }).click();
  const editor = page.locator('iweather-card-editor');
  await expect(editor.locator('ha-form').first()).toBeVisible();
  await expect(editor.getByText('Weather entity', { exact: true })).toBeVisible();
  await expect(editor.getByRole('radio', { name: 'Full page' })).toBeChecked();
  await editor.getByText('Map and online services', { exact: true }).click();
  await editor.getByText('Refresh intervals', { exact: true }).click();
  const radar = editor.getByRole('spinbutton', { name: 'Radar refresh (minutes)' }),
    forecast = editor.getByRole('spinbutton', { name: 'Forecast refresh (minutes)' });
  await expect(radar).toHaveValue('5');
  await expect(forecast).toHaveValue('60');
  await radar.fill('2');
  await forecast.fill('15');
  await expect(radar).toHaveValue('2');
  await expect(forecast).toHaveValue('15');
});
