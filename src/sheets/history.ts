import { type CardConfig, OPEN_METEO } from '../card/config.ts';
import { isRecord } from '../lib/values.ts';
import { convertAttributes, UNIT_KIND_NAMES } from '../weather/units.ts';
import { HOUR, MINUTE } from '../lib/time.ts';
import type { HomeAssistant } from '../card/home-assistant.ts';
import type { Update } from '../card/update.ts';
import type { DetailSheets } from './sheets.ts';
import { type DayBand, monthDay, openMeteoDayBand, statisticsDayBand } from '../cards/averages/climate.ts';
import { dateKey } from '../weather/forecast-items.ts';
import { dayAxis } from './days.ts';
import { askHistory, historyOf, stateTime } from '../weather/history.ts';
// What the sheets ask for beyond the forecast: yesterday's and earlier today's readings for their
// comparisons, and the normal range through the day on the averages sheet.
// History rows in the card's units: Home Assistant keeps them in the entity's own.
const inUnits = (states: readonly unknown[], config: CardConfig): unknown[] =>
  states.map(state => {
    if (!isRecord(state)) return state;
    const attributes = state['a'] ?? state['attributes'];
    return isRecord(attributes) ? { ...state, a: convertAttributes(attributes, config) } : state;
  });
// What a band may be asked for again after failing, an hour on.
const BAND_RETRY = HOUR;
// What the history reads from the card, and from the sheets.
export interface HistoryHost {
  readonly config: CardConfig | undefined;
  readonly readHass: HomeAssistant | undefined;
  readonly update: Update | undefined;
}
type HistorySheets = Pick<DetailSheets, 'detail' | 'render'>;
export class SheetHistory {
  readonly card: HistoryHost;
  readonly sheets: HistorySheets;
  // The normal range at each hour of today's date, for the averages sheet: undefined while asked for.
  dayBand: { band: DayBand | null | undefined; key: string; at: number } | undefined;
  constructor(card: HistoryHost, sheets: HistorySheets) {
    this.card = card;
    this.sheets = sheets;
  }
  // The normal range through today's date, once the averages sheet shows temperatures: asked for
  // once per date (and place, unit and source), again an hour after it failed, and kept by the
  // source (see openMeteoDayBand).
  async loadDayBand() {
    const { card, sheets } = this,
      { detail } = sheets,
      ctx = card.update?.ctx,
      hass = card.readHass,
      source = card.config?.averages;
    if (detail?.id !== 'averages') return;
    if (!ctx?.climate || !hass || !source) {
      this.dayBand = undefined;
      return;
    }
    if (detail.variant === 'precipitation') return;
    const date = monthDay(dateKey(ctx.now, ctx.timeZone)),
      { latitude, longitude } = ctx,
      unit = ctx.attrs.temperature_unit,
      key = JSON.stringify([source, latitude, longitude, unit, ctx.timeZone, date]);
    const asked = this.dayBand,
      now = Date.now();
    if (asked?.key === key && (asked.band !== null || now - asked.at < BAND_RETRY)) return;
    const asking = { band: undefined, key, at: now };
    this.dayBand = asking;
    let band: DayBand | null = null;
    try {
      band =
        source === OPEN_METEO
          ? await openMeteoDayBand(latitude, longitude, unit, date, ctx.timeZone)
          : await statisticsDayBand(hass, source, unit, date, ctx.climate.since, ctx.timeZone);
    } catch {}
    if (this.dayBand !== asking) return;
    this.dayBand = { band, key, at: now };
    if (sheets.detail?.id === 'averages' && sheets.detail.dialog.open) sheets.render();
  }
  // Yesterday and earlier today, once per day, for the comparison.
  async loadHistory() {
    const { card, sheets } = this,
      { detail } = sheets,
      ctx = card.update?.ctx,
      hass = card.readHass,
      config = card.config;
    if (!detail || !ctx || !hass?.callWS || !config) return;
    const midnight = dayAxis(ctx.now, ctx.timeZone).start,
      key = JSON.stringify([config.entity, Math.round(midnight / MINUTE), UNIT_KIND_NAMES.map(name => config[name])]);
    if (detail.historyKey === key) return;
    detail.historyKey = key;
    detail.history = undefined;
    try {
      const yesterday = dayAxis(midnight - 1, ctx.timeZone).start,
        result = await askHistory(hass, [config.entity], true, yesterday, ctx.now);
      if (detail.historyKey !== key) return;
      const states = inUnits(historyOf(result, config.entity), config);
      detail.history = {
        yesterday: states.filter(state => stateTime(state) < midnight),
        today: states.filter(state => stateTime(state) >= midnight),
      };
      if (detail.dialog.open) sheets.render();
    } catch {
      // None came: the open sheet says so now, not only once something else draws it.
      if (detail.historyKey !== key) return;
      detail.history = null;
      if (detail.dialog.open) sheets.render();
    }
  }
}
