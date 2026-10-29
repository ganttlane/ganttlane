import { describe, expect, it } from 'vitest';

import { countWorkingDays, toDayNumber, weekday } from './dates';
import { edgeCase, edgeCases } from './edge-cases';
import type { Fixture, FixtureTaskId } from './types';

/** The cases promised by docs/PLAN.md step 0.6 (and the step 0.6 brief). */
const DOCUMENTED_CASES = [
  'no-dates',
  'end-before-start',
  'invalid-dates',
  'unknown-parent',
  'parent-cycle',
  'unknown-link-target',
  'link-cycle',
  'duplicate-ids',
  'numeric-ids',
  'progress-bounds',
  'one-day',
  'across-new-year',
  'leap-day',
  'dst-crossing',
  'misaligned-1h',
  'very-long',
  'deep-hierarchy',
  'parent-without-children',
  'link-types',
];

const task = (fixture: Fixture, id: FixtureTaskId) => {
  const found = fixture.tasks.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No task ${String(id)} in ${fixture.name}`);
  return found;
};

/** `true` when following links from some task returns to it. */
function hasLinkCycle(fixture: Fixture): boolean {
  const next = new Map<FixtureTaskId, FixtureTaskId[]>();
  for (const { source, target } of fixture.links)
    next.set(source, [...(next.get(source) ?? []), target]);
  const state = new Map<FixtureTaskId, 'visiting' | 'done'>();
  const visit = (id: FixtureTaskId): boolean => {
    if (state.get(id) === 'visiting') return true;
    if (state.get(id) === 'done') return false;
    state.set(id, 'visiting');
    const cyclic = (next.get(id) ?? []).some(visit);
    state.set(id, 'done');
    return cyclic;
  };
  return fixture.tasks.some((candidate) => visit(candidate.id));
}

describe('edge-case fixtures', () => {
  it('contains every documented case, each once, with a description', () => {
    const names = edgeCases.map((fixture) => fixture.name);
    expect(names).toEqual(expect.arrayContaining(DOCUMENTED_CASES));
    expect(new Set(names).size).toBe(names.length);
    for (const fixture of edgeCases) expect(fixture.description.length).toBeGreaterThan(20);
  });

  it('looks cases up by name', () => {
    expect(edgeCase('link-cycle').name).toBe('link-cycle');
    expect(() => edgeCase('nope')).toThrow(/Unknown edge case/);
  });

  it('FR-DATA-1: is deep-frozen', () => {
    expect(Object.isFrozen(edgeCases)).toBe(true);
    for (const fixture of edgeCases) {
      expect(Object.isFrozen(fixture.tasks)).toBe(true);
      expect(fixture.tasks.every((candidate) => Object.isFrozen(candidate))).toBe(true);
    }
  });

  it('FR-DATA-3: no-dates has dateless tasks next to a dated control', () => {
    const fixture = edgeCase('no-dates');
    expect(task(fixture, 'no-dates')).toEqual({ id: 'no-dates', name: 'No dates at all' });
    expect(task(fixture, 'placeholder').type).toBe('placeholder');
    expect(task(fixture, 'dated').start).toBeDefined();
  });

  it('FR-DATA-4: end-before-start has an earlier end in the same month', () => {
    const { start, end } = task(edgeCase('end-before-start'), 'same-month');
    expect(String(start).slice(0, 7)).toBe(String(end).slice(0, 7));
    expect(toDayNumber(String(end))).toBeLessThan(toDayNumber(String(start)));
  });

  it('FR-DATA-4: unknown parent and unknown link ends point at missing ids', () => {
    const parent = edgeCase('unknown-parent');
    const parentIds = new Set(parent.tasks.map((candidate) => candidate.id));
    expect(
      parent.tasks.some(
        (candidate) => candidate.parentId !== undefined && !parentIds.has(candidate.parentId),
      ),
    ).toBe(true);

    const links = edgeCase('unknown-link-target');
    const linkIds = new Set(links.tasks.map((candidate) => candidate.id));
    expect(links.links.some((link) => !linkIds.has(link.target))).toBe(true);
    expect(links.links.some((link) => !linkIds.has(link.source))).toBe(true);
  });

  it('FR-LINK-7: link-cycle contains A → B → C → A; other fixtures stay acyclic', () => {
    const fixture = edgeCase('link-cycle');
    expect(fixture.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'A', target: 'B' }),
        expect.objectContaining({ source: 'B', target: 'C' }),
        expect.objectContaining({ source: 'C', target: 'A' }),
      ]),
    );
    expect(hasLinkCycle(fixture)).toBe(true);
    for (const other of edgeCases) {
      if (other.name !== 'link-cycle' && other.name !== 'duplicate-ids') {
        expect([other.name, hasLinkCycle(other)]).toEqual([other.name, false]);
      }
    }
  });

  it('duplicate-ids repeats a task id and a link id', () => {
    const fixture = edgeCase('duplicate-ids');
    expect(new Set(fixture.tasks.map((candidate) => candidate.id)).size).toBeLessThan(
      fixture.tasks.length,
    );
    expect(new Set(fixture.links.map((link) => link.id)).size).toBeLessThan(fixture.links.length);
  });

  it('numeric-ids uses numbers everywhere, including 0', () => {
    const fixture = edgeCase('numeric-ids');
    expect(fixture.tasks.every((candidate) => typeof candidate.id === 'number')).toBe(true);
    expect(fixture.tasks.map((candidate) => candidate.id)).toContain(0);
    expect(fixture.tasks.filter((candidate) => candidate.parentId === 0)).toHaveLength(2);
    expect(
      fixture.links.every(
        (link) => typeof link.source === 'number' && typeof link.target === 'number',
      ),
    ).toBe(true);
  });

  it('FR-PROG-1: progress-bounds has 0, 100 and out-of-range values', () => {
    const values = edgeCase('progress-bounds').tasks.map((candidate) => candidate.progress);
    expect(values).toEqual(expect.arrayContaining([0, 100, -10, 150, 12.5, undefined]));
  });

  it('one-day includes a Saturday task in working mode', () => {
    const saturday = task(edgeCase('one-day'), 'saturday-working');
    expect(weekday(String(saturday.start))).toBe(6);
    expect(saturday.start).toBe(saturday.end);
  });

  it('across-new-year: 3 working days from Wed 2026-12-30 end on Mon 2027-01-04', () => {
    const fixture = edgeCase('across-new-year');
    expect(task(fixture, 'range')).toMatchObject({ start: '2026-12-28', end: '2027-01-05' });
    expect(weekday('2026-12-30')).toBe(3);
    expect(countWorkingDays('2026-12-30', '2027-01-04', fixture.calendar ?? {})).toBe(3);
  });

  it('leap-day uses 2028-02-29, a real date', () => {
    const fixture = edgeCase('leap-day');
    expect(task(fixture, 'leap-day').start).toBe('2028-02-29');
    expect(() => toDayNumber('2028-02-29')).not.toThrow();
    expect(() => toDayNumber('2027-02-29')).toThrow();
  });

  it('FR-TIME-6: dst-crossing has time-precision tasks on the EU and US switch days', () => {
    const edges = edgeCase('dst-crossing').tasks.flatMap((candidate) => [
      candidate.start,
      candidate.end,
    ]);
    for (const day of ['2026-03-29', '2026-03-08', '2026-10-25', '2026-11-01']) {
      // All four switches happen on a Sunday.
      expect(weekday(day)).toBe(0);
      expect(edges).toContainEqual(expect.stringMatching(new RegExp(`^${day}T\\d{2}:\\d{2}$`)));
    }
  });

  it("FR-SNAP-13: misaligned-1h has 10:30–11:30, '90min' and a '30min' lag at granularity '1h'", () => {
    const fixture = edgeCase('misaligned-1h');
    expect(fixture.options?.scheduling?.granularity).toBe('1h');
    expect(task(fixture, 2)).toMatchObject({ start: '2026-01-05T10:30', end: '2026-01-05T11:30' });
    expect(task(fixture, 3).duration).toBe('90min');
    expect(fixture.links[0]?.lag).toBe('30min');
  });

  it('very-long spans more than ten years', () => {
    const { start, end } = task(edgeCase('very-long'), 'decade-plus');
    expect(toDayNumber(String(end)) - toDayNumber(String(start))).toBeGreaterThan(3653);
  });

  it('FR-ROW-1: deep-hierarchy nests five levels', () => {
    const fixture = edgeCase('deep-hierarchy');
    const byId = new Map(fixture.tasks.map((candidate) => [candidate.id, candidate]));
    const depth = (id: FixtureTaskId): number => {
      const parentId = byId.get(id)?.parentId;
      return parentId === undefined ? 1 : 1 + depth(parentId);
    };
    expect(Math.max(...fixture.tasks.map((candidate) => depth(candidate.id)))).toBe(5);
  });

  it('parent-without-children expands a group that has no children', () => {
    const fixture = edgeCase('parent-without-children');
    expect(fixture.options?.hierarchy?.expandedKeys).toContain('empty-group');
    expect(fixture.tasks.some((candidate) => candidate.parentId === 'empty-group')).toBe(false);
  });

  it('FR-LINK-1/2: link-types has SS, FF, SF, an FS + FF pair, lags and an untyped link', () => {
    const { links } = edgeCase('link-types');
    const types = new Set(links.map((link) => link.type));
    for (const type of ['SS', 'FF', 'SF', 'FS', undefined]) expect(types).toContain(type);
    const pair = links.filter((link) => link.source === 'a' && link.target === 'fs-ff');
    expect(pair.map((link) => link.type).sort()).toEqual(['FF', 'FS']);
    expect(links.map((link) => link.lag)).toEqual(expect.arrayContaining([-1, '2d']));
  });
});
