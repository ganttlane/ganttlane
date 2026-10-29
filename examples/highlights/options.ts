import type { GanttOptions, HighlightInput } from '@ganttlane/dom';

/**
 * Highlighted days are for the eye only: they change no date and no calendar. Each one has an `id`
 * and some days, from `dates`, a `range` (both ends included), a `match` predicate, or all three.
 */
export const HIGHLIGHTS: HighlightInput[] = [
  {
    id: 'offsite',
    // A run of days, both ends included.
    range: { start: '2026-03-09', end: '2026-03-11' },
    // The text of the label that shows when you hover a day of it.
    label: 'Team offsite',
    // The colour of its days, as a CSS colour (`--gantt-highlight-color`).
    color: '#3b82f6',
  },
  {
    id: 'demo',
    // Single days.
    dates: ['2026-03-04', '2026-03-18'],
    label: 'Demo day',
    color: '#2f9e44',
  },
  {
    id: 'freeze',
    range: { start: '2026-03-23', end: '2026-03-26' },
    label: 'Code freeze',
    color: '#e5484d',
  },
];

/** A highlight that is a rule: every Friday. The select adds it to the list and takes it out. */
export const FRIDAYS: HighlightInput = {
  id: 'retro',
  // Asked about every day on the screen; `weekday` is 0 for Sunday, so Friday is 5.
  match: (day) => day.weekday === 5,
  // A function gives each day its own label.
  label: (day) => `Retro, ${String(day.day)}/${String(day.month)}`,
  // An extra class on the days of this highlight, which `styles.css` makes paler.
  className: 'is-retro',
};

/** What the select of non-working days offers, and the value each puts in `display.nonWorkingDays`. */
export const NON_WORKING_DAYS = [
  { label: "'fill'", value: 'fill' },
  { label: "'stripes'", value: 'stripes' },
  { label: 'false', value: false },
] as const;

export const options = {
  viewMode: 'week',
  calendar: {
    // A day off with a name. Like the weekends it is a non-working day (a scheduling rule that
    // `display.nonWorkingDays` draws), and its name shows up on hover next to the highlights'.
    holidays: [{ date: '2026-03-20', name: 'Public holiday' }],
  },
  // The list of highlighted days. A new list replaces the old one.
  highlights: [...HIGHLIGHTS, FRIDAYS],
  display: {
    // How non-working days (the weekends and the holidays) are drawn: 'fill' (the default),
    // 'stripes' or `false` for not at all.
    nonWorkingDays: 'fill',
    // Whether the highlighted days are drawn at all (the default).
    highlights: true,
  },
  // The label of a highlighted or holiday day stays where it opened (the default), or follows
  // the cursor.
  highlightTooltip: { followCursor: false },
  scroll: { initial: 'first-task' },
  // Compact rows, so that every task fits without scrolling down.
  layout: { rowHeight: 32, barHeight: 20 },
} satisfies Partial<GanttOptions>;
