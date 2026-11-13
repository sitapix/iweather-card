import { UNITS } from '../../weather/units.ts';
import { MINUTE } from '../../lib/time.ts';
import { pointEasing } from '../../lib/press.ts';
import type { Update } from '../../card/update.ts';
import { esc, percent } from '../../lib/html.ts';
import { setText } from '../../lib/dom.ts';
import { glyphs, modeGlyphs } from '../shared/glyphs.ts';
import { addedLightAlone, LINE_MIDDLE, WORDS } from '../shared/light.ts';
import { symbolShapes } from '../shared/tile.ts';
import {
  MODE_TEXT,
  tightPeriod,
  type DailyRows,
  dayRow,
  type HourlyRows,
  hourEntry,
  hourNight,
  rainReading,
  rowAttributes,
} from './rows.ts';
import {
  isWindLook,
  type RainLabels,
  type StripColumn,
  type StripFrame,
  rainLabels,
  rainMarks,
  windChart,
} from './strip-chart.ts';
import { stripPull } from './pull.ts';
import { frozenPrecipitation } from '../../weather/precipitation.ts';
import { weatherIcon } from '../../weather/icons.ts';
import { weatherAvailable } from '../../weather/conditions.ts';
import { forecastSummary } from '../../weather/summary.ts';
import { dateFormat } from '../../lib/formats.ts';
import { finite } from '../../lib/values.ts';
import { placeThumb } from './switch.ts';
import { dateKey } from '../../weather/forecast-items.ts';
import { dailyDetail, placeInDay } from './day-detail.ts';
import { temperatureRange } from '../../weather/temperature-colors.ts';
import { pageTarget } from '../../weather/forecast.ts';
import type { Parts } from '../../card/parts.ts';
// The hourly panel and the daily list.
// Gusts worth a sentence in the summary: about 20 mph.
const GUST_LIMIT: Readonly<Record<string, number>> = {
  [UNITS.milesPerHour]: 20,
  [UNITS.kilometersPerHour]: 32,
  [UNITS.metersPerSecond]: 9,
  [UNITS.knots]: 17,
  [UNITS.feetPerSecond]: 29,
  [UNITS.beaufort]: 5,
};
// The hourly strip's arrows: a page ending within 10px of an end goes to that end (the strip's gap
// between hours), and a press within 0.3 s of the last carries on from where that one was headed.
const PAGE = { snap: 10, carry: 300 } as const;
// The pinned heading's words start after its glyph's box, as a tile's title does, and the glyph adds
// its light with them as one shape, as a tile's symbol does, so the two can't be drawn apart.
const PINNED_X = 30;
// How far apart now's place on today's wind chart is worked out: a chart's width is a pixel in
// about ten minutes.
const NOW_STEP = 5 * MINUTE;
// A bar rises from nothing on a spring of about .36 s with a slight bounce, each a moment after
// the one before, and follows a new reading on the same spring at once.
const RISE = {
  duration: 363,
  delay: 200,
  stagger: 30,
  spring: pointEasing(
    'linear(0,.051,.172,.324,.48,.623,.746,.844,.918,.971,1.006,1.026,1.036,1.038,1.036,1.032,1.026,1.02,1)',
  ),
} as const;
// What the panel reads from the card.
interface PanelHost {
  readonly parts: Parts;
  readonly motion: MediaQueryList | undefined;
  measureZoom(): number;
}
export class ForecastPanel {
  readonly card: PanelHost;
  dailyKey: string | undefined;
  hoursKey: string | undefined;
  // What the marks across the strip were last drawn from, the frame on its own to say when the
  // columns have moved, and how full each hour's bar was left.
  marksKey: string | undefined;
  frameKey: string | undefined;
  fills = new Map<number, number>();
  // Where the hourly strip's last arrow press was headed, for a moment after it (see page).
  pageTo: number | undefined;
  pageTimer: number | undefined;
  // Whether the strip can be pulled past its start now (see stripPull).
  pull: ((can: boolean) => void) | undefined;
  constructor(card: PanelHost) {
    this.card = card;
  }
  // The hourly panel's heading, and the precipitation switch: a snowflake for snow, sleet or a
  // wintry mix; a drop otherwise.
  drawHeading({ t, strip: { mode, kind } }: Update) {
    setText(this.card.parts.heading, t(MODE_TEXT[mode]));
    const pinned = esc(t('hourly_forecast')),
      { pinnedHeading } = this.card.parts;
    if (pinnedHeading.dataset['words'] !== pinned) {
      pinnedHeading.dataset['words'] = pinned;
      pinnedHeading.innerHTML = `${glyphs.clock}<span>${pinned}</span>`;
      const clock = symbolShapes(pinnedHeading.querySelector('svg')).get(1) ?? '',
        { marks } = addedLightAlone('strip', [
          { name: 'pinned', shapes: `${clock}<text x="${PINNED_X}" y="50%">${pinned}</text>`, ...WORDS.label },
        ]);
      pinnedHeading.insertAdjacentHTML('beforeend', `<svg class="title">${marks}</svg>`);
    }
    const rainButton = this.card.parts.modeButtons.find(button => button.dataset['mode'] === 'rain'),
      rainGlyph = frozenPrecipitation(kind) ? 'flake' : 'drop';
    if (rainButton instanceof HTMLElement && rainButton.dataset['glyph'] !== rainGlyph) {
      rainButton.dataset['glyph'] = rainGlyph;
      rainButton.innerHTML = rainGlyph === 'drop' ? modeGlyphs.rain : weatherIcon(rainGlyph);
    }
  }
  // The view's sentence, which nothing shows: the strip's accessible description.
  drawSummary({ state, attrs, locale, timeZone, fmt, named, hour12, strip: { type, points, mode } }: Update) {
    const gustUnit = attrs.wind_speed_unit;
    setText(
      this.card.parts.summary,
      type === 'hourly' && weatherAvailable(state)
        ? forecastSummary(points, mode, {
            text: named,
            timeZone,
            fmt,
            gustUnit: gustUnit ?? '',
            gustLimit: (gustUnit === undefined ? undefined : GUST_LIMIT[gustUnit]) ?? Infinity,
            unit: attrs.precipitation_unit,
            clock: time => tightPeriod(dateFormat(locale, { hour: 'numeric', timeZone, hour12 }).format(time)),
          })
        : '',
    );
  }
  // What the hourly panel measures, and the switch under the view it shows. Subtitles:
  // "Temperature (°F)", "Intensity • Chance of Snow", "Speed (mph) • Gusts". The words add their
  // light to the panel, over the page's own, which hold their place (see WORDS).
  drawMeasure({ t, attrs, strip: { type, points, mode, rain, kind, unit } }: Update) {
    const gusts = points.some(item => finite(item.wind_gust_speed)),
      rainUnit = attrs.precipitation_unit;
    const measure =
      mode === 'conditions'
        ? `${t('temperature')}${unit ? ` (${unit})` : ''}`
        : mode === 'wind'
          ? `${t('speed')}${unit ? ` (${unit})` : ''}${gusts ? ` • ${t('gusts')}` : ''}`
          : `${t('intensity')} • ${rain === 'precipitation_probability' ? t(`chance_of_${kind}`) : `${t('amount')}${rainUnit ? ` (${rainUnit})` : ''}`}`;
    const words = esc(
      `${type === 'hourly' ? '' : `${t(type === 'twice_daily' ? 'day_night' : 'daily')} • `}${measure}`,
    );
    if (this.card.parts.measure.dataset['words'] !== words) {
      this.card.parts.measure.dataset['words'] = words;
      const { marks } = addedLightAlone('strip', [
        { name: 'measure', shapes: `<text y="50%" ${LINE_MIDDLE}>${words}</text>`, ...WORDS.aside },
      ]);
      this.card.parts.measure.innerHTML = `<span>${words}</span><svg class="words" aria-hidden="true">${marks}</svg>`;
    }
    for (const button of this.card.parts.modeButtons)
      button.setAttribute('aria-pressed', String(button.dataset['mode'] === mode));
    placeThumb(this.card.parts);
  }
  // The hours, or why there are none.
  drawStatus({ t, available, strip: { type, forecast, points } }: Update) {
    const hasForecast = (forecast?.forecast.length ?? 0) > 0 && points.length > 0;
    this.card.parts.hours.hidden = !hasForecast;
    this.card.parts.status.hidden = hasForecast;
    this.card.parts.forecast.toggleAttribute('data-detail', hasForecast && type === 'hourly');
    setText(
      this.card.parts.statusText,
      t(
        !available
          ? 'unavailable'
          : forecast?.status === 'loading'
            ? 'loading'
            : forecast?.status === 'error'
              ? 'load_failed'
              : 'forecast_unavailable',
      ),
    );
    this.card.parts.retry.hidden = !available || forecast?.status !== 'error';
  }
  drawDaily({ attrs, locale, numbers, timeZone, now, t, fmt, named, data, days, hass, strip: { mode } }: Update) {
    const detail = dailyDetail(
      [...(data.hourly?.earlier ?? []), ...(data.hourly?.forecast ?? [])],
      days,
      timeZone,
      hass?.config,
    );
    // Everything a row is drawn from: what is unchanged needs no drawing. The wind's dot moves on
    // by itself, and the rain's outline goes by the segment.
    const place = placeInDay(Math.floor(now / NOW_STEP) * NOW_STEP, timeZone),
      view = {
        mode,
        locale,
        numbers,
        timeZone,
        attrs: rowAttributes(attrs),
        now: mode === 'wind' ? place : mode === 'rain' ? Math.floor(place) : null,
      },
      key = JSON.stringify([view, days, [...detail], t.today]);
    if (this.dailyKey === key) return;
    this.dailyKey = key;
    const ranges = temperatureRange(days, attrs.temperature_unit, attrs.temperature);
    const rows: DailyRows = { ...view, t, fmt, named },
      list = this.card.parts.dailyList,
      focused = list.querySelector<HTMLElement>('.day:focus')?.dataset['key'];
    list.dataset['mode'] = mode;
    list.replaceChildren(
      ...days.map((day, index) => dayRow(day, detail.get(dateKey(day.time, timeZone)), ranges[index], rows)),
    );
    // Whoever is on a row by the keyboard stays on it as it's drawn again.
    if (focused) list.querySelector<HTMLElement>(`.day[data-key="${focused}"]`)?.focus({ preventScroll: true });
  }
  drawHours({
    attrs,
    locale,
    numbers,
    timeZone,
    t,
    fmt,
    named,
    hour12,
    night,
    strip: { type, items, rain, mode, unit, wind },
  }: Update) {
    // Everything an hour is drawn from: what is unchanged needs no drawing. The live first hour's
    // time moves on by itself.
    const view = {
        mode,
        locale,
        numbers,
        timeZone,
        attrs: rowAttributes(attrs),
        type,
        rain,
        unit,
        night,
        hour12,
      },
      key = JSON.stringify([
        view,
        items.map(({ time, now, ...item }) => ({ ...item, time: now ? null : time, now })),
        t.now,
      ]),
      rows: HourlyRows = { ...view, t, fmt, named };
    if (this.hoursKey !== key) {
      this.hoursKey = key;
      const hours = this.card.parts.hours,
        scroll = hours.scrollLeft;
      hours.dataset['mode'] = mode;
      hours.setAttribute(
        'aria-label',
        `${t(type === 'hourly' ? 'hourly_forecast' : 'daily_forecast')}, ${t(MODE_TEXT[mode])}${unit ? `, ${unit}` : ''}`,
      );
      const entries = items.map(item => hourEntry(item, rows));
      hours.replaceChildren(...entries);
      this.marksKey = undefined;
      this.rise(entries, mode === 'rain' ? items : [], rows);
      hours.scrollLeft = scroll;
      this.fade();
    }
    if (mode === 'conditions') this.frameKey = undefined;
    else this.drawMarks(rows, items, wind);
  }
  // A bar rises from nothing the first time it shows, each a moment after the one before; one that
  // was already showing goes from what it read to what it reads now, at once.
  rise(entries: readonly HTMLElement[], items: Update['strip']['items'], rows: HourlyRows) {
    const before = this.fills;
    this.fills = new Map();
    items.forEach((item, index) => {
      const fill = entries[index]?.querySelector('.precip-bar span');
      if (!fill) return;
      const { share } = rainReading(item, rows),
        hour = item.now ? 0 : item.time,
        was = before.get(hour);
      this.fills.set(hour, share);
      if (was === share || !share || this.card.motion?.matches) return;
      fill.animate(
        { height: [percent(was ?? 0), percent(share)] },
        {
          duration: RISE.duration,
          easing: RISE.spring,
          delay: was === undefined ? RISE.delay + index * RISE.stagger : 0,
          fill: 'backwards',
        },
      );
    });
  }
  // Where the strip's columns came out, in its own scrolled pixels, whichever way the page is
  // zoomed or moved.
  frame(): StripFrame {
    const hours = this.card.parts.hours,
      wind = hours.dataset['mode'] === 'wind',
      zoom = this.card.measureZoom(),
      origin = hours.getBoundingClientRect(),
      place = (node: Element | null) => {
        if (!node) return null;
        const { left, top, width, height } = node.getBoundingClientRect();
        return {
          left: Number(((left - origin.left) / zoom + hours.scrollLeft).toFixed(2)),
          top: Number(((top - origin.top) / zoom).toFixed(2)),
          width: Number((width / zoom).toFixed(2)),
          height: Number((height / zoom).toFixed(2)),
        };
      };
    const columns = [...hours.querySelectorAll(':scope > .hour')].flatMap((node): StripColumn[] => {
        const box = place(node);
        if (!box) return [];
        // A sun's label on the chart takes its place from the line: only its width comes from here.
        const label = wind ? place(node.querySelector(':scope[data-sun] > .hour-value')) : null;
        return [
          {
            left: box.left,
            width: box.width,
            bar: place(node.querySelector('.precip-bar')),
            value: wind ? label && { ...label, top: 0, height: 0 } : place(node.querySelector('.hour-value')),
          },
        ];
      }),
      [first] = columns,
      last = columns.at(-1),
      // How the styles draw the wind chart, if they say (see LOOKS).
      look = getComputedStyle(hours).getPropertyValue('--wind-look').trim();
    return {
      width: first && last ? Number((last.left + last.width + first.left).toFixed(2)) : 0,
      height: Number((origin.height / zoom).toFixed(2)),
      columns,
      ...(isWindLook(look) ? { look } : {}),
    };
  }
  // The marks across the strip in the precipitation and wind views, from where its columns came out.
  drawMarks(rows: HourlyRows, items: Update['strip']['items'], wind: Update['strip']['wind']) {
    const hours = this.card.parts.hours,
      frame = this.frame(),
      rain = items.map(item => {
        if (item.sun) return null;
        const { text, none } = rainReading(item, rows);
        return { night: hourNight(item, rows.night), none: none ? text : null };
      }),
      labels: RainLabels = {
        levels: [rows.t('heavy'), rows.t('moderate'), rows.t('light')],
        row: rows.t(rows.rain === 'precipitation_probability' ? 'chance' : 'amount'),
      },
      frameKey = JSON.stringify(frame),
      key = JSON.stringify([rows.mode, frame, rows.mode === 'wind' ? wind : [rain, labels]]);
    this.frameKey = frameKey;
    if (this.marksKey === key) return;
    this.marksKey = key;
    for (const marks of hours.querySelectorAll(':scope > :is(.wind-chart, .strip-marks, .strip-labels)'))
      marks.remove();
    // A card out of sight has no columns to go by: it comes back to this when it shows (see moved).
    if (!frame.width) return;
    if (rows.mode === 'rain')
      hours.insertAdjacentHTML('afterbegin', `${rainMarks(frame, rain)}${rainLabels(frame, labels)}`);
    else {
      const { chart, pills } = windChart(wind, frame);
      hours.insertAdjacentHTML('afterbegin', chart);
      [...hours.querySelectorAll<HTMLElement>(':scope > .hour')].forEach((entry, index) => {
        const label = entry.querySelector<HTMLElement>(':scope[data-sun] > .hour-value');
        if (label) label.style.bottom = `${pills[index] ?? 0}px`;
      });
    }
  }
  // Whether the strip's columns are no longer where its marks were drawn for.
  moved(): boolean {
    return this.frameKey !== undefined && this.frameKey !== JSON.stringify(this.frame());
  }
  // Fade whichever edge of the hourly strip has more to scroll to, and offer its arrow.
  fade() {
    const hours = this.card.parts.hours,
      start = hours.scrollLeft > 1,
      end = hours.scrollLeft + hours.clientWidth < hours.scrollWidth - 1;
    const fade = start && end ? 'both' : start ? 'start' : end ? 'end' : '';
    if ((hours.dataset['fade'] ?? '') !== fade) {
      if (fade) hours.dataset['fade'] = fade;
      else delete hours.dataset['fade'];
    }
    this.card.parts.pageBack.toggleAttribute('data-more', start);
    this.card.parts.pageNext.toggleAttribute('data-more', end);
    this.pull ??= stripPull(hours, () => this.card.measureZoom());
    this.pull(!start && hours.dataset['mode'] === 'rain' && hours.closest('[data-layout=page]') !== null);
  }
  // Pages the hourly strip, the moment its arrow is pressed. Quick presses add up: each carries on
  // from where the last was headed. The browser runs the glide, so a busy sky doesn't hold it up.
  page(forward: boolean) {
    const hours = this.card.parts.hours,
      from = this.pageTo ?? hours.scrollLeft;
    this.pageTo = pageTarget(forward, from, hours.clientWidth, hours.scrollWidth - hours.clientWidth, PAGE.snap);
    hours.scrollTo({ left: this.pageTo, behavior: this.card.motion?.matches ? 'auto' : 'smooth' });
    window.clearTimeout(this.pageTimer);
    this.pageTimer = window.setTimeout(() => {
      this.pageTo = undefined;
    }, PAGE.carry);
  }
}
