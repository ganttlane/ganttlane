import { describe, expect, it } from 'vitest';

import { VIEW_MODE_PRESETS, type ViewMode } from '../scale';
import { createFloatingAdapter, type DateTimeMs, parseDateInput } from '../time';
import { ceilToColumn, columnGrid, floorToColumn, snapRange } from './columns';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

function preset(id: string): ViewMode {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

const adapter = createFloatingAdapter();
const quarter: Pick<ViewMode, 'unit' | 'step'> = { unit: 'quarter' };
const decade: Pick<ViewMode, 'unit' | 'step'> = { unit: 'year', step: 10 };

describe('viewport/columnGrid', () => {
  it.each([
    ['hour', '2026-03-04T05:30', '2026-03-04T05:00', '2026-03-04T06:00'],
    ['quarter-day', '2026-03-04T05:00', '2026-03-04T00:00', '2026-03-04T06:00'],
    ['half-day', '2026-03-04T13:00', '2026-03-04T12:00', '2026-03-05'],
    ['day', '2026-03-04T05:00', '2026-03-04', '2026-03-05'],
    ['week', '2026-03-04', '2026-03-02', '2026-03-09'],
    ['month', '2026-03-15', '2026-03-01', '2026-04-01'],
    ['year', '2026-05-10', '2026-01-01', '2027-01-01'],
  ])('FR-TL-1: %s columns around %s', (id, t, floor, next) => {
    const columns = columnGrid(preset(id), adapter);
    expect(columns.floor(at(t))).toBe(at(floor));
    expect(columns.next(at(t))).toBe(at(next));
    expect(Object.isFrozen(columns)).toBe(true);
  });

  it('FR-TL-1: quarter and decade columns of custom view modes', () => {
    expect(columnGrid(quarter, adapter).floor(at('2026-05-10'))).toBe(at('2026-04-01'));
    expect(columnGrid(quarter, adapter).next(at('2026-05-10'))).toBe(at('2026-07-01'));
    expect(columnGrid(decade, adapter).floor(at('2026-05-10'))).toBe(at('2020-01-01'));
    expect(columnGrid(decade, adapter).next(at('2026-05-10'))).toBe(at('2030-01-01'));
  });

  it('FR-TL-1: a boundary is its own floor; next is the following boundary', () => {
    const columns = columnGrid(preset('week'), adapter);
    expect(columns.floor(at('2026-03-09'))).toBe(at('2026-03-09'));
    expect(columns.next(at('2026-03-09'))).toBe(at('2026-03-16'));
    // Weeks follow the adapter's week start.
    const sunday = columnGrid(preset('week'), createFloatingAdapter({ weekStartsOn: 0 }));
    expect(sunday.floor(at('2026-03-04'))).toBe(at('2026-03-01'));
  });

  it('rounds dates outward with and without a grid', () => {
    const columns = columnGrid(preset('day'), adapter);
    expect(floorToColumn(at('2026-03-04T05:00'), columns)).toBe(at('2026-03-04'));
    expect(ceilToColumn(at('2026-03-04T05:00'), columns)).toBe(at('2026-03-05'));
    expect(ceilToColumn(at('2026-03-04'), columns)).toBe(at('2026-03-04'));
    expect(floorToColumn(at('2026-03-04T05:00'), undefined)).toBe(at('2026-03-04T05:00'));
    expect(ceilToColumn(at('2026-03-04T05:00'), undefined)).toBe(at('2026-03-04T05:00'));
    const range = { start: at('2026-03-04T05:00'), end: at('2026-03-04T05:00') };
    // Never empty: one column, or one millisecond without a grid.
    expect(snapRange(range, columns)).toEqual({ start: at('2026-03-04'), end: at('2026-03-05') });
    expect(snapRange({ ...range, start: range.end }, undefined).end - range.end).toBe(1);
    const boundary = { start: at('2026-03-04'), end: at('2026-03-04') };
    expect(snapRange(boundary, columns)).toEqual({
      start: at('2026-03-04'),
      end: at('2026-03-05'),
    });
  });

  it('throws for a step that is not a positive integer', () => {
    expect(() => columnGrid({ unit: 'day', step: 0 }, adapter)).toThrow(RangeError);
    expect(() => columnGrid({ unit: 'hour', step: 1.5 }, adapter)).toThrow(RangeError);
  });
});
