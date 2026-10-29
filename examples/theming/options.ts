import type { GanttOptions } from '@ganttlane/dom';

/**
 * The size of rows and bars is not a token: it is the `layout` option, so a preset that changes
 * the density sets both halves, the tokens (type, line widths) in `styles.css` and these sizes.
 */
export const layouts = {
  comfortable: { rowHeight: 40, barHeight: 24, barRadius: 3, headerRowHeight: [45, 30] },
  compact: { rowHeight: 26, barHeight: 16, barRadius: 2, headerRowHeight: [26, 26] },
} satisfies Record<string, NonNullable<GanttOptions['layout']>>;

export const options = {
  // 'auto' (the default) follows `prefers-color-scheme`; 'light' and 'dark' force a theme. It is
  // only the `data-theme` attribute of the chart's root, so it can change at any time for free.
  theme: 'auto',
  // A fixed "today", so that the today line is on the plan whenever you read this. An application
  // leaves `now` out: the chart then uses the clock.
  now: () => '2026-03-18',
  // Zebra rows and one highlighted day: two more things the tokens colour.
  display: { rowStripes: 'row' },
  highlights: [{ id: 'freeze', dates: ['2026-03-24'], label: 'Code freeze' }],
  layout: layouts.comfortable,
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

/**
 * The presets of the example. `id` is the value of the container's `data-preset` attribute, which
 * `styles.css` selects on; `layout` is the density half of the preset.
 */
export const presets = [
  {
    id: 'default',
    label: 'Default',
    layout: layouts.comfortable,
    note: 'The library’s own tokens.',
  },
  {
    id: 'brand',
    label: 'Brand',
    layout: layouts.comfortable,
    note: 'Teal bars and links, an amber today line, a tinted header, in light and in dark.',
  },
  {
    id: 'compact',
    label: 'Compact',
    layout: layouts.compact,
    note: 'Smaller type, thinner lines, and shorter rows and bars (the layout option).',
  },
  {
    id: 'contrast',
    label: 'High contrast',
    layout: layouts.comfortable,
    note: 'Black on white, or white on black, with heavy lines and a bold today line.',
  },
] as const;

export type PresetId = (typeof presets)[number]['id'];
