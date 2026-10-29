import { options } from './options';

/** The four sizes the sliders change. */
export interface Sizes {
  rowHeight: number;
  barHeight: number;
  barRadius: number;
  headerRowHeight: number;
}

/** The sliders: the option each one sets, its name and its range. */
export const SLIDERS = [
  { key: 'rowHeight', label: 'Row', min: 24, max: 80, step: 2 },
  { key: 'barHeight', label: 'Bar', min: 10, max: 80, step: 2 },
  { key: 'barRadius', label: 'Radius', min: 0, max: 20, step: 1 },
  { key: 'headerRowHeight', label: 'Header rows', min: 20, max: 60, step: 2 },
] as const satisfies readonly {
  key: keyof Sizes;
  label: string;
  min: number;
  max: number;
  step: number;
}[];

/** The two ways to give the chart a height in this example. */
export const HEIGHTS = ['fixed', 'auto'] as const;
export type HeightKind = (typeof HEIGHTS)[number];

/** The height of the chart in the `'fixed'` setting, in px: the one in the options. */
export const FIXED_HEIGHT = options.layout.height;

/**
 * Says which `layout` the controls amount to, and when the bar is clamped to its row.
 *
 * @param sizes - What the sliders hold.
 * @param height - What the height select holds.
 * @returns A sentence.
 */
export function describe(sizes: Sizes, height: HeightKind): string {
  const { rowHeight, barHeight, barRadius, headerRowHeight } = sizes;
  const clamped =
    barHeight > rowHeight
      ? `. A bar cannot be taller than its row: ${String(barHeight)} px is drawn as ${String(rowHeight)} px`
      : '';
  const shown = height === 'auto' ? "'auto'" : String(FIXED_HEIGHT);
  return `layout: { rowHeight: ${String(rowHeight)}, barHeight: ${String(barHeight)}, barRadius: ${String(barRadius)}, headerRowHeight: ${String(headerRowHeight)}, height: ${shown} }${clamped}`;
}
