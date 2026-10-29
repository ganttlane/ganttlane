import type { GanttStringsInput } from '@ganttlane/dom';

// The grammar belongs to the strings, so the plural rules are Ukrainian whatever the chart's
// `locale` is. The locale is only used for the numbers (`toLocaleString(locale)`).
const ukPlural = new Intl.PluralRules('uk');

const WORKING_DAYS: Record<Intl.LDMLPluralRule, string> = {
  zero: 'робочих днів',
  one: 'робочий день', // 1, 21, 31, …
  two: 'робочі дні',
  few: 'робочі дні', // 2–4, 22–24, …
  many: 'робочих днів', // 0, 5–20, 25–30, …
  other: 'робочого дня', // fractions: 2.5
};

/**
 * Every string the chart writes itself, in Ukrainian. A string that has a number or a name in it is
 * a function of the value and the chart's locale; the others are plain text.
 */
export const uk: GanttStringsInput = {
  // The `aria-label` of the chart's focusable scroll region.
  chartLabel: 'Діаграма Ганта',

  // The default tooltip of a task.
  progress: (percent, locale) => `${percent.toLocaleString(locale)}% виконано`,
  workingDays: (days, locale) =>
    `${days.toLocaleString(locale)} ${WORKING_DAYS[ukPlural.select(days)]}`,
  dateRange: (from, to) => `${from} — ${to}`,

  // The default menu of a link.
  linkTitle: (source, target) => `${source} → ${target}`,
  removeLink: 'Видалити залежність',

  // The toolbar and the view mode names are reserved: nothing draws them yet (the toolbar is
  // planned), but a translation can already have them.
  today: 'Сьогодні',
  zoomIn: 'Збільшити',
  zoomOut: 'Зменшити',
  viewMode: 'Режим перегляду',
  hour: 'Година',
  quarterDay: 'Чверть доби',
  halfDay: 'Півдоби',
  day: 'День',
  week: 'Тиждень',
  month: 'Місяць',
  quarter: 'Квартал',
  year: 'Рік',
};

/** Any subset works: two keys reword the link menu, and every other text stays as it was. */
export const linkMenuOnly: GanttStringsInput = {
  removeLink: 'Unlink these tasks',
  linkTitle: (source, target) => `${source}, then ${target}`,
};

/** One entry of the select: a set of strings, or none (`undefined`: English). */
export interface Wording {
  readonly id: string;
  readonly label: string;
  readonly strings: GanttStringsInput | undefined;
}

/** The sets of the example's select: the default, every string, and two. */
export const wordings: readonly [Wording, ...Wording[]] = [
  { id: 'en', label: 'English (the default)', strings: undefined },
  { id: 'uk', label: 'Ukrainian (every string)', strings: uk },
  { id: 'menu', label: 'Two strings (the link menu)', strings: linkMenuOnly },
];
