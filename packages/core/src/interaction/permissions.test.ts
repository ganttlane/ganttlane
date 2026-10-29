import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel, type Task } from '../model';
import { type EditingOption, resolvePermissions, type TaskPermissions } from './index';

const { calendar } = createWorkCalendar();
const BAR: Task = { id: 't', name: 'T', start: '2026-03-02', end: '2026-03-06' };

function permissions(task: Partial<Task>, editing?: EditingOption): string {
  const model = normalizeModel({ tasks: deepFreeze([{ ...BAR, ...task }]) }, { calendar });
  return text(resolvePermissions(model.taskById.get('t'), editing));
}

/** The allowed actions, e.g. `'move resize progress link'`; `'-'` for none. */
function text(allowed: TaskPermissions): string {
  const names = (['move', 'resize', 'progress', 'link'] as const).filter((key) => allowed[key]);
  return names.length === 0 ? '-' : names.join(' ');
}

describe('resolvePermissions', () => {
  const cases: readonly (readonly [string, Partial<Task>, EditingOption | undefined, string])[] = [
    ['everything by default', {}, undefined, 'move resize progress link'],
    ['editing: true', {}, true, 'move resize progress link'],
    ['editing: false turns everything off', {}, false, '-'],
    ['per global flag', {}, { resize: false, links: false }, 'move progress'],
    ['editing.progress: false', {}, { progress: false }, 'move resize link'],
    ['editable: false', { editable: false }, undefined, '-'],
    [
      'editable: true overrides a read-only chart',
      { editable: true },
      false,
      'move resize progress link',
    ],
    ['editable flags override per flag', { editable: { move: true } }, false, 'move'],
    [
      'editable flags inherit the others',
      { editable: { resize: false } },
      { move: false },
      'progress link',
    ],
    ['locked keeps links only', { locked: true }, undefined, 'link'],
    [
      'fixedDuration blocks resize, not move',
      { fixedDuration: true },
      undefined,
      'move progress link',
    ],
    ['linkable: false', { linkable: false }, undefined, 'move resize progress'],
    ['milestone: no resize, no progress', { type: 'milestone' }, undefined, 'move link'],
    ['placeholder: nothing', { type: 'placeholder' }, undefined, '-'],
    ['no dates: nothing', { start: undefined, end: undefined }, undefined, '-'],
  ];

  it.each(cases)('FR-EDIT-7: %s', (_name, task, editing, expected) => {
    expect(permissions(task, editing)).toBe(expected);
  });

  it('FR-EDIT-7: an unknown task may do nothing', () => {
    expect(text(resolvePermissions(undefined, true))).toBe('-');
  });

  it('FR-EDIT-7: reads only real booleans from malformed input', () => {
    const { span } = normalizeModel({ tasks: [BAR] }, { calendar }).taskById.get('t')!;
    const task = { ...BAR, editable: 'yes', locked: 1, linkable: 0 } as unknown as Task;
    const malformed = { links: null } as unknown as EditingOption;
    expect(text(resolvePermissions({ type: 'task', span, task }, malformed))).toBe(
      'move resize progress link',
    );
    expect(text(resolvePermissions({ type: 'task', span, task }, null as unknown as boolean))).toBe(
      'move resize progress link',
    );
  });
});
