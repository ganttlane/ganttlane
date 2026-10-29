import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type BeforeLinkCreateHook,
  type BeforeTaskChangeContext,
  type BeforeTaskChangeHook,
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
