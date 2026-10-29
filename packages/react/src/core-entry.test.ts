import { patchTasks as fromCore } from '@ganttlane/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as core from './core';
import * as main from './index';

describe('@ganttlane/react/core: the entry without the client directive', () => {
  it('FR-REACT-1: it exports patchTasks, the core’s own function, and nothing that is for React', () => {
    expect(core.patchTasks).toBe(fromCore);
    // Values only: no component, no hook. A server component may import all of it.
    expect(Object.keys(core)).toEqual(['patchTasks']);
  });

  it('FR-REACT-1: the main entry exports the same function, and the same types', () => {
    expect(main.patchTasks).toBe(core.patchTasks);
    expectTypeOf<core.ChangeSet>().toEqualTypeOf<main.ChangeSet>();
    expectTypeOf<core.Task<{ a: 1 }>>().toEqualTypeOf<main.Task<{ a: 1 }>>();
    expectTypeOf<core.SessionChanges>().toEqualTypeOf<main.SessionChanges>();
    expectTypeOf<core.TaskRecord>().toEqualTypeOf<main.TaskRecord>();
  });

  it('FR-REACT-1: the types of the data and the events can be named from it', () => {
    const task: core.Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' };
    const changes: core.ChangeSet = { reason: 'api', changes: [], conflicts: [] };
    expect(task.id).toBe('a');
    expect(changes.reason).toBe('api');
    expectTypeOf<core.GanttEventMap>().toHaveProperty('tasksChange');
  });
});
