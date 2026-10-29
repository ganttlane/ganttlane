import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { createEmitter, type EmitterEvents, type ErrorPayload, type Unsubscribe } from './index';

interface TestEvents extends EmitterEvents {
  readonly ping: { readonly n: number };
  readonly pong: string;
}

describe('createEmitter', () => {
  it('FR-EVT-1, FR-EVT-3: calls listeners in subscription order with typed payloads', () => {
    const emitter = createEmitter<TestEvents>();
    const calls: string[] = [];
    const off: Unsubscribe = emitter.on('ping', ({ n }) => calls.push(`a${n}`));
    emitter.on('ping', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ readonly n: number }>();
      calls.push(`b${payload.n}`);
    });
    emitter.on('pong', (text) => calls.push(text));
    emitter.emit('ping', { n: 1 });
    emitter.emit('pong', 'p');
    expect(calls).toEqual(['a1', 'b1', 'p']);
    off();
    off();
    emitter.emit('ping', { n: 2 });
    expect(calls).toEqual(['a1', 'b1', 'p', 'b2']);
    // @ts-expect-error: unknown event
    emitter.on('nope', () => undefined);
    // @ts-expect-error: wrong payload
    emitter.emit('pong', 1);
    expect(Object.isFrozen(emitter)).toBe(true);
  });

  it('FR-EVT-3: every subscription of the same function is its own', () => {
    const emitter = createEmitter<TestEvents>();
    const listener = vi.fn();
    const off = emitter.on('pong', listener);
    emitter.on('pong', listener);
    emitter.emit('pong', 'x');
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    emitter.emit('pong', 'y');
    expect(listener).toHaveBeenCalledTimes(3);
    const only = vi.fn();
    const offOnly = emitter.on('ping', only);
    offOnly();
    emitter.emit('ping', { n: 1 });
    expect(only).not.toHaveBeenCalled();
  });

  it('FR-EVT-3: (un)subscribing during an emit: removed ones stop at once, added ones start next time', () => {
    const emitter = createEmitter<TestEvents>();
    const calls: string[] = [];
    let offB: Unsubscribe = () => undefined;
    const offA = emitter.on('ping', ({ n }) => {
      calls.push(`a${n}`);
      offA();
      offB();
      emitter.on('ping', ({ n: m }) => calls.push(`late${m}`));
    });
    offB = emitter.on('ping', ({ n }) => calls.push(`b${n}`));
    emitter.on('ping', ({ n }) => calls.push(`c${n}`));
    emitter.emit('ping', { n: 1 });
    expect(calls).toEqual(['a1', 'c1']);
    emitter.emit('ping', { n: 2 });
    expect(calls).toEqual(['a1', 'c1', 'c2', 'late2']);
  });

  it('FR-EVT-1: a throwing listener does not stop the others; its error goes to `error`', () => {
    const emitter = createEmitter<TestEvents>();
    const boom = new Error('boom');
    const calls: string[] = [];
    const errors: ErrorPayload[] = [];
    emitter.on('error', (payload) => errors.push(payload));
    emitter.on('ping', () => {
      throw boom;
    });
    emitter.on('ping', ({ n }) => calls.push(`after${n}`));
    emitter.emit('ping', { n: 1 });
    expect(calls).toEqual(['after1']);
    expect(errors).toEqual([{ error: boom, source: 'listener', name: 'ping' }]);
    expect(Object.isFrozen(errors[0])).toBe(true);
  });

  it('FR-EVT-1: without an `error` listener the errors are rethrown after every listener ran', () => {
    const emitter = createEmitter<TestEvents>();
    const first = new Error('first');
    const calls: number[] = [];
    emitter.on('ping', () => {
      throw first;
    });
    emitter.on('ping', ({ n }) => calls.push(n));
    expect(() => emitter.emit('ping', { n: 1 })).toThrow(first);
    expect(calls).toEqual([1]);

    const second = new Error('second');
    emitter.on('ping', () => {
      throw second;
    });
    let thrown: unknown;
    try {
      emitter.emit('ping', { n: 2 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([first, second]);
    expect((thrown as AggregateError).message).toBe('2 listeners of "ping" threw');
    expect(calls).toEqual([1, 2]);
  });

  it('FR-EVT-1: an `error` listener that throws is rethrown, never looped back into `error`', () => {
    const emitter = createEmitter<TestEvents>();
    const original = new Error('listener');
    const secondary = new Error('error listener');
    const seen = vi.fn();
    emitter.on('error', () => {
      throw secondary;
    });
    emitter.on('error', seen);
    emitter.on('pong', () => {
      throw original;
    });
    expect(() => emitter.emit('pong', 'x')).toThrow(secondary);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ error: original, source: 'listener', name: 'pong' });
  });

  it('FR-EVT-1: emitting without listeners, `error` included, does nothing', () => {
    const emitter = createEmitter<TestEvents>();
    expect(() => {
      emitter.emit('ping', { n: 1 });
      emitter.emit('error', { error: new Error('x'), source: 'hook', name: 'beforeTaskChange' });
    }).not.toThrow();
  });

  it('FR-EVT-3: clear removes every listener, also from an emit in progress', () => {
    const emitter = createEmitter<TestEvents>();
    const calls: string[] = [];
    emitter.on('ping', () => {
      calls.push('a');
      emitter.clear();
    });
    emitter.on('ping', () => calls.push('b'));
    const off = emitter.on('pong', () => calls.push('pong'));
    emitter.emit('ping', { n: 1 });
    emitter.emit('ping', { n: 2 });
    emitter.emit('pong', 'x');
    off();
    expect(calls).toEqual(['a']);
  });

  it('FR-EVT-3: emitters are independent (no globals)', () => {
    const a = createEmitter<TestEvents>();
    const b = createEmitter<TestEvents>();
    const listener = vi.fn();
    a.on('pong', listener);
    b.emit('pong', 'x');
    expect(listener).not.toHaveBeenCalled();
  });
});
