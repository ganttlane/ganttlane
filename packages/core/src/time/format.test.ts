import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { createFloatingAdapter } from './adapter';
import { asDateTimeMs, getParts, utc } from './datetime';
import { createFormatterCache, FORMATTER_CACHE_LIMIT } from './format';

// 23:30 on the last day of a month: formatting in any zone other than UTC would show another
// hour, day or even month.
const t = asDateTimeMs(Date.UTC(2026, 2, 31, 23, 30));

/** Formats through a fresh adapter, like core code does. */
function formatDate(time: number, options: Intl.DateTimeFormatOptions, locale: string): string {
  return createFloatingAdapter().format(asDateTimeMs(time), options, locale);
}

/** 127 distinct option sets (every non-empty subset of seven fields). */
function manyOptions(): Intl.DateTimeFormatOptions[] {
  const fields = ['year', 'month', 'day', 'hour', 'minute', 'second', 'weekday'] as const;
  const all: Intl.DateTimeFormatOptions[] = [];
  for (let mask = 1; mask < 2 ** fields.length; mask++) {
    const options: Intl.DateTimeFormatOptions = {};
    fields.forEach((field, i) => {
      if (mask & (1 << i)) {
        Object.assign(options, { [field]: field === 'weekday' ? 'short' : 'numeric' });
      }
    });
    all.push(options);
  }
  return all;
}

