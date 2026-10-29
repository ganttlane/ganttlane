import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startMinuteClock } from './minute-clock';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(2026, 2, 4, 10, 30, 20));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startMinuteClock', () => {
  it('FR-UI-1: ticks at the next minute boundary, then at every one after it', () => {
    const tick = vi.fn();
    startMinuteClock(tick);

    // 40 s to the boundary: nothing before it.
    vi.advanceTimersByTime(39_900);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(new Date().getSeconds()).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3 * 60_000);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it('FR-UI-1: arms one timer at a time', () => {
    startMinuteClock(() => undefined);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(5 * 60_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('FR-UI-1: a late timer catches up and re-aligns to the clock instead of drifting', () => {
    const tick = vi.fn();
    startMinuteClock(tick);
    vi.advanceTimersByTime(39_000);
    // The machine slept: when the timer fires the clock is at 14:07:26, not at a boundary.
    vi.setSystemTime(new Date(2026, 2, 4, 14, 7, 25));
    vi.advanceTimersByTime(1_100);
    expect(tick).toHaveBeenCalledTimes(1);

    // The next one is 34 s away (the boundary of 14:08), not a full minute.
    vi.advanceTimersByTime(33_900);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(new Date().getSeconds()).toBe(0);
  });

  it('FR-API-4: stopping clears the timer and nothing ticks afterwards, also when called twice', () => {
    const tick = vi.fn();
    const stop = startMinuteClock(tick);
    vi.advanceTimersByTime(45_000);
    expect(tick).toHaveBeenCalledTimes(1);

    stop();
    stop();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('a tick that throws does not stop the clock', () => {
    let calls = 0;
    startMinuteClock(() => {
      calls++;
      throw new Error('listener failed');
    });

    expect(() => vi.advanceTimersByTime(45_000)).toThrow('listener failed');
    expect(vi.getTimerCount()).toBe(1);
    expect(() => vi.advanceTimersByTime(60_000)).toThrow('listener failed');
    expect(calls).toBe(2);
  });
});
