/**
 * Locale-aware formatting of floating time through the `DateFormatter` of
 * `@internationalized/date` (ADR-018): `Intl.DateTimeFormat` with fixes for engine bugs such as
 * `hour12: false` resolving to a 24:00 clock.
 *
 * There is no module-level state: each `DateAdapter` owns a {@link FormatterCache} created
 * by {@link createFormatterCache}, so nothing is shared between adapters (or gantt instances).
 */

import { DateFormatter } from '@internationalized/date';

import type { DateTimeMs } from './datetime';

/** Default upper bound of cached formatters per cache; the cache is cleared when it is reached. */
export const FORMATTER_CACHE_LIMIT = 64;

/** What a locale the runtime does not have is formatted in. */
const FALLBACK_LOCALE = 'en';

/**
 * The locale to format in: `locale` itself when the runtime has it, English when it does not.
 * `Intl` answers a tag that is well formed but unknown (`'xx'`) with the runtime's own default
 * locale, so the same chart would read differently on a German and an English machine; asking
 * for the fallback explicitly keeps the text the same everywhere (the `locale` default is `'en'`
 * for the same reason).
 *
 * @throws RangeError for a tag that is not well formed (from `Intl`), as before.
 */
function supportedLocale(locale: string): string {
  return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0 ? locale : FALLBACK_LOCALE;
}

/**
 * Formats a floating date-time with a fixed locale and options; the result of
 * `DateAdapter.formatter`.
 *
 * @throws RangeError for a non-finite `t` (from `Intl`).
 */
export type DateFormatFn = (t: DateTimeMs) => string;

/**
 * A bounded cache of floating date formatters keyed by locale + options (Flyweight).
 *
 * @internal
 */
export interface FormatterCache {
  /**
   * Returns the formatter for a locale and options, creating it on first use. Equal options in
   * any key order (and with `undefined` fields left out) share one function.
   *
   * @throws RangeError for an invalid locale or option value (from `Intl`).
   */
  readonly get: (options: Intl.DateTimeFormatOptions, locale: string) => DateFormatFn;
}

/**
 * Creates an empty formatter cache holding at most `limit` formatters; when the limit is reached
 * it is cleared before the next formatter is added. Formatters use the floating encoding:
 * `timeZone` is forced to `'UTC'` and `timeZoneName` is dropped (it would always read "UTC"), so
 * the output shows the wall-clock components unchanged in every runtime time zone. (The library
 * also caches the underlying `Intl.DateTimeFormat` objects per locale + options.)
 *
 * @param limit - Maximum number of cached formatters, default {@link FORMATTER_CACHE_LIMIT}.
 * @returns A new cache that shares nothing with other caches.
 * @internal
 */
export function createFormatterCache(limit: number = FORMATTER_CACHE_LIMIT): FormatterCache {
  const formatters = new Map<string, DateFormatFn>();
  return Object.freeze({
    get: (options: Intl.DateTimeFormatOptions, locale: string): DateFormatFn => {
      const { timeZone, timeZoneName, ...rest } = options;
      const entries = Object.entries(rest)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1));
      const key = `${locale}|${entries.map(([name, value]) => `${name}=${String(value)}`).join(',')}`;

      let format = formatters.get(key);
      if (!format) {
        const formatter = new DateFormatter(supportedLocale(locale), { ...rest, timeZone: 'UTC' });
        format = (t: DateTimeMs): string => formatter.format(new Date(t));
        if (formatters.size >= limit) formatters.clear();
        formatters.set(key, format);
      }
      return format;
    },
  });
}
