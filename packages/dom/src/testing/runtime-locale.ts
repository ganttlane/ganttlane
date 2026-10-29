import { vi } from 'vitest';

/**
 * Makes `Date.prototype.toLocaleString` and `Number.prototype.toLocaleString` answer like a
 * runtime whose own locale is `own`: a locale it knows is used, and anything it does not know
 * (a valid tag such as `'xx'`, or no locale at all) gets `own`, as `Intl` does with the
 * runtime's default. Lets a test see whether code asks for English as the fallback, which an
 * English test runtime hides. Undone by `vi.restoreAllMocks()`.
 *
 * @param own - The runtime's own locale, e.g. `'de'`.
 */
export function emulateRuntimeLocale(own: string): void {
  const resolve = (locales: Intl.LocalesArgument): string => {
    const asked = ([] as unknown[])
      .concat(locales ?? [])
      .filter((tag): tag is string => typeof tag === 'string');
    return asked.find((tag) => Intl.NumberFormat.supportedLocalesOf(tag).length > 0) ?? own;
  };
  // The originals are called below with the `this` of the call that was intercepted.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const date = Date.prototype.toLocaleString;
  vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return date.call(this, resolve(locales), options);
  });
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const number = Number.prototype.toLocaleString;
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return number.call(this, resolve(locales), options);
  });
}
