import { describe, expect, it } from 'vitest';

import { createGanttCore } from './core';
import { OPTION_INVALIDATION } from './options';
import type { GanttCoreOptionsPatch } from './types';

/**
 * The names of the options and events of the public frappe-gantt library (its `defaults.js`,
 * `index.js` and `bar.js`), the way a person migrating brings them along.
 */
const FRAPPE_OPTIONS = [
  'view_mode',
  'view_modes',
  'column_width',
  'snap_at',
  'language',
  'bar_height',
  'padding',
  'bar_corner_radius',
  'upper_header_height',
  'lower_header_height',
  'container_height',
  'arrow_curve',
  'lines',
  'auto_move_label',
  'show_expected_progress',
  'today_button',
  'view_mode_select',
  'date_format',
  'hover_on_date',
  'ignore',
  'is_weekend',
  'holidays',
  'readonly',
  'readonly_dates',
  'readonly_progress',
  'fixed_duration',
  'move_dependencies',
  'popup',
  'popup_on',
  'scroll_to',
  'infinite_padding',
  'on_click',
  'on_double_click',
  'on_hover',
  'on_date_change',
  'on_progress_change',
  'on_view_change',
  'on_date_click',
] as const;

const TASKS = [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-04' }];

function created(extra: object = {}): ReturnType<typeof createGanttCore> {
  return createGanttCore({ tasks: TASKS, ...extra });
}

describe('FR-DATA-12: unknown options in the development build', () => {
  // These tests run from the sources, which are the development build (`DEV`); the production
  // build is checked on its bundle in `production.test.ts`.

  it('FR-DATA-12: a key of frappe-gantt is a warning that says where the option lives now', () => {
    const gantt = created({ bar_height: 24 });

    const found = gantt.getIssues().options;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'unknown-option',
      severity: 'warning',
      path: 'bar_height',
      value: 24,
    });
    expect(found[0]?.message).toContain(
      'bar_height: is an option of frappe-gantt; here it is layout.barHeight',
    );
    gantt.destroy();
  });

  it('FR-DATA-12: every option and event of frappe-gantt has a hint, and the hint names where it went', () => {
    for (const name of FRAPPE_OPTIONS) {
      const gantt = created({ [name]: 1 });
      const [found, ...rest] = gantt.getIssues().options;
      expect(rest, name).toEqual([]);
      expect(found?.code, name).toBe('unknown-option');
      expect(found?.path, name).toBe(name);
      // A hint, not the bare "is not an option": the key is one the library knows.
      expect(found?.message, name).not.toContain('is not an option');
      expect(found?.message, name).toMatch(/frappe-gantt/);
      gantt.destroy();
    }
  });

  it('FR-DATA-12: an option that ganttlane does not have says why, and a misspelling says it is ignored', () => {
    const gantt = created({ date_format: 'YYYY', on_date_click: () => undefined, tasks_: [] });
    const messages = gantt.getIssues().options.map(({ message }) => message);

    expect(messages[0]).toContain(
      'date_format: is an option of frappe-gantt that ganttlane does not have',
    );
    expect(messages[1]).toContain('there is no date-click event');
    expect(messages[2]).toBe('tasks_: is not an option, it is ignored');
    gantt.destroy();
  });

  it('FR-DATA-12: the warning goes where the other issues of the options go: setOptions, the issues event and onIssues', () => {
    const seen: string[][] = [];
    const gantt = created({
      onIssues: ({ source, issues }: { source: string; issues: readonly { path?: string }[] }) => {
        if (source === 'options') seen.push(issues.map(({ path }) => path ?? ''));
      },
    });
    expect(seen).toEqual([]);

    const returned = gantt.setOptions({ popup_on: 'hover' } as GanttCoreOptionsPatch);

    expect(returned.map(({ code }) => code)).toEqual(['unknown-option']);
    expect(seen).toEqual([['popup_on']]);
    gantt.destroy();
  });

  it('FR-DATA-12: a key is reported once, and clears when it is set to undefined', () => {
    const gantt = created({ bar_height: 24 });
    gantt.setOptions({ bar_height: 30 } as GanttCoreOptionsPatch);
    expect(gantt.getIssues().options).toHaveLength(1);
    expect(gantt.getIssues().options[0]?.value).toBe(30);

    gantt.setOptions({ bar_height: undefined } as GanttCoreOptionsPatch);

    expect(gantt.getIssues().options).toEqual([]);
    gantt.destroy();
  });

  it('FR-DATA-12: the key is ignored, as it always was', () => {
    const plain = created();
    const withUnknown = created({ bar_height: 90, padding: 40, lines: 'none' });

    expect(withUnknown.getSnapshot().layout.rows.rowHeight).toBe(
      plain.getSnapshot().layout.rows.rowHeight,
    );
    plain.destroy();
    withUnknown.destroy();
  });

  it('FR-DATA-12: no option of the core, handler or hook is reported', () => {
    // Every key, each at its default (`undefined`); `tasks` is the one that has none.
    const known: Record<string, unknown> = Object.fromEntries(
      Object.keys(OPTION_INVALIDATION).map((key) => [key, key === 'tasks' ? [] : undefined]),
    );
    const gantt = created({
      ...known,
      onTaskClick: () => undefined,
      onTasksChange: () => undefined,
      onIssues: () => undefined,
      onError: () => undefined,
      onBeforeTaskChange: () => undefined,
      onBeforeLinkCreate: () => undefined,
    });

    expect(gantt.getIssues().options).toEqual([]);
    gantt.destroy();
  });

  it('FR-DATA-12: a handler of an event that does not exist is reported', () => {
    const gantt = created({ onTooltip: () => undefined });

    expect(gantt.getIssues().options.map(({ path }) => path)).toEqual(['onTooltip']);
    gantt.destroy();
  });
});
