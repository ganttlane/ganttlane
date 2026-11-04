import { fromFrappeGanttOptions, type MigratedOptions } from '@ganttlane/core/migrate';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { createGantt } from './create-gantt';
import type { GanttOptions } from './options';
import { createContainer, createManualFrames, stubScrollerSize } from './testing';

beforeEach(() => {
  vi.useFakeTimers();
  stubScrollerSize(800, 400);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('FR-DATA-10: the converted options of frappe-gantt go to createGantt', () => {
  it('FR-DATA-10: the options of the result are options of createGantt', () => {
    expectTypeOf<MigratedOptions>().toExtend<Partial<GanttOptions>>();
  });

  it('FR-DATA-10: createGantt takes the result with no issue, and draws by it', () => {
    const { options, unmapped } = fromFrappeGanttOptions({
      view_mode: 'Week',
      language: 'en',
      bar_height: 24,
      padding: 16,
      bar_corner_radius: 4,
      upper_header_height: 50,
      lower_header_height: 25,
      container_height: 300,
      arrow_curve: 6,
      lines: 'vertical',
      auto_move_label: false,
      show_expected_progress: false,
      today_button: false,
      view_mode_select: false,
      popup_on: 'hover',
      infinite_padding: false,
      scroll_to: 'start',
      readonly_dates: true,
      move_dependencies: false,
      snap_at: '7d',
      on_click: () => undefined,
    });
    const gantt = createGantt(createContainer(), {
      tasks: [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' }],
      renderer: { frames: createManualFrames() },
      now: () => '2026-03-04',
      ...options,
    });

    // The only thing left out is what the report says is left out.
    expect(unmapped.map(({ key }) => key)).toEqual(['on_click']);
    expect(gantt.getIssues().options).toEqual([]);
    const { layout } = gantt.core.getSnapshot();
    expect(layout.rows.rowHeight).toBe(40);
    expect(layout.rows.headerHeight).toBe(75);
    gantt.destroy();
  });
});
