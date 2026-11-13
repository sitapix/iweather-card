import type { TileContext } from '../shared/context.ts';
import { dateFormat, relativeFormat } from '../../lib/formats.ts';
import { DAY, HOUR, MINUTE, SECOND } from '../../lib/time.ts';
import { esc } from '../../lib/html.ts';
import { say } from '../../weather/words.ts';
import { sheetSection } from '../../sheets/parts.ts';

type FreshnessContext = Pick<TileContext, 'freshness' | 'locale' | 'timeZone' | 'hour12' | 'now'>;
const AGE_UNITS: readonly (readonly [milliseconds: number, unit: Intl.RelativeTimeFormatUnit])[] = [
  [DAY, 'day'],
  [HOUR, 'hour'],
  [MINUTE, 'minute'],
  [SECOND, 'second'],
];

export function freshnessMarkup({ freshness, locale, timeZone, hour12, now }: FreshnessContext): string {
  if (!freshness || freshness.length === 0) return '';
  const date = dateFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
      timeZone,
      hour12,
    }),
    relative = relativeFormat(locale, { numeric: 'always' }),
    paragraphs = freshness.map(update => {
      const age = now - update.at,
        [step, unit] = AGE_UNITS.find(([step]) => age >= step) ?? [SECOND, 'second'],
        ageText = relative.format(-Math.floor(age / step), unit),
        time = `<time datetime="${new Date(update.at).toISOString()}">${esc(ageText)} (${esc(date.format(update.at))})</time>`,
        sentence =
          update.kind === 'entity'
            ? say('Home Assistant updated {source}: {time}.', { source: esc(update.name), time })
            : say('Supplemental forecast retrieved: {time}.', { time });
      return `<p>${sentence}</p>`;
    });
  return sheetSection(
    say('Data Updates'),
    `${paragraphs.join('')}<p>${say('These times show entity changes and forecast downloads, not weather observation times.')}</p>`,
    { kind: 'detail-about' },
  );
}
