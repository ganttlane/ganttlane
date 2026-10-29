import type { GanttOptions } from '@ganttlane/dom';

/** What `timeline.infinite` can be: `false`, `true` for the defaults, or an object. */
type Infinite = NonNullable<GanttOptions['timeline']>['infinite'];

/** The settings the select offers, each with the value it puts in `timeline.infinite`. */
export const SETTINGS = [
  { id: 'off', label: 'false: a fixed range', infinite: false },
  { id: 'defaults', label: 'true: the defaults', infinite: true },
  {
    id: 'small',
    label: 'threshold 200, extendBy 1mo',
    // Grow sooner (200 px from the edge instead of a viewport width), and by a month at a time.
    infinite: { threshold: 200, extendBy: '1mo' },
  },
  {
    id: 'span',
    label: 'extendBy 1mo, maxSpan 6mo',
    // Never keep more than six months: the edge you scrolled away from is cut off.
    infinite: { extendBy: '1mo', maxSpan: '6mo' },
  },
  {
    id: 'bounds',
    label: 'bounds: 2026 only',
    // Grow, but never past these dates (a date-only `max` includes its whole day).
    infinite: { bounds: { min: '2026-01-01', max: '2026-12-31' } },
  },
] as const satisfies readonly { id: string; label: string; infinite: Infinite }[];

export const options = {
  viewMode: 'week',
  timeline: {
    // Off by default. With `true` the timeline grows by itself when the viewport gets within a
    // viewport width of an edge (`threshold`), by two viewport widths of time at a time
    // (`extendBy`), in both directions, and the date under the left edge stays where it is.
    infinite: true,
  },
  // Open on the plan, with the empty timeline before it in reach.
  scroll: { initial: 'first-task' },
  // Compact rows, so that every task fits without scrolling down.
  layout: { rowHeight: 32, barHeight: 20 },
} satisfies Partial<GanttOptions>;
