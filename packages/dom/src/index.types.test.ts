import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicTypesOf } from './testing/public-types';

/**
 * The files whose exported signatures are the package's public type surface: the facade, the
 * options, the renderer and the layer and popover types.
 */
const PUBLIC_SURFACE = [
  'create-gantt.ts',
  'display.ts',
  'options.ts',
  'renderer.ts',
  'layers/types.ts',
  'layers/popover/types.ts',
];

/** A source file without its whole-line comments (the re-exports are grouped by comments). */
const read = (file: string): string =>
  readFileSync(`${import.meta.dirname}/${file}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');

/** The names inside the braces of one import or export clause. */
const names = (clause: string): string[] =>
  clause
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '');

/** The types a source file imports from `@ganttlane/core` (`import type { … }` or `type X`). */
function coreTypesImportedBy(source: string): string[] {
  const found: string[] = [];
  for (const [, typeOnly, clause = ''] of source.matchAll(
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@ganttlane\/core'/g,
  )) {
    for (const name of clause.split(',').map((part) => part.trim())) {
      if (typeOnly !== undefined || name.startsWith('type ')) found.push(...names(name));
    }
  }
  return found;
}

/** The types `index.ts` re-exports from `@ganttlane/core`. */
function coreTypesReexported(source: string): string[] {
  return [...source.matchAll(/export\s+type\s+\{([^}]*)\}\s+from\s+'@ganttlane\/core'/g)].flatMap(
    ([, clause = '']) => names(clause),
  );
}

describe('@ganttlane/dom public types', () => {
  it('FR-API-1: every core type a public signature names can be imported from @ganttlane/dom', () => {
    const reexported = new Set(coreTypesReexported(read('index.ts')));
    const needed = PUBLIC_SURFACE.flatMap((file) => coreTypesImportedBy(read(file)));

    expect(needed.length).toBeGreaterThan(10);
    expect([...new Set(needed)].filter((name) => !reexported.has(name)).sort()).toEqual([]);
  });

  it('FR-API-1: the data, the changes, the events and the issues of the docs are there too', () => {
    const reexported = new Set(coreTypesReexported(read('index.ts')));

    for (const name of [
      'Task',
      'TaskRecord',
      'TaskId',
      'Link',
      'LinkRecord',
      'ChangeSet',
      'Issue',
      'OptionIssue',
      'GanttEventMap',
      'GanttEventName',
      'GanttCore',
      'GanttSnapshot',
      'SessionChanges',
      'IssuesPayload',
      'ViewMode',
      'DateInput',
    ]) {
      expect(reexported.has(name), name).toBe(true);
    }
  });

  it('FR-API-1: every type a public declaration of the package names, however deep, can be imported from @ganttlane/dom (ADR-026)', () => {
    // The walk starts at what the entry declares (`Gantt`, `GanttOptions`, the layer and popover
    // types, `createGantt`, …) and follows every type name in the declarations it reaches into
    // the core: the results of `addLink` and `undo`, the payloads of the events, the pieces of an
    // option. The import check above sees only the names a file writes itself.
    const { named, exported, unexported } = publicTypesOf(`${import.meta.dirname}/..`);

    // The walk reaches the nested names, also those that the compiler would flatten away
    // (`CommitResult` is a member of the union `UpdateTaskResult`).
    expect([...named.keys()]).toEqual(
      expect.arrayContaining([
        'core:LinkCreateResult',
        'core:LinkDeleteResult',
        'core:CommitResult',
        'core:HistoryResult',
        'core:BeforeTaskChangeHook',
        'core:Awaitable',
        'dom:GanttOptions',
      ]),
    );
    const missing = [...named]
      .map(([key, chain]) => ({ name: key.slice(key.indexOf(':') + 1), chain }))
      .filter(({ name }) => !exported.has(name))
      .map(({ name, chain }) => `${name} (${chain})`);
    expect(missing.sort()).toEqual([]);
    // And no public declaration names a type that its own package does not export at all.
    expect([...unexported].map(([key, chain]) => `${key} (${chain})`)).toEqual([]);
  });

  it('FR-API-1: only types are re-exported from core, no value (the entry stays free of core code)', () => {
    const source = read('index.ts');

    // `VERSION` is the one value `@ganttlane/dom` takes from core, on purpose.
    expect([...source.matchAll(/export\s+\{([^}]*)\}\s+from\s+'@ganttlane\/core'/g)]).toHaveLength(
      1,
    );
    expect(source).toMatch(/export \{ VERSION \} from '@ganttlane\/core'/);
  });
});
