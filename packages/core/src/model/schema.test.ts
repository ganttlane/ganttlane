import {
  edgeCases,
  type FixtureLink,
  type FixtureTask,
  generateFixture,
  sampleProject,
  type SampleProjectData,
} from '@ganttlane/fixtures';
import * as v from 'valibot';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { LinkSchema, TaskSchema } from './schema';
import type { Link, Task } from './types';

/** Strips `readonly` everywhere (objects and arrays), keeping `Date` intact. */
type DeepMutable<T> = T extends Date
  ? T
  : T extends readonly (infer Item)[]
    ? DeepMutable<Item>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

/** Paths of the issues of a failed parse, as `a.b[0]`. */
function issuePaths(schema: typeof TaskSchema | typeof LinkSchema, input: unknown): string[] {
  const result = v.safeParse(schema, input);
  return (result.issues ?? []).map((issue) =>
    (issue.path ?? [])
      .map((item) => {
        const key: unknown = item.key;
        return typeof key === 'number' ? `[${key}]` : `.${String(key)}`;
      })
      .join('')
      .replace(/^\./, ''),
  );
}

describe('model/schema types (ADR-016)', () => {
  it('FR-DATA-11: v.InferInput of TaskSchema and LinkSchema equals the hand-written types', () => {
    expectTypeOf<DeepMutable<v.InferInput<typeof TaskSchema>>>().toEqualTypeOf<DeepMutable<Task>>();
    expectTypeOf<DeepMutable<v.InferInput<typeof LinkSchema>>>().toEqualTypeOf<DeepMutable<Link>>();
  });

  it('FR-DATA-11: the fixtures keep their own types, compatible with Task and Link', () => {
    expectTypeOf<FixtureTask>().toExtend<Task>();
    expectTypeOf<FixtureTask<SampleProjectData>>().toExtend<Task<SampleProjectData>>();
    expectTypeOf<FixtureLink>().toExtend<Link>();
  });

  it('FR-DATA-6: Task is generic over its payload', () => {
    expectTypeOf<Task<{ status: 'done' }>['data']>().toEqualTypeOf<
      { status: 'done' } | undefined
    >();
    expectTypeOf<v.InferInput<typeof TaskSchema>['data']>().toEqualTypeOf<unknown>();
  });
});

describe('model/schema runtime (FR-DATA-11)', () => {
  it('accepts every fixture task and link', () => {
    const fixtures = [...edgeCases, sampleProject, generateFixture({ count: 300, seed: 3 })];
    for (const fixture of fixtures) {
      for (const task of fixture.tasks) expect(v.is(TaskSchema, task)).toBe(true);
      for (const link of fixture.links) expect(v.is(LinkSchema, link)).toBe(true);
    }
  });

  it('accepts the minimal task, explicit undefined fields and unknown keys', () => {
    expect(v.is(TaskSchema, { id: 0, name: '' })).toBe(true);
    expect(v.is(TaskSchema, { id: 'a', name: 'A', start: undefined, end: undefined })).toBe(true);
    expect(v.is(TaskSchema, { id: 'a', name: 'A', custom_class: 'x' })).toBe(true);
    expect(v.is(LinkSchema, { source: 0, target: 'b', lag: -1.5 })).toBe(true);
  });

  it('accepts every form of dates, durations, anchors, editing flags and dependencies', () => {
    const task: Task<{ n: number }> = {
      id: 1,
      name: 'All fields',
      start: new Date(2026, 2, 2),
      end: Date.UTC(2026, 2, 6),
      duration: { days: 2, hours: 4 },
      precision: 'time',
      durationMode: 'working',
      progress: 12.5,
      progressAnchor: 'end',
      type: 'milestone',
      parentId: 'p',
      parentAnchor: ['FS', 'FF'],
      followParent: true,
      locked: false,
      fixedDuration: true,
      linkable: false,
      editable: { move: false, links: true },
      className: 'a',
      rowClassName: 'b',
      color: 'red',
      progressColor: 'blue',
      description: 'text',
      dependencies: [0, 'x', { id: 2 }, { id: 'y', type: 'SS', lag: '4h' }, { id: 3, lag: -1 }],
      data: { n: 1 },
    };
    expect(v.is(TaskSchema, task)).toBe(true);
    expect(v.is(TaskSchema, { id: 1, name: 'x', parentAnchor: 'SF', editable: false })).toBe(true);
  });

  it('leaves NaN in date, duration and lag fields to the domain parsers', () => {
    expect(v.is(TaskSchema, { id: 1, name: 'x', start: Number.NaN, duration: Number.NaN })).toBe(
      true,
    );
    expect(v.is(TaskSchema, { id: 1, name: 'x', start: new Date(Number.NaN) })).toBe(true);
    expect(v.is(LinkSchema, { source: 1, target: 2, lag: Number.NaN })).toBe(true);
    // Ids and progress are plain numbers: NaN is a shape error there.
    expect(issuePaths(TaskSchema, { id: Number.NaN, name: 'x', progress: Number.NaN })).toEqual([
      'id',
      'progress',
    ]);
  });

  it('reports wrong field types with their paths', () => {
    expect(
      issuePaths(TaskSchema, {
        id: true,
        name: 5,
        start: {},
        duration: { days: '2' },
        precision: 'hour',
        type: 'bar',
        parentAnchor: ['FS', 'XX'],
        editable: { move: 'yes' },
        dependencies: [1, { id: {} }, { id: 2, type: 'XY' }],
        className: 1,
      }),
    ).toEqual([
      'id',
      'name',
      'start',
      'duration',
      'precision',
      'type',
      'parentAnchor',
      'editable',
      'className',
      'dependencies[1]',
      'dependencies[2]',
    ]);
    expect(issuePaths(TaskSchema, null)).toEqual(['']);
    expect(issuePaths(LinkSchema, { id: 1, source: null, type: 'XX', editable: 1 })).toEqual([
      'id',
      'source',
      'target',
      'type',
      'editable',
    ]);
  });

  it('rejects an explicit undefined inside a duration object (exact optional fields)', () => {
    expect(v.is(TaskSchema, { id: 1, name: 'x', duration: { days: 1, hours: undefined } })).toBe(
      false,
    );
  });

  it('FR-DATA-13: can be extended with a payload schema (docs/api.md §6a)', () => {
    const MyTaskSchema = v.object({
      ...TaskSchema.entries,
      data: v.object({ status: v.picklist(['done', 'active']) }),
    });
    expect(v.is(MyTaskSchema, { id: 1, name: 'x', data: { status: 'done' } })).toBe(true);
    expect(v.is(MyTaskSchema, { id: 1, name: 'x', data: { status: 'late' } })).toBe(false);
    expectTypeOf<v.InferOutput<typeof MyTaskSchema>['data']>().toEqualTypeOf<{
      status: 'done' | 'active';
    }>();
  });
});
