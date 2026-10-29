import { describe, expect, it } from 'vitest';

import { MINUTES_PER_DAY, toDayNumber, toMinuteNumber } from './dates';
import { generateFixture } from './generate';
import type { Fixture, FixtureTaskId } from './types';

/** Kahn's algorithm: `true` when the link graph has no cycle. */
function isAcyclic(fixture: Fixture): boolean {
  const incoming = new Map<FixtureTaskId, number>();
  const outgoing = new Map<FixtureTaskId, FixtureTaskId[]>();
  for (const task of fixture.tasks) incoming.set(task.id, 0);
  for (const { source, target } of fixture.links) {
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
  }
  const ready = [...incoming].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop()!;
    visited++;
    for (const next of outgoing.get(id) ?? []) {
      const left = incoming.get(next)! - 1;
      incoming.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  return visited === incoming.size;
}

function depthOf(fixture: Fixture, id: FixtureTaskId): number {
  const byId = new Map(fixture.tasks.map((task) => [task.id, task]));
  let depth = 0;
  for (let task = byId.get(id); task?.parentId !== undefined; task = byId.get(task.parentId)) {
    depth++;
  }
  return depth;
}

/** Minutes since the epoch of a generated date (date-only or `YYYY-MM-DDTHH:mm`). */
function minutesOf(value: unknown): number {
  if (typeof value !== 'string') throw new Error(`Expected a date string, got ${String(value)}`);
  return value.includes('T') ? toMinuteNumber(value) : toDayNumber(value) * MINUTES_PER_DAY;
}

describe('generateFixture', () => {
  it('is deterministic: the same seed gives the same fixture', () => {
    expect(generateFixture({ count: 500, seed: 42 })).toEqual(
      generateFixture({ count: 500, seed: 42 }),
    );
  });

  it('gives a different fixture for a different seed', () => {
    expect(generateFixture({ count: 500, seed: 1 })).not.toEqual(
      generateFixture({ count: 500, seed: 2 }),
    );
  });

  it.each([0, 1, 1000, 10_000])('generates exactly %i tasks with unique ids', (count) => {
    const fixture = generateFixture({ count });

    expect(fixture.tasks).toHaveLength(count);
    expect(new Set(fixture.tasks.map((task) => task.id)).size).toBe(count);
    expect(fixture.name).toBe(`generated-${count}`);
  });

  it('keeps the 1k preset stable (snapshot of its shape)', () => {
    const fixture = generateFixture({ count: 1000 });
    const roots = fixture.tasks.filter((task) => task.parentId === undefined).length;
    const placeholders = fixture.tasks.filter((task) => task.type === 'placeholder').length;

    expect({ roots, placeholders, links: fixture.links.length }).toMatchInlineSnapshot(`
      {
        "links": 314,
        "placeholders": 7,
        "roots": 277,
      }
    `);
  });

  it('builds a hierarchy within maxDepth, parents first', () => {
    for (const maxDepth of [1, 2, 5]) {
      const fixture = generateFixture({ count: 2000, maxDepth, seed: maxDepth });
      const seen = new Set<FixtureTaskId>();
      let deepest = 0;
      for (const task of fixture.tasks) {
        if (task.parentId !== undefined) expect(seen.has(task.parentId)).toBe(true);
        seen.add(task.id);
        deepest = Math.max(deepest, depthOf(fixture, task.id));
      }
      expect(deepest).toBe(maxDepth - 1);
    }
  });

  it('places children within their parent range', () => {
    const fixture = generateFixture({ count: 2000, maxDepth: 4, seed: 9 });
    const byId = new Map(fixture.tasks.map((task) => [task.id, task]));
    for (const task of fixture.tasks) {
      const parent = task.parentId === undefined ? undefined : byId.get(task.parentId);
      if (!parent || task.type === 'placeholder' || typeof task.end !== 'string') continue;
      if (typeof parent.end !== 'string') continue;
      expect(minutesOf(task.start)).toBeGreaterThanOrEqual(minutesOf(parent.start));
      expect(minutesOf(task.end)).toBeLessThanOrEqual(minutesOf(parent.end));
    }
  });

  it('generates acyclic links between existing, dated tasks', () => {
    for (const linkDensity of [0.3, 1, 2.5]) {
      const fixture = generateFixture({ count: 3000, linkDensity, seed: 3 });
      const byId = new Map(fixture.tasks.map((task) => [task.id, task]));

      expect(fixture.links.length).toBeGreaterThan(fixture.tasks.length * linkDensity * 0.8);
      expect(new Set(fixture.links.map((link) => link.id)).size).toBe(fixture.links.length);
      for (const { source, target } of fixture.links) {
        expect(source).not.toBe(target);
        expect(byId.get(source)?.start).toBeDefined();
        expect(byId.get(target)?.start).toBeDefined();
      }
      expect(isAcyclic(fixture)).toBe(true);
    }
  });

  it('never links a task to its own ancestor', () => {
    const fixture = generateFixture({ count: 3000, linkDensity: 2, maxDepth: 5, seed: 11 });
    const byId = new Map(fixture.tasks.map((task) => [task.id, task]));
    for (const { source, target } of fixture.links) {
      for (let task = byId.get(target); task?.parentId !== undefined;) {
        expect(task.parentId).not.toBe(source);
        task = byId.get(task.parentId);
      }
    }
  });

  it('FR-SNAP-12: aligns every time-precision date and duration to the granularity', () => {
    const fixture = generateFixture({ count: 1000, granularity: '15min', precision: 'time' });

    expect(fixture.options?.scheduling?.granularity).toBe('15min');
    for (const task of fixture.tasks) {
      if (task.type === 'placeholder') continue;
      expect(task.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(minutesOf(task.start) % 15).toBe(0);
      if (task.end !== undefined) expect(minutesOf(task.end) % 15).toBe(0);
      if (typeof task.duration === 'string') {
        expect(task.duration).toMatch(/^(\d+d)?( ?\d+h)?( ?(15|30|45)min)?$/);
      }
    }
  });

  it('keeps day-precision tasks date-only and mixes both in mixed mode', () => {
    const day = generateFixture({ count: 300, granularity: '1h' });
    for (const task of day.tasks) {
      if (task.start !== undefined) expect(task.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const mixed = generateFixture({ count: 300, granularity: '1h', precision: 'mixed' });
    const timed = mixed.tasks.filter(
      (task) => typeof task.start === 'string' && task.start.includes('T'),
    );
    expect(timed.length).toBeGreaterThan(0);
    expect(timed.length).toBeLessThan(mixed.tasks.length);
  });

  it('starts no earlier than the given start date', () => {
    const fixture = generateFixture({ count: 200, start: '2027-01-04' });
    const first = Math.min(
      ...fixture.tasks
        .filter((task) => task.start !== undefined)
        .map((task) => minutesOf(task.start)),
    );
    expect(first).toBeGreaterThanOrEqual(toDayNumber('2027-01-04') * MINUTES_PER_DAY);
  });

  it('rejects invalid options', () => {
    expect(() => generateFixture({ count: -1 })).toThrow(RangeError);
    expect(() => generateFixture({ count: 1.5 })).toThrow(RangeError);
    expect(() => generateFixture({ maxDepth: 0 })).toThrow(RangeError);
    expect(() => generateFixture({ linkDensity: -0.1 })).toThrow(RangeError);
    expect(() => generateFixture({ start: '2026-02-30' })).toThrow();
  });
});
