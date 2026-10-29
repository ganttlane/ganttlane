/* eslint-disable @typescript-eslint/no-invalid-void-type -- these tests are about hooks whose answer may be `void` */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ChangeSet } from '../schedule';
import {
  type Awaitable,
  type BeforeLinkCreateHook,
  type BeforeLinkCreateResult,
  type BeforeTaskChangeContext,
  type BeforeTaskChangeHook,
  type BeforeTaskChangeResult,
  createHooks,
} from './index';

describe('hook types', () => {
  it('FR-TX-2, FR-LINK-6: any function answering a result, a promise of one or nothing is a hook', () => {
    function log(_context: BeforeTaskChangeContext): void {}
    async function wait(_context: BeforeTaskChangeContext): Promise<void> {
      await Promise.resolve();
    }
    expectTypeOf(log).toExtend<BeforeTaskChangeHook>();
    expectTypeOf(wait).toExtend<BeforeTaskChangeHook>();
    expectTypeOf(() => false).toExtend<BeforeTaskChangeHook>();
    expectTypeOf(async () => Promise.resolve(true)).toExtend<BeforeLinkCreateHook>();
    expectTypeOf(() => 42).not.toExtend<BeforeTaskChangeHook>();
    expectTypeOf(() => 'yes').not.toExtend<BeforeLinkCreateHook>();
  });
});

describe('hook return types', () => {
  // What `confirm().then((ok) => ok)` is when `confirm` resolves to a boolean, or to nothing.
  const confirm = (): Promise<boolean | void> => Promise.resolve();

  it('FR-TX-2, FR-LINK-6: a hook may answer a promise of an answer-or-nothing', () => {
    const task: BeforeTaskChangeHook = () => confirm().then((ok) => ok);
    const link: BeforeLinkCreateHook = () => confirm().then((ok) => ok);
    expectTypeOf(task).returns.toEqualTypeOf<Awaitable<BeforeTaskChangeResult | void>>();
    expectTypeOf(link).returns.toEqualTypeOf<Awaitable<BeforeLinkCreateResult | void>>();
    expectTypeOf(async () => (await confirm()) ?? true).toExtend<BeforeTaskChangeHook>();
    expectTypeOf(confirm).toExtend<BeforeTaskChangeHook>();
    expectTypeOf(confirm).toExtend<BeforeLinkCreateHook>();
    // A change set is an answer of the task hook only; nothing else widened.
    expectTypeOf(async (): Promise<ChangeSet | void> =>
      Promise.resolve(),
    ).toExtend<BeforeTaskChangeHook>();
    expectTypeOf(async (): Promise<ChangeSet | void> =>
      Promise.resolve(),
    ).not.toExtend<BeforeLinkCreateHook>();
    expectTypeOf(async (): Promise<number | void> =>
      Promise.resolve(),
    ).not.toExtend<BeforeTaskChangeHook>();
    expectTypeOf(async (): Promise<string | void> =>
      Promise.resolve(),
    ).not.toExtend<BeforeLinkCreateHook>();
  });

  it('FR-TX-2: what the declared types before the widening accepted is still accepted', () => {
    const accepted: BeforeTaskChangeHook[] = [
      () => undefined,
      () => true,
      () => false,
      async () => Promise.resolve(true),
      async () => Promise.resolve(),
      () => Promise.resolve<BeforeTaskChangeResult>(undefined),
      (context) => context.changeSet,
      async (context) => Promise.resolve(context.changeSet),
    ];
    expect(accepted).toHaveLength(8);
  });
});

describe('createHooks', () => {
  it('FR-TX-2: chains hooks in registration order; each registration is its own', () => {
    const hooks = createHooks();
    const a: BeforeTaskChangeHook = () => undefined;
    const b: BeforeTaskChangeHook = () => true;
    const removeA = hooks.add('beforeTaskChange', a);
    hooks.add('beforeTaskChange', b);
    hooks.add('beforeTaskChange', a);
    hooks.add('beforeLinkCreate', () => false);
    expect([...hooks.chain('beforeTaskChange')]).toEqual([a, b, a]);
    expectTypeOf([...hooks.chain('beforeTaskChange')]).toEqualTypeOf<BeforeTaskChangeHook[]>();
    removeA();
    removeA();
    expect([...hooks.chain('beforeTaskChange')]).toEqual([b, a]);
    expect([...hooks.chain('beforeLinkCreate')]).toHaveLength(1);
    expect(Object.isFrozen(hooks)).toBe(true);
  });

  it('FR-TX-2: a run skips hooks removed before their turn and leaves out hooks added meanwhile', () => {
    const hooks = createHooks();
    const a: BeforeTaskChangeHook = () => undefined;
    const b: BeforeTaskChangeHook = () => undefined;
    const c: BeforeTaskChangeHook = () => undefined;
    hooks.add('beforeTaskChange', a);
    const removeB = hooks.add('beforeTaskChange', b);
    hooks.add('beforeTaskChange', c);
    const seen: BeforeTaskChangeHook[] = [];
    for (const hook of hooks.chain('beforeTaskChange')) {
      seen.push(hook);
      if (hook === a) {
        removeB();
        hooks.add('beforeTaskChange', () => false);
      }
    }
    expect(seen).toEqual([a, c]);
    expect([...hooks.chain('beforeTaskChange')]).toHaveLength(3);
  });

  it('FR-TX-2: clear removes every hook, also from a run in progress', () => {
    const hooks = createHooks();
    const a: BeforeTaskChangeHook = () => undefined;
    hooks.add('beforeTaskChange', a);
    hooks.add('beforeTaskChange', () => false);
    const seen: BeforeTaskChangeHook[] = [];
    for (const hook of hooks.chain('beforeTaskChange')) {
      seen.push(hook);
      hooks.clear();
    }
    expect(seen).toEqual([a]);
    expect([...hooks.chain('beforeTaskChange')]).toEqual([]);
  });
});
