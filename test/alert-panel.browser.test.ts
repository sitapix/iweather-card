import { expect, test } from 'vitest';
import { AlertPanel } from '../src/cards/alerts/panel.ts';
import { weatherAlerts } from '../src/cards/alerts/rules.ts';
import { weatherText } from '../src/weather/i18n.ts';

const NOW = Date.UTC(2026, 10, 3, 12);
const END = Date.UTC(2026, 10, 3, 18);
const inputs = () => ({
  alerts: weatherAlerts({
    state: '1',
    attributes: { Alerts: [{ Event: 'Flood Warning', Severity: 'Severe', Ends: new Date(END).toISOString() }] },
  }).map(alert => ({ ...alert, id: 'sensor.alerts', ahead: false })),
  alertsLead: true,
  locale: 'en',
  hour12: true,
  timeZone: 'UTC',
  now: NOW,
  t: weatherText('en'),
});

test('an unchanged alert follows changes to the clock, zone and language', () => {
  const node = document.createElement('div'),
    panel = new AlertPanel(node),
    state = inputs();
  panel.draw(state);
  expect(node.textContent).toContain('6:00 PM');
  panel.draw({ ...state, hour12: false });
  expect(node.textContent).toContain('18:00');
  panel.draw({ ...state, timeZone: 'America/New_York' });
  expect(node.textContent).toContain('1:00 PM');
  panel.draw({ ...state, locale: 'de', t: weatherText('de') });
  expect(node.textContent).toContain('Dienstag');
});

test("the panel's heading is the alert's own name, however severe", () => {
  const node = document.createElement('div'),
    panel = new AlertPanel(node);
  panel.draw(inputs());
  expect(node.querySelector('header')?.textContent).toBe('Flood Warning');
  expect(node.textContent).not.toContain('Severe Weather');
});

test('an unchanged alert stops describing its expired end as being in the future', () => {
  const node = document.createElement('div'),
    panel = new AlertPanel(node),
    state = inputs();
  panel.draw(state);
  expect(node.textContent).toContain('expected to last until');
  panel.draw({ ...state, now: END + 1 });
  expect(node.textContent).not.toContain('expected to last until');
});
