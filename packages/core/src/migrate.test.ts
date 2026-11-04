import { describe, expect, expectTypeOf, it } from 'vitest';

import { createGanttCore, type GanttCoreOptions } from './index';
import * as migrate from './migrate';
import {
  type FrappeGanttConversion,
  fromFrappeGanttOptions,
  type MigratedOptions,
} from './migrate';

const fn = (): undefined => undefined;

/**
 * One value that is not the default for every option and event of the public frappe-gantt
 * library (its `defaults.js`, `index.js` and `bar.js`).
 */
const SAMPLES: Readonly<Record<string, unknown>> = {
  view_mode: 'Week',
  view_modes: ['Day', 'Week'],
  column_width: 100,
  snap_at: '1d',
  language: 'uk',
  bar_height: 20,
  padding: 10,
  bar_corner_radius: 2,
  upper_header_height: 40,
  lower_header_height: 20,
  container_height: 400,
  arrow_curve: 3,
  lines: 'none',
  auto_move_label: true,
  show_expected_progress: true,
  today_button: false,
  view_mode_select: true,
  date_format: 'YYYY',
  hover_on_date: true,
  ignore: ['weekend'],
  is_weekend: fn,
  holidays: { red: ['2026-03-04'] },
  readonly: true,
  readonly_dates: true,
  readonly_progress: true,
  fixed_duration: true,
  move_dependencies: false,
  popup: fn,
  popup_on: 'hover',
  scroll_to: 'start',
  infinite_padding: false,
  on_click: fn,
  on_double_click: fn,
  on_hover: fn,
  on_date_change: fn,
  on_progress_change: fn,
  on_view_change: fn,
  on_date_click: fn,
};

describe('FR-DATA-10: @ganttlane/core/migrate', () => {
  it('FR-DATA-10: the entry point exports the adapter and nothing else', () => {
    expect(Object.keys(migrate)).toEqual(['fromFrappeGanttOptions']);
  });

  it('FR-DATA-10: nothing is dropped silently: every option and event is in the options, the notes or the report', () => {
    expect(Object.keys(SAMPLES)).toHaveLength(38);
    for (const [name, value] of Object.entries(SAMPLES)) {
      const { options, notes, unmapped } = fromFrappeGanttOptions({ [name]: value });
      const said =
        Object.keys(options).length > 0 ||
        notes.some(({ key }) => key === name) ||
        unmapped.some(({ key }) => key === name || key.startsWith(`${name}[`));
      expect(said, name).toBe(true);
    }
  });

  it('FR-DATA-10: the whole set at once keeps every key accounted for', () => {
    const { options, notes, unmapped } = fromFrappeGanttOptions(SAMPLES);
    const reported = new Set([...notes, ...unmapped].map(({ key }) => key));

    // The options that became options are not reported as unconverted.
    for (const name of ['view_mode', 'language', 'bar_height', 'lines', 'snap_at', 'readonly']) {
      expect(reported.has(name) && unmapped.some(({ key }) => key === name), name).toBe(false);
    }
    expect(options).toMatchObject({
      viewMode: 'week',
      locale: 'uk',
      editing: false,
      scheduling: { snap: '1d', propagation: 'none' },
    });
  });

  it('FR-DATA-10: the result is options that the core takes without an issue', () => {
    const { options } = fromFrappeGanttOptions({
      view_mode: 'Week',
      view_modes: [{ name: 'Week', step: '7d', column_width: 140, padding: '1m', snap_at: '1d' }],
      language: 'uk',
      bar_height: 24,
      padding: 16,
      bar_corner_radius: 4,
      upper_header_height: 50,
      lower_header_height: 25,
      container_height: 'auto',
      arrow_curve: 6,
      lines: 'vertical',
      today_button: false,
      popup_on: 'hover',
      infinite_padding: true,
      scroll_to: 'start',
      readonly_dates: true,
      move_dependencies: false,
      snap_at: '7d',
    });
    const gantt = createGanttCore({
      tasks: [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' }],
      ...(options as Partial<GanttCoreOptions>),
    });

    // `display`, `toolbar`, `tooltip` and `layout.height` are the renderer's: the development
    // build of the core says it does not know them, and nothing else.
    expect(gantt.getIssues().options.map(({ code, path }) => [code, path])).toEqual([
      ['unknown-option', 'display'],
      ['unknown-option', 'toolbar'],
      ['unknown-option', 'tooltip'],
    ]);
    expect(gantt.getSnapshot().layout.rows.rowHeight).toBe(40);
    gantt.destroy();
  });

  it('FR-DATA-10: the options of the result are valid options of the core', () => {
    expectTypeOf<MigratedOptions>().toExtend<Partial<GanttCoreOptions>>();
    expectTypeOf(fromFrappeGanttOptions).returns.toEqualTypeOf<FrappeGanttConversion>();
  });
});
