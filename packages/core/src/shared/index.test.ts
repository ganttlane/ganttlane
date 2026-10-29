import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  assertNever,
  DEV,
  err,
  isFiniteNumber,
  isObject,
  isRecord,
  isSize,
  type Issue,
  ok,
  type Result,
  shortMessage,
} from './index';

describe('shared', () => {
  it('ok() and err() build the two Result variants', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    const issue: Issue<'invalid-date'> = {
      code: 'invalid-date',
      severity: 'error',
      message: 'bad',
    };
    expect(err(issue)).toEqual({ ok: false, issue });
  });

  it('Result narrows on ok', () => {
    const result: Result<number, Issue<'x'>> = Math.random() > 2
      ? err({ code: 'x', severity: 'warning', message: '' })
      : ok(1);
    if (result.ok) expectTypeOf(result.value).toEqualTypeOf<number>();
    else expectTypeOf(result.issue.code).toEqualTypeOf<'x'>();
    expect(result).toEqual({ ok: true, value: 1 });
  });

  it('Issue codes are open per module: unions compose without a central list', () => {
    type CodeA = 'a-1' | 'a-2';
    type CodeB = 'b-1';
    const issues: Issue<CodeA | CodeB>[] = [
      { code: 'a-1', severity: 'error', message: 'a' },
      { code: 'b-1', severity: 'warning', message: 'b', path: 'start', value: 1 },
    ];
    expectTypeOf(issues[0]!.code).toEqualTypeOf<CodeA | CodeB>();
    expectTypeOf<Issue>().toHaveProperty('code').toEqualTypeOf<string>();
  });

  it('NFR-SIZE-1: the sources run as the development build (full issue messages)', () => {
    expect(DEV).toBe(true);
  });

  it('NFR-SIZE-1: shortMessage is the production message, the path and the code', () => {
    expect(shortMessage('invalid-date', 'tasks[2].start')).toBe('tasks[2].start: invalid-date');
    expect(shortMessage('cycle')).toBe('cycle');
    expect(shortMessage('invalid-option', '')).toBe('invalid-option');
  });

  it('runtime checks: records, objects, finite numbers and sizes', () => {
    expect([{}, [], null, 'x', () => 1].map(isRecord)).toEqual([true, false, false, false, false]);
    expect([{}, [], null, 'x', () => 1].map(isObject)).toEqual([true, true, false, false, false]);
    expect([0, -1.5, Number.NaN, Infinity, '1'].map(isFiniteNumber)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect([0, 12.5, -1, Infinity, '1'].map(isSize)).toEqual([true, true, false, false, false]);
  });

  it('assertNever throws a TypeError naming the value', () => {
    expect(() => assertNever('week' as never)).toThrow(new TypeError('Unexpected value: week'));
    expect(() => assertNever(3 as never, 'Unknown unit')).toThrow('Unknown unit: 3');
  });
});
