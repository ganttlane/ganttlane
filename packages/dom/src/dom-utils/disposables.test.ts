import { describe, expect, it, vi } from 'vitest';

import { createDisposables } from './index';

describe('createDisposables', () => {
  it('FR-API-4: releases newest first, once', () => {
    const bag = createDisposables();
    const order: string[] = [];
    bag.add(() => order.push('first'));
    bag.add(() => order.push('second'));
    bag.add(() => order.push('third'));

    bag.dispose();
    bag.dispose();

    expect(order).toEqual(['third', 'second', 'first']);
    expect(bag.disposed).toBe(true);
  });

  it('returns the function it was given', () => {
    const bag = createDisposables();
    const stop = vi.fn();
    expect(bag.add(stop)).toBe(stop);
  });

  it('FR-API-4: a resource added after disposal is released at once', () => {
    const bag = createDisposables();
    bag.dispose();
    const late = vi.fn();

    bag.add(late);

    expect(late).toHaveBeenCalledOnce();
  });

  it('runs every function even if one throws, then rethrows a single error as it is', () => {
    const bag = createDisposables();
    const after = vi.fn();
    const failure = new Error('boom');
    bag.add(after);
    bag.add(() => {
      throw failure;
    });
    const before = vi.fn();
    bag.add(before);

    expect(() => {
      bag.dispose();
    }).toThrow(failure);
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });

  it('reports several errors together', () => {
    const bag = createDisposables();
    bag.add(() => {
      throw new Error('a');
    });
    bag.add(() => {
      throw new Error('b');
    });

    expect(() => {
      bag.dispose();
    }).toThrow(AggregateError);
  });
});
