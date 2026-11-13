import { finite } from './values.ts';
// Intl formatters, built once for each locale and set of options and shared by every
// card. Building one costs far more than formatting with it, and the card formats
// hundreds of times a render (every hour, day and reading). A page only ever asks for
// a few dozen kinds, so the caches stay small; the bound is a backstop.
const CACHE_LIMIT = 256;
const cached = <Options, Format>(make: (locale: string | undefined, options: Options) => Format) => {
  const formats = new Map<string, Format>();
  return (locale: string | undefined, options: Options): Format => {
    const key = JSON.stringify([locale, options]);
    let format = formats.get(key);
    if (format === undefined) {
      if (formats.size >= CACHE_LIMIT) formats.clear();
      format = make(locale, options);
      formats.set(key, format);
    }
    return format;
  };
};
export const dateFormat = cached(
  (locale, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options),
);
// Clock times in a zone, to the hour or to the minute, on the 12- or 24-hour clock asked for, or
// else the locale's own.
export interface ClockSettings {
  locale: string | undefined;
  timeZone: string | undefined;
  hour12: boolean | undefined;
}
export const clockFormat = ({ locale, timeZone, hour12 }: ClockSettings, minutes = true): Intl.DateTimeFormat =>
  dateFormat(locale, { hour: 'numeric', minute: minutes ? '2-digit' : undefined, timeZone, hour12 });
export const relativeFormat = cached(
  (locale, options: Intl.RelativeTimeFormatOptions) => new Intl.RelativeTimeFormat(locale, options),
);
// Home Assistant's number format setting, as the locale that writes numbers that way. Plain is
// its "none": digits and a point, with nothing between the thousands.
const PLAIN = 'plain';
const NUMBER_LOCALES: Readonly<Record<string, string | undefined>> = {
  comma_decimal: 'en-US',
  decimal_comma: 'de',
  space_comma: 'fr',
  quote_decimal: 'de-CH',
  none: PLAIN,
  system: undefined,
};
// The locale numbers are written in: the language's, unless the setting names another way.
export const numberLocale = (format: string | undefined, language: string | undefined): string | undefined =>
  format !== undefined && format in NUMBER_LOCALES ? NUMBER_LOCALES[format] : language;
export const numberFormat = cached((locale, options: Intl.NumberFormatOptions) =>
  locale === PLAIN
    ? new Intl.NumberFormat('en-US', { ...options, useGrouping: false })
    : new Intl.NumberFormat(locale, options),
);
// Home Assistant's clock setting: '12' or '24' forces one, 'system' goes by the browser's own
// locale, and otherwise (undefined) the language of what is being formatted decides.
export function hour12Of(timeFormat: string | undefined): boolean | undefined {
  if (timeFormat === '12') return true;
  if (timeFormat === '24') return false;
  return timeFormat === 'system' ? dateFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 : undefined;
}
export function weatherNumber(value: number | null | undefined, locale: string | undefined, digits = 0): string {
  // A reading that rounds to zero reads 0, not −0.
  return finite(value)
    ? numberFormat(locale, { maximumFractionDigits: digits, signDisplay: 'negative' }).format(value)
    : '—';
}

// Readings under 10 keep a decimal ("0.2 mi"), rather than rounding to 0; pressure in inches
// of mercury shows two.
const SMALL_VALUE = 10;

export const smallValueDigits = (value: number): number => (value < SMALL_VALUE ? 1 : 0);
