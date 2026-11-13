import type { WeatherAlert } from './rules.ts';
import { alertWords } from './sheet.ts';
import type { WeatherText } from '../../weather/i18n.ts';
import { esc } from '../../lib/html.ts';
import { alertIcon } from '../../weather/icons.ts';
import type { Update } from '../../card/update.ts';
import { dateFormat } from '../../lib/formats.ts';
import { say } from '../../weather/words.ts';

// One block for them all (see alertWords), opening the alerts' sheet: the first alert's event as
// its heading, after the most severe alert's level (green, yellow, orange or red), then the
// sentence and who issued them.
export function alertMarkup(
  alerts: readonly WeatherAlert[],
  words: ReturnType<typeof alertWords>,
  t: WeatherText | undefined,
): string {
  const heading = words.title ?? t?.('weather_alert') ?? say('Weather Alert');
  return `<i class="glass" aria-hidden="true"></i><header><span class="alert-level">${alertIcon(alerts.map(alert => alert.severity))}</span><span>${esc(heading)}</span></header><div class="body-window"><div class="panel-body"><button type="button" data-index="0"><span>${esc(words.sentence)}</span>${words.source ? `<small>${esc(words.source)}</small>` : ''}</button></div></div>`;
}
// The alerts' panel, above the hourly panel in the full layout.
export class AlertPanel {
  readonly node: HTMLElement;
  key: string | undefined;
  constructor(node: HTMLElement) {
    this.node = node;
  }
  draw({
    alerts,
    alertsLead,
    locale,
    hour12,
    timeZone,
    now,
    t,
  }: Pick<Update, 'alerts' | 'alertsLead' | 'locale' | 'hour12' | 'timeZone' | 'now' | 't'>) {
    const { node } = this;
    node.dataset['lead'] = String(alertsLead);
    node.hidden = !alerts.length;
    // Times carry their zone unless it is the reader's own.
    const zoned =
        dateFormat(undefined, { timeZone }).resolvedOptions().timeZone !==
        dateFormat(undefined, {}).resolvedOptions().timeZone,
      words = alertWords({ locale, timeZone, hour12, zoned }, alerts, now),
      markup = alerts.length ? alertMarkup(alerts, words, t) : '',
      key = JSON.stringify([alerts, markup]);
    if (this.key === key) return;
    this.key = key;
    node.innerHTML = markup;
  }
}
