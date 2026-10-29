import { describe, expect, it } from 'vitest';

import { checkSnapInput } from './snap-input';

/** Runs the check and returns its verdict and the reported paths. */
function check(value: unknown): { valid: boolean; paths: string[]; messages: string[] } {
  const paths: string[] = [];
  const messages: string[] = [];
  const valid = checkSnapInput(value, 'snap', (path, message) => {
    paths.push(path);
    messages.push(message);
  });
  return { valid, paths, messages };
}

describe('scale/snap-input', () => {
  it.each([
    '1min',
    '5min',
    '15min',
    '30min',
    '1h',
    '2h',
    '6h',
    '12h',
    '1d',
    '1w',
    '1mo',
    '1q',
    '1y',
    '1d 4h',
    'unit',
    false,
    { hours: 1 },
  ])('FR-SNAP-1: accepts the step %o', (value) => {
    expect(check(value)).toEqual({ valid: true, paths: [], messages: [] });
  });

  it.each([
    {},
    { mode: 'grid' },
    { mode: 'relative', step: '1h' },
    { move: '1d', resize: '1h', progress: false },
    { step: 'unit', move: undefined },
  ])('FR-SNAP-3, FR-SNAP-4: accepts the options %o', (value) => {
    expect(check(value).valid).toBe(true);
  });

  it.each([
    ['5m', ['snap'], 'ambiguous'],
    ['0min', ['snap'], 'empty'],
    [true, ['snap'], 'false'],
    [15, ['snap'], 'plain numbers'],
    [null, ['snap'], 'Invalid duration'],
    [{ hours: 1.5 }, ['snap'], 'integer'],
    [{ mode: 'magnet' }, ['snap.mode'], 'grid'],
    [{ mode: 1 }, ['snap.mode'], 'relative'],
    [{ step: '1x', move: 'unit' }, ['snap.step'], 'unknown unit'],
    [{ step: '1h', moves: '1h' }, ['snap.moves'], 'Unknown snap option'],
    [{ resize: '0d', progress: true }, ['snap.resize', 'snap.progress'], 'empty'],
  ])('rejects %o at %o', (value, paths, message) => {
    const result = check(value);
    expect(result.valid).toBe(false);
    expect(result.paths).toEqual(paths);
    expect(result.messages[0]).toContain(message);
  });
});
