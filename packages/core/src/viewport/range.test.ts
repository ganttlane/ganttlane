import { describe, expect, it } from 'vitest';

import { VIEW_MODE_PRESETS, type ViewMode } from '../scale';
import {
  createFloatingAdapter,
  type DateTimeMs,
  type Duration,
  parseDateInput,
  parseDuration,
} from '../time';
import { columnGrid } from './columns';
import { type RangeSpan, resolveRange } from './range';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

function duration(input: string): Duration {
  const parsed = parseDuration(input);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

function preset(id: string): ViewMode {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

const adapter = createFloatingAdapter();
const days = columnGrid(preset('day'), adapter);
const now = at('2026-03-04T10:00');
const span = (start: string, end: string): RangeSpan => ({
  start: at(start),
  endExclusive: at(end),
});

describe('viewport/resolveRange', () => {
  it('FR-TL-1: no data gives a window around today', () => {
    expect(resolveRange({ spans: [], now, padding: duration('14d'), columns: days })).toEqual({
      start: at('2026-02-18'),
      end: at('2026-03-19'),
    });
    // Without padding: a week on each side.
    expect(resolveRange({ spans: [undefined], now, columns: days })).toEqual({
      start: at('2026-02-25'),
      end: at('2026-03-12'),
    });
    // Without columns: exact.
    expect(resolveRange({ spans: [], now, padding: duration('1d') })).toEqual({
      start: at('2026-03-03T10:00'),
      end: at('2026-03-05T10:00') + 1,
    });
  });

  it('FR-TL-1: the tasks plus padding, snapped outward to whole columns', () => {
    const single = [span('2026-03-02', '2026-03-07')];
    expect(resolveRange({ spans: single, now, padding: duration('14d'), columns: days })).toEqual({
      start: at('2026-02-16'),
      end: at('2026-03-21'),
    });
    // Any order, rows without a bar skipped.
    const many = [
      undefined,
      span('2026-03-10', '2026-03-12'),
      span('2026-03-02T06:00', '2026-03-03'),
    ];
    expect(resolveRange({ spans: many, now, columns: days })).toEqual({
      start: at('2026-03-02'),
      end: at('2026-03-12'),
    });
    const range = resolveRange({ spans: single, now });
    expect(Object.isFrozen(range)).toBe(true);
  });

  it('FR-TL-1: a milestone counts as its column', () => {
    const milestone = [span('2026-03-02', '2026-03-02')];
    expect(resolveRange({ spans: milestone, now, columns: days })).toEqual({
      start: at('2026-03-02'),
      end: at('2026-03-03'),
    });
  });

  it('FR-TL-1: padding is calendar-aware and may differ per side', () => {
    const range = resolveRange({
      spans: [span('2026-01-31', '2026-02-01')],
      now,
      padding: [duration('1w'), duration('1mo')],
      adapter,
    });
    expect(range).toEqual({ start: at('2026-01-24'), end: at('2026-03-01') });
  });

  it('FR-TL-1: includeToday widens the automatic range to today only when on', () => {
    const spans = [span('2026-03-02', '2026-03-07')];
    const later = at('2026-04-20T15:00');
    expect(resolveRange({ spans, now: later, columns: days })).toEqual({
      start: at('2026-03-02'),
      end: at('2026-03-07'),
    });
    expect(resolveRange({ spans, now: later, includeToday: true, columns: days })).toEqual({
      start: at('2026-03-02'),
      end: at('2026-04-21'),
    });
    // Today at midnight still gets its whole column.
    const midnight = at('2026-04-20');
    expect(resolveRange({ spans, now: midnight, includeToday: true, columns: days }).end).toBe(
      at('2026-04-21'),
    );
  });

  it('FR-TL-1: an explicit range ignores the data, padding and today, but is snapped', () => {
    const explicit = { start: at('2026-03-03T10:00'), end: at('2026-03-10T12:00') };
    expect(
      resolveRange({
        spans: [span('2020-01-01', '2030-01-01')],
        now: at('2040-01-01'),
        explicit,
        padding: duration('1y'),
        includeToday: true,
        columns: days,
      }),
    ).toEqual({ start: at('2026-03-03'), end: at('2026-03-11') });
    expect(resolveRange({ spans: [], now, explicit })).toEqual(explicit);
  });

  it.each([
    ['hour', '2026-03-04T05:00', '2026-03-04T07:00'],
    ['quarter-day', '2026-03-04T00:00', '2026-03-04T12:00'],
    ['half-day', '2026-03-04T00:00', '2026-03-04T12:00'],
    ['day', '2026-03-04', '2026-03-05'],
    ['week', '2026-03-02', '2026-03-09'],
    ['month', '2026-03-01', '2026-04-01'],
    ['year', '2026-01-01', '2027-01-01'],
  ])('FR-TL-1: whole %s columns', (id, start, end) => {
    const columns = columnGrid(preset(id), adapter);
    const spans = [span('2026-03-04T05:00', '2026-03-04T07:00')];
    expect(resolveRange({ spans, now, columns })).toEqual({ start: at(start), end: at(end) });
  });

  it('FR-TL-1: whole quarters, decades and weeks across New Year', () => {
    const spans = [span('2026-03-04T05:00', '2026-03-04T07:00')];
    expect(resolveRange({ spans, now, columns: columnGrid({ unit: 'quarter' }, adapter) })).toEqual(
      { start: at('2026-01-01'), end: at('2026-04-01') },
    );
    const decades = columnGrid({ unit: 'year', step: 10 }, adapter);
    expect(resolveRange({ spans, now, columns: decades })).toEqual({
      start: at('2020-01-01'),
      end: at('2030-01-01'),
    });
    const weeks = columnGrid(preset('week'), adapter);
    expect(
      resolveRange({ spans: [span('2026-12-30', '2027-01-02')], now, columns: weeks }),
    ).toEqual({
      start: at('2026-12-28'),
      end: at('2027-01-04'),
    });
  });

  it('throws for an empty explicit range, non-finite dates or a negative padding', () => {
    const explicit = { start: at('2026-03-10'), end: at('2026-03-10') };
    expect(() => resolveRange({ spans: [], now, explicit })).toThrow(/explicit/);
    expect(() => resolveRange({ spans: [], now: NaN as DateTimeMs })).toThrow(/finite/);
    const negative = { months: 0, ms: -1 };
    expect(() => resolveRange({ spans: [], now, padding: negative })).toThrow(/padding/);
  });
});
