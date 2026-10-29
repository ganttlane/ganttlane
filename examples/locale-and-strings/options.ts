import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // A BCP 47 tag: how dates and numbers are written, in the header and in the tooltip. The default
  // is 'en' (not the browser's language, so that a server and a browser draw the same text). The
  // `strings` option is separate, see `strings.ts`: it is what the chart says, in whose words.
  locale: 'en',
  // The header rows are month and week range: both come from the locale.
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

/** The locales of the select: a tag and the name of the language, in that language. */
export const locales = [
  ['en', 'English'],
  ['uk', 'Українська'],
  ['de', 'Deutsch'],
  ['ja', '日本語'],
  ['th-TH-u-ca-buddhist', 'ไทย (Buddhist calendar)'],
] as const;
