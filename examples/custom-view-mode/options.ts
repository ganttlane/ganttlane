import type { GanttOptions } from '@ganttlane/dom';

/** The ids of the view modes below, for the select. */
export const VIEW_MODES = ['day', 'week', 'sprint', 'quarter'] as const;

export const options = {
  // A view mode of our own, defined below.
  viewMode: 'sprint',
  // `viewModes` is an object keyed by view mode id. An id of a preset (`day`, `week`, ...) is an
  // override: it is merged over the preset, and each field it gives replaces the preset's.
  // Any other id is a new view mode, which has to be complete: `unit`, `pxPerDay` and `headers`.
  viewModes: {
    day: {
      // Wider columns: pixels per day (the preset is 40).
      pxPerDay: 64,
      // Header rows, top first; a list replaces the preset's list as a whole. `format` is the
      // options of an `Intl.DateTimeFormat`, so it follows the chart's `locale`.
      headers: [
        { unit: 'month', format: { month: 'long', year: 'numeric' } },
        { unit: 'day', format: { weekday: 'short', day: 'numeric' } },
      ],
      // Timeline before and after the data (the preset is '14d').
      padding: '30d',
    },
    week: {
      // `false` takes away what the preset has: no thick line at the start of each month.
      majorLine: false,
      // A drag moves a bar by whole weeks (the preset snaps to '1d').
      snap: '1w',
    },
    // A new view mode: a fortnight per column.
    sprint: {
      label: 'Sprint',
      // One column is `step` units: two weeks. A `unit` of 'quarter' is only for modes of your own.
      unit: 'week',
      step: 2,
      pxPerDay: 12,
      headers: [
        { unit: 'month', format: { month: 'long', year: 'numeric' } },
        {
          unit: 'week',
          step: 2,
          // Or a function for the cell: it is given the cell's range (`start`, and `end`, which is
          // exclusive), the chart's locale and its date adapter. Sprint 1 started on 12 January.
          format: (range, locale, adapter) => {
            const sprintOne = adapter.fromParts({ year: 2026, month: 1, day: 12 });
            const sprint = Math.floor(adapter.diffDays(sprintOne, range.start) / 14) + 1;
            const day = { day: 'numeric', month: 'short' } as const;
            const first = adapter.format(range.start, day, locale);
            const last = adapter.format(adapter.add(range.end, -1, 'day'), day, locale);
            return `Sprint ${String(sprint)} · ${first} – ${last}`;
          },
        },
      ],
      // A thick grid line at the start of every month, between the columns too.
      majorLine: { unit: 'month' },
      // A faint line every week, inside a column.
      minorLine: '1w',
      snap: '1d',
      // `[before, after]`: a short lead-in, and room for what comes next.
      padding: ['2w', '6w'],
    },
    // Another one, with a unit that no preset has.
    quarter: {
      label: 'Quarter',
      unit: 'quarter',
      pxPerDay: 3,
      headers: [
        { unit: 'year', format: { year: 'numeric' } },
        {
          unit: 'quarter',
          format: (range, _locale, adapter) =>
            `Q${String(Math.floor((adapter.getParts(range.start).month - 1) / 3) + 1)}`,
        },
      ],
      majorLine: { unit: 'year' },
      snap: '1w',
      padding: '1q',
    },
  },
  // Open on the first task: the default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },
  // Compact rows, so that every task fits without scrolling down.
  layout: { rowHeight: 34, barHeight: 22 },
} satisfies Partial<GanttOptions>;
