import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The scale of the timeline, one of the seven presets: 'hour', 'quarter-day', 'half-day', 'day',
  // 'week', 'month' or 'year'. `setViewMode(id)` changes it later without recreating the chart.
  viewMode: 'week',
  scheduling: {
    // The step of the data. The hour preset snaps a drag to 15 minutes and the quarter-day and
    // half-day presets to one hour, but a snap step is never finer than the granularity: at the
    // default, '1d', every preset below the day would snap to a whole day.
    granularity: '15min',
  },
  // Open on launch day, with 11:00 (the middle of its run sheet) in the middle of the chart.
  // Switching the view mode keeps the moment in the middle where it is
  // (`setViewMode(id, { keepScroll: false })` scrolls like at mount instead).
  scroll: { initial: '2026-04-14T11:00', align: 'center' },
  // Compact rows, so that every task fits without scrolling down.
  layout: { rowHeight: 32, barHeight: 20 },
} satisfies Partial<GanttOptions>;
