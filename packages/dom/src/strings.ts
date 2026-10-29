/**
 * Every piece of text the renderer writes on its own, so that it can be translated or reworded
 * (FR-I18N-2). The defaults are English; override any subset with the `strings` renderer option
 * (`mountRenderer`) or `MountedRenderer.setStrings`.
 *
 * Text that comes from the application (task names, highlight and holiday labels, the output of
 * `tooltip.render`) is not here, and neither are core's issue messages (developer-facing).
 * Dates and numbers are not here either: they are formatted for the chart's `locale` with `Intl`
 * (the header by core, the tooltip's dates by the tooltip). A string that puts a number or a
 * name into a sentence is a function: it gets the values and the chart's locale, and does the
 * grammar, plurals included (`new Intl.PluralRules(locale).select(days)`).
 */
export interface GanttStrings {
  /** The chart's accessible name: the `aria-label` of the focusable scroller region. */
  readonly chartLabel: string;

  // ---- the default task tooltip ----

  /** The progress line. `percent` is `0` … `100`, a whole number. */
  readonly progress: (percent: number, locale: string) => string;
  /**
   * The length line, in working days: `days` is rounded to one decimal (a task with a time of
   * day has fractions). It is a plural: `1` is not `2`, and many languages have more forms.
   */
  readonly workingDays: (days: number, locale: string) => string;
  /** The dates line of a task that spans more than one moment: `from` and `to` are formatted. */
  readonly dateRange: (from: string, to: string, locale: string) => string;

  // ---- the default link menu ----

  /** The title of the menu: the names of the two tasks a link joins, in its direction. */
  readonly linkTitle: (source: string, target: string, locale: string) => string;
  /** The action that removes the link. */
  readonly removeLink: string;

  // ---- the toolbar (reserved for P1: nothing draws these yet) ----

  /** The button that scrolls to today. */
  readonly today: string;
  /** The button that zooms in. */
  readonly zoomIn: string;
  /** The button that zooms out. */
  readonly zoomOut: string;
  /** The name of the view mode switcher. */
  readonly viewMode: string;

  // ---- view mode names (reserved for P1, the switcher's items; `quarterDay` is `quarter-day`) ----

  readonly hour: string;
  readonly quarterDay: string;
  readonly halfDay: string;
  readonly day: string;
  readonly week: string;
  readonly month: string;
  readonly quarter: string;
  readonly year: string;
}

/**
 * The `strings` option: any subset of {@link GanttStrings}. A key that is not one of them is
 * ignored. A value of the wrong kind (a function where a string goes, or the other way round, or
 * an empty string) is not ignored: it puts the key's default back, as `undefined` does (what was
 * set before for that key is gone).
 */
export type GanttStringsInput = {
  readonly [K in keyof GanttStrings]?: GanttStrings[K] | undefined;
};

/**
 * A number for a sentence, in the chart's locale; English where the runtime does not have it
 * (`Intl` would use the runtime's own locale for a tag it does not know, such as `'xx'`).
 */
const count = (value: number, locale: string, options?: Intl.NumberFormatOptions): string =>
  value.toLocaleString([locale, 'en'], options);

/**
 * The built-in strings, English; frozen. Grammar is English too, whatever the chart's locale: the
 * locale only formats the numbers, so a translation replaces the functions, not the locale.
 */
export const DEFAULT_STRINGS: GanttStrings = Object.freeze<GanttStrings>({
  chartLabel: 'Gantt chart',
  progress: (percent, locale) =>
    `${count(percent / 100, locale, { style: 'percent', maximumFractionDigits: 0 })} done`,
  workingDays: (days, locale) =>
    `${count(days, locale, { maximumFractionDigits: 1 })} working ${days === 1 ? 'day' : 'days'}`,
  dateRange: (from, to) => `${from} – ${to}`,
  linkTitle: (source, target) => `${source} → ${target}`,
  removeLink: 'Remove dependency',
  today: 'Today',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  viewMode: 'View mode',
  hour: 'Hour',
  quarterDay: 'Quarter day',
  halfDay: 'Half day',
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
});

/**
 * Resolves the `strings` option: the fields of `patch` merged over `base`, a value of the wrong
 * kind replaced by its default. Returns `base` itself when nothing changes, so layers can compare
 * `context.strings` by identity, like `context.display`.
 *
 * @param patch - New values; a key left out keeps its value in `base`.
 * @param base - The current strings. Default {@link DEFAULT_STRINGS}.
 * @returns The resolved strings, frozen.
 */
export function resolveStrings(
  patch: GanttStringsInput | undefined,
  base: GanttStrings = DEFAULT_STRINGS,
): GanttStrings {
  // Not an object (`null`, a string, …): untyped callers get no change, not a TypeError.
  if (typeof patch !== 'object' || (patch as unknown) === null) return base;
  let next: { -readonly [K in keyof GanttStrings]: GanttStrings[K] } | undefined;
  for (const key of Object.keys(DEFAULT_STRINGS) as (keyof GanttStrings)[]) {
    if (!(key in patch)) continue;
    const value: unknown = patch[key];
    const fallback = DEFAULT_STRINGS[key];
    const used = (typeof value === typeof fallback && value !== '' ? value : fallback) as never;
    if (used === base[key]) continue;
    next ??= { ...base };
    next[key] = used;
  }
  return next ? Object.freeze(next) : base;
}
