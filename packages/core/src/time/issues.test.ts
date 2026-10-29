import { describe, expect, it } from 'vitest';

import { err, ok } from '../shared';
import { describeValue, timeIssue, withPath } from './issues';

describe('time/issues', () => {
  it('timeIssue builds an error without a path', () => {
    expect(timeIssue('invalid-date', 'x', 'bad')).toEqual({
      code: 'invalid-date',
      severity: 'error',
      message: 'bad',
      value: 'x',
    });
  });

  it('withPath adds the path to failures only', () => {
    const issue = timeIssue('invalid-duration', '5m', 'bad');
    expect(withPath(err(issue), { path: 'lag' })).toEqual(err({ ...issue, path: 'lag' }));
    expect(withPath(err(issue), {})).toEqual(err(issue));
    expect(withPath(err(issue), undefined)).toEqual(err(issue));
    expect(withPath(ok(1), { path: 'lag' })).toEqual(ok(1));
  });

  it.each([
    ['abc', '"abc"'],
    [42, '42'],
    [false, 'false'],
    [10n, '10'],
    [null, 'null'],
    [undefined, 'undefined'],
    [new Date(Date.UTC(2026, 2, 8)), 'Date(2026-03-08T00:00:00.000Z)'],
    [new Date(Number.NaN), 'Invalid Date'],
    [[1], 'an array'],
    [{ a: 1 }, 'an object'],
    [() => 1, 'a function'],
  ])('describeValue(%o) = %s', (value, text) => {
    expect(describeValue(value)).toBe(text);
  });
});
