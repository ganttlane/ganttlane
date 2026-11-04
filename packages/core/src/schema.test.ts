import * as v from 'valibot';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Link, Task } from './model';
import { LinkSchema as InternalLinkSchema, TaskSchema as InternalTaskSchema } from './model';
import * as schema from './schema';
import { LinkSchema, TaskSchema } from './schema';

/** Strips `readonly` everywhere (objects and arrays), keeping `Date` intact. */
type DeepMutable<T> = T extends Date
  ? T
  : T extends readonly (infer Item)[]
    ? DeepMutable<Item>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

describe('FR-DATA-13: @ganttlane/core/schema', () => {
  it('FR-DATA-13: the entry point exports the schemas of Task and Link, the ones the core checks with', () => {
    expect(Object.keys(schema).sort()).toEqual(['LinkSchema', 'TaskSchema']);
    // The public entry carries the same schemas as the core's boundary, not a copy that drifts.
    expect(TaskSchema).toBe(InternalTaskSchema);
    expect(LinkSchema).toBe(InternalLinkSchema);
  });

  it('FR-DATA-13: the schemas are the hand-written public types', () => {
    expectTypeOf<DeepMutable<v.InferInput<typeof TaskSchema>>>().toEqualTypeOf<DeepMutable<Task>>();
    expectTypeOf<DeepMutable<v.InferInput<typeof LinkSchema>>>().toEqualTypeOf<DeepMutable<Link>>();
  });

  it('FR-DATA-13: validates a response of an API before it reaches the chart', () => {
    const response: unknown = [
      { id: 1, name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 40 },
      { id: 2, name: 'Build', start: '2026-03-09', duration: '2w', dependencies: [1] },
    ];
    const bad: unknown = [{ id: 1, name: 5 }];

    const parsed = v.safeParse(v.array(TaskSchema), response);
    const rejected = v.safeParse(v.array(TaskSchema), bad);

    expect(parsed.success).toBe(true);
    expect(rejected.success).toBe(false);
    expect(rejected.issues?.[0]?.path?.map((item) => item.key)).toEqual([0, 'name']);
    expect(
      v.safeParse(LinkSchema, { source: 'a', target: 'b', type: 'SS', lag: '1d' }).success,
    ).toBe(true);
    expect(v.safeParse(LinkSchema, { source: 'a', target: 'b', type: 'XX' }).success).toBe(false);
  });

  it('FR-DATA-13: extends the payload of a task with your own schema', () => {
    const MyTaskSchema = v.object({
      ...TaskSchema.entries,
      data: v.object({ status: v.picklist(['done', 'active']) }),
    });

    const ok = v.safeParse(MyTaskSchema, { id: 'a', name: 'A', data: { status: 'done' } });
    const wrong = v.safeParse(MyTaskSchema, { id: 'a', name: 'A', data: { status: 'late' } });

    expect(ok.success).toBe(true);
    expect(wrong.success).toBe(false);
    expect(wrong.issues?.[0]?.path?.map((item) => item.key)).toEqual(['data', 'status']);
    expectTypeOf<v.InferOutput<typeof MyTaskSchema>['data']>().toEqualTypeOf<{
      status: 'done' | 'active';
    }>();
    // The extended schema still takes everything a Task takes.
    expectTypeOf<v.InferInput<typeof MyTaskSchema>['id']>().toEqualTypeOf<string | number>();
  });
});
