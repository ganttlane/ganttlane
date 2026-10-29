import { readFileSync } from 'node:fs';

import { patchTasks as fromCore } from '@ganttlane/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as core from './core';
import * as main from './index';

/** A source file without its whole-line comments (the re-exports are grouped by comments). */
const read = (path: string): string =>
  readFileSync(`${import.meta.dirname}/${path}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');

/** The names inside the braces of one import or export clause, as the module calls them. */
const names = (clause: string): string[] =>
  clause
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '');

/** The names of every `export type { … }` clause of a source file. */
const typesExportedBy = (source: string): string[] =>
  [...source.matchAll(/export\s+type\s+\{([^}]*)\}/g)].flatMap(([, clause = '']) => names(clause));

/** The names a file imports from `@ganttlane/dom` or `@ganttlane/core` as types. */
function typesImportedBy(source: string): string[] {
  const found: string[] = [];
  for (const [, typeOnly, clause = ''] of source.matchAll(
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@ganttlane\/(?:dom|core)'/g,
  )) {
    for (const part of clause.split(',')) {
      if (typeOnly !== undefined || part.trim().startsWith('type ')) found.push(...names(part));
    }
  }
  return found;
}

/**
 * What `@ganttlane/dom` exports as a type and this package does not: `Gantt`, which here is the
 * component (its ref is a `GanttHandle`), and the two types only `mountRenderer` takes and gives.
 */
const NOT_FOR_REACT = ['Gantt', 'MountedRenderer', 'RendererCore'];

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

  it('FR-REACT-1: an app that installed only @ganttlane/react can import every type its props and handle name', () => {
    // `@ganttlane/dom` exports every type that a declaration of its API names, however deep
    // (`index.types.test.ts` computes that set with the compiler), and the props and the handle
    // here are made of those declarations (`Omit<GanttOptions, …>`, `Omit<Gantt, 'destroy'>`).
    // So everything dom exports as a type is exported here too: the result of `updateTask`, the
    // payload of `onEditRefused`, the context of a slot, a view mode, a snapshot and what it holds.
    const exported = new Set(
      [read('core.ts'), read('index.ts')].flatMap((source) => typesExportedBy(source)),
    );
    const fromDom = typesExportedBy(read('../../dom/src/index.ts'));

    expect(fromDom.length).toBeGreaterThan(250);
    expect(
      fromDom.filter((name) => !exported.has(name) && !NOT_FOR_REACT.includes(name)).sort(),
    ).toEqual([]);
    // The exceptions are real ones.
    for (const name of NOT_FOR_REACT) expect(fromDom, name).toContain(name);
    expect(exported.has('MountedRenderer')).toBe(false);
    expect(exported.has('RendererCore')).toBe(false);
    expect(exported.has('GanttHandle')).toBe(true);
  });

  it('FR-REACT-1: the types the files of this package import from dom and core are exported from it', () => {
    // The declarations of this package itself: its props, handle, instance and slots.
    const needed = ['types.ts', 'slots.tsx', 'use-gantt-state.ts'].flatMap((file) =>
      typesImportedBy(read(file)),
    );
    const exported = new Set(
      [read('core.ts'), read('index.ts')].flatMap((source) => typesExportedBy(source)),
    );

    expect(needed.length).toBeGreaterThan(5);
    expect(
      [...new Set(needed)].filter((name) => !exported.has(name) && !NOT_FOR_REACT.includes(name)),
    ).toEqual([]);
  });

  it('FR-REACT-1: the types a handler or a method of the handle hands out are importable, and are those', () => {
    type Handle = main.GanttHandle;
    type Props = main.GanttProps;
    type Payload<K extends keyof Props> =
      NonNullable<Props[K]> extends (payload: infer P) => unknown ? P : never;

    expectTypeOf<main.UpdateTaskResult>().toEqualTypeOf<
      Awaited<ReturnType<Handle['updateTask']>>
    >();
    expectTypeOf<main.LinkCreateResult>().toEqualTypeOf<Awaited<ReturnType<Handle['addLink']>>>();
    expectTypeOf<main.LinkDeleteResult>().toEqualTypeOf<
      Awaited<ReturnType<Handle['removeLink']>>
    >();
    expectTypeOf<main.HistoryResult>().toEqualTypeOf<ReturnType<Handle['undo']>>();
    expectTypeOf<main.CommitResult>().toExtend<main.UpdateTaskResult>();
    expectTypeOf<Payload<'onEditRefused'>>().toEqualTypeOf<main.EditRefusedPayload>();
    expectTypeOf<Payload<'onIssues'>>().toEqualTypeOf<main.IssuesPayload>();
    expectTypeOf<main.Change>().toEqualTypeOf<main.ChangeSet['changes'][number]>();
    expectTypeOf<main.Conflict>().toEqualTypeOf<main.ChangeSet['conflicts'][number]>();
    expectTypeOf<main.ChangeSet['reason']>().toEqualTypeOf<main.ChangeReason>();
    expectTypeOf<main.Link['type']>().toEqualTypeOf<main.LinkType | undefined>();
    expectTypeOf<main.SnapRule>().not.toBeAny();
    expectTypeOf<main.BeforeTaskChangeHook>().toBeFunction();
    expectTypeOf<main.BeforeLinkCreateHook>().toBeFunction();
    // The hooks are props, and `confirm().then((ok) => ok)` is a hook (it is `Promise<boolean | void>`).
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    const confirm = (): Promise<boolean | void> => Promise.resolve();
    const props: main.GanttProps = {
      onBeforeTaskChange: () => confirm().then((ok) => ok),
      onBeforeLinkCreate: () => confirm().then((ok) => ok),
    };
    expect(Object.keys(props)).toEqual(['onBeforeTaskChange', 'onBeforeLinkCreate']);
  });

  it('FR-REACT-1: the types of the data and the events can be named from it', () => {
    const task: core.Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' };
    const changes: core.ChangeSet = { reason: 'api', changes: [], conflicts: [] };
    expect(task.id).toBe('a');
    expect(changes.reason).toBe('api');
    expectTypeOf<core.GanttEventMap>().toHaveProperty('tasksChange');
  });
});
