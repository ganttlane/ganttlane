import type { GanttStringsInput } from '@ganttlane/dom';

/**
 * A Ukrainian pack of the chart's strings (FR-I18N-2), what `?strings=uk` and the locale `uk` of
 * the pickers turn on, on the vanilla and the React page: the plural of the working days is what
 * `Intl.PluralRules` says for the chart's locale.
 */
export const UKRAINIAN: GanttStringsInput = {
  chartLabel: 'Діаграма Ганта',
  progress: (percent, locale) => `${percent.toLocaleString(locale)}% виконано`,
  workingDays: (days, locale) => {
    const forms = {
      one: 'робочий день',
      few: 'робочі дні',
      many: 'робочих днів',
      other: 'робочого дня',
    } as const;
    const form = new Intl.PluralRules(locale).select(days);
    return `${days.toLocaleString(locale)} ${form in forms ? forms[form as keyof typeof forms] : forms.other}`;
  },
  dateRange: (from, to) => `${from} — ${to}`,
  linkTitle: (source, target) => `${source} → ${target}`,
  removeLink: 'Видалити залежність',
};