describe('time/format', () => {
  it.each([
    [{ month: 'long' }, 'en', 'March'],
    [{ month: 'long' }, 'de', 'März'],
    [{ day: 'numeric' }, 'en', '31'],
    [{ weekday: 'long' }, 'en', 'Tuesday'],
    [{ year: 'numeric', month: 'numeric', day: 'numeric' }, 'en-US', '3/31/2026'],
    [{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-GB', '23:30'],
  ] as const)('FR-TIME-2: formats %o in %s as the wall clock', (options, locale, expected) => {
    expect(formatDate(t, options, locale)).toBe(expected);
    expect(createFormatterCache().get(options, locale)(t)).toBe(expected);
  });

  it('ignores timeZone and timeZoneName (floating time has no zone)', () => {
    const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    expect(formatDate(t, { ...options, timeZone: 'Asia/Tokyo' }, 'en-GB')).toBe('23:30');
    expect(formatDate(t, { ...options, timeZoneName: 'short' }, 'en-GB')).toBe('23:30');
  });

  it('shares one formatter per locale + options, in any key order (Flyweight)', () => {
    const cache = createFormatterCache();
    const a = cache.get({ month: 'short', day: 'numeric' }, 'en');
    expect(cache.get({ day: 'numeric', month: 'short' }, 'en')).toBe(a);
    expect(cache.get({ day: 'numeric', month: 'short', year: undefined }, 'en')).toBe(a);
    expect(cache.get({ day: 'numeric', month: 'short', timeZone: 'Asia/Tokyo' }, 'en')).toBe(a);
    expect(cache.get({ month: 'short', day: 'numeric' }, 'de')).not.toBe(a);
    expect(cache.get({ month: 'long', day: 'numeric' }, 'en')).not.toBe(a);
  });

  it('keeps the cache bounded', () => {
    const cache = createFormatterCache();
    const first = cache.get({ era: 'short' }, 'en');
    for (const options of manyOptions()) cache.get(options, 'en');
    expect(cache.get({ era: 'short' }, 'en')).not.toBe(first);
  });

  it('honours a custom limit: the cache is cleared when it is full', () => {
    const cache = createFormatterCache(2);
    const a = cache.get({ year: 'numeric' }, 'en');
    const b = cache.get({ month: 'long' }, 'en');
    expect(cache.get({ year: 'numeric' }, 'en')).toBe(a);
    cache.get({ day: 'numeric' }, 'en'); // full: cleared first
    expect(cache.get({ month: 'long' }, 'en')).not.toBe(b);
  });

  it('ADR-018: hour12: false is a 00-23 clock in every engine (DateFormatter fix)', () => {
    const midnight = asDateTimeMs(Date.UTC(2026, 0, 1, 0, 30));
    const options = { hour: 'numeric', minute: '2-digit', hour12: false } as const;
    expect(formatDate(midnight, options, 'en-US')).toBe('00:30');
  });

  it('throws RangeError for an invalid locale', () => {
    expect(() => formatDate(t, { month: 'long' }, 'not a locale!')).toThrow(RangeError);
    expect(() => createFormatterCache().get({ month: 'long' }, 'not a locale!')).toThrow(
      RangeError,
    );
  });

  it('property: output is stable and matches the floating wall clock', () => {
    const options = { year: 'numeric', month: 'numeric', day: 'numeric' } as const;
    const format = createFormatterCache().get(options, 'en-US');
    fc.assert(
      fc.property(
        fc.integer({ min: utc(1, 0, 1), max: utc(9999, 11, 31, 23, 59) }).map(asDateTimeMs),
        (time) => {
          const { year, month, day } = getParts(time);
          const text = format(time);
          const fresh = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
          return (
            text === `${month}/${day}/${year}` &&
            format(time) === text &&
            formatDate(time, options, 'en-US') === text &&
            fresh.format(time) === text
          );
        },
      ),
    );
  });

  describe('per-adapter formatter cache (no module-level singleton)', () => {
    it('DateAdapter.formatter resolves a formatter once and reuses it per adapter', () => {
      const dates = createFloatingAdapter();
      const format = dates.formatter({ month: 'short', day: 'numeric' }, 'en');
      expect(format(t)).toBe('Mar 31');
      expect(dates.formatter({ day: 'numeric', month: 'short' }, 'en')).toBe(format);
      expect(dates.format(t, { month: 'short', day: 'numeric' }, 'en')).toBe('Mar 31');
    });

    it('adapters do not share formatters', () => {
      const options = { month: 'short', day: 'numeric' } as const;
      const a = createFloatingAdapter().formatter(options, 'en');
      const b = createFloatingAdapter().formatter(options, 'en');
      expect(a).not.toBe(b);
      expect(a(t)).toBe(b(t));
    });

    describe('a locale the runtime does not have', () => {
      const Real = Intl.DateTimeFormat;

      /**
       * A runtime whose own locale is German: `Intl` answers a tag it does not know (a valid
       * tag such as 'xx') with the runtime's locale, which an English test runtime would hide.
       */
      function germanRuntime(): void {
        function GermanDateTimeFormat(
          this: unknown,
          locales?: string | string[],
          options?: Intl.DateTimeFormatOptions,
        ): Intl.DateTimeFormat {
          const known = ([] as string[])
            .concat(locales ?? [])
            .find((tag) => Real.supportedLocalesOf(tag).length > 0);
          return new Real(known ?? 'de', options);
        }
        GermanDateTimeFormat.supportedLocalesOf = Real.supportedLocalesOf.bind(Real);
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = GermanDateTimeFormat;
      }
      afterEach(() => {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
      });

      it('FR-I18N-1: a valid but unsupported tag is formatted in English, not in the runtime’s locale', () => {
        germanRuntime();

        expect(formatDate(t, { month: 'long' }, 'xx')).toBe('March');
        expect(createFormatterCache().get({ month: 'long' }, 'xx-YY')(t)).toBe('March');
        expect(createFloatingAdapter().formatter({ weekday: 'long' }, 'qqq')(t)).toBe('Tuesday');
      });

      it('FR-I18N-1: a locale the runtime has is used as it is, with its own calendar and numbering', () => {
        germanRuntime();

        expect(formatDate(t, { month: 'long' }, 'de')).toBe('März');
        expect(formatDate(t, { year: 'numeric' }, 'th-TH-u-ca-buddhist')).toContain('2569');
        // A region the runtime does not list still reaches the language it does have.
        expect(formatDate(t, { month: 'long' }, 'de-ZZ')).toBe('März');
      });
    });

    it(`each adapter keeps its own cache bounded at ${FORMATTER_CACHE_LIMIT} entries`, () => {
      expect(FORMATTER_CACHE_LIMIT).toBe(64);
      const busy = createFloatingAdapter();
      const quiet = createFloatingAdapter();
      const busyFirst = busy.formatter({ era: 'short' }, 'en');
      const quietFirst = quiet.formatter({ era: 'short' }, 'en');
      const options = manyOptions();
      for (const each of options.slice(0, FORMATTER_CACHE_LIMIT - 1)) busy.formatter(each, 'en');
      expect(busy.formatter({ era: 'short' }, 'en')).toBe(busyFirst); // 64 entries: still cached
      for (const each of options) busy.formatter(each, 'en');
      expect(busy.formatter({ era: 'short' }, 'en')).not.toBe(busyFirst);
      expect(quiet.formatter({ era: 'short' }, 'en')).toBe(quietFirst);
    });
  });
});
