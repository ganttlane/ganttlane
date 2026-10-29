import { describe, expect, it } from 'vitest';

import { countWorkingDays, isWorkingDay, toDayNumber } from './dates';
import type { SampleProjectKind } from './sample-project';
import { sampleProject } from './sample-project';

const { tasks, links, calendar = {} } = sampleProject;
const ids = new Set(tasks.map((task) => task.id));
const groups = tasks.filter((task) => task.data?.kind === 'group');
const childrenOf = (id: string | number) => tasks.filter((task) => task.parentId === id);

describe('sample-project fixture', () => {
  it('has unique ids', () => {
    expect(ids.size).toBe(tasks.length);
  });

  it('references only existing tasks (parents and both link ends)', () => {
    for (const task of tasks) {
      if (task.parentId !== undefined) expect(ids).toContain(task.parentId);
    }
    for (const link of links) {
      expect(ids).toContain(link.source);
      expect(ids).toContain(link.target);
    }
  });

  it('has six groups, each a parent task (not a zero-duration milestone) with children', () => {
    expect(groups).toHaveLength(6);
    for (const group of groups) {
      expect(group.type).toBeUndefined();
      expect(group.parentId).toBeUndefined();
      expect(group.durationMode).toBe('working');
      expect(group.className).toMatch(/^status-/);
      expect(childrenOf(group.id).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('lists every child right after its group (flattened tree order)', () => {
    let currentGroup: string | number | undefined;
    for (const task of tasks) {
      if (task.data?.kind === 'group') currentGroup = task.id;
      else expect(task.parentId).toBe(currentGroup);
    }
  });

  it('contains children of every kind', () => {
    const kinds = new Set(tasks.map((task) => task.data?.kind));
    const expected: SampleProjectKind[] = [
      'group',
      'checkpoint',
      'task',
      'deliverable',
      'block',
      'placeholder',
    ];
    expect([...kinds].sort()).toEqual([...expected].sort());
  });

  it('models checkpoints as one locked, fixed-duration, non-linkable day', () => {
    for (const checkpoint of tasks.filter((task) => task.data?.kind === 'checkpoint')) {
      expect(checkpoint).toMatchObject({
        duration: 1,
        locked: true,
        fixedDuration: true,
        linkable: false,
      });
    }
  });

  it('covers every parent-anchor combination and followParent', () => {
    const anchors = tasks.map((task) => JSON.stringify(task.parentAnchor ?? null));
    expect(anchors).toEqual(
      expect.arrayContaining(['"SS"', '"FF"', '"FS"', '["SS","FF"]', 'null']),
    );
    for (const task of tasks) {
      if (task.data?.kind !== 'task') continue;
      expect(task.followParent).toBe(task.parentAnchor !== undefined);
    }
  });

  it('locks blocks and has one locked group and one fixed-duration review', () => {
    for (const block of tasks.filter((task) => task.data?.kind === 'block')) {
      expect(block.locked).toBe(true);
    }
    expect(groups.filter((task) => task.locked)).toHaveLength(1);
    const reviews = groups.filter((task) => task.data?.groupType === 'review');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.fixedDuration).toBe(true);
  });

  it('FR-DATA-3: has exactly one dateless "To be scheduled" placeholder', () => {
    const placeholders = tasks.filter((task) => task.type === 'placeholder');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toMatchObject({
      name: 'To be scheduled',
      data: { kind: 'placeholder' },
    });
    expect(placeholders[0]?.start).toBeUndefined();
    expect(placeholders[0]?.end).toBeUndefined();
    expect(placeholders[0]?.duration).toBeUndefined();
  });

  it('includes progress 0 and 100 and end-anchored progress', () => {
    const progress = new Set(tasks.map((task) => task.progress));
    expect(progress).toContain(0);
    expect(progress).toContain(100);
    expect(tasks.some((task) => task.progressAnchor === 'end')).toBe(true);
  });

  it('links groups FS (some by default type) and tasks with non-editable FS links', () => {
    const groupIds = new Set(groups.map((task) => task.id));
    const groupLinks = links.filter((link) => groupIds.has(link.source));
    expect(groupLinks.length).toBeGreaterThanOrEqual(4);
    expect(groupLinks.some((link) => link.type === undefined)).toBe(true);
    expect(groupLinks.every((link) => (link.type ?? 'FS') === 'FS')).toBe(true);

    const taskLinks = links.filter((link) => String(link.source).startsWith('task-'));
    expect(taskLinks.length).toBeGreaterThan(0);
    for (const link of taskLinks) {
      expect(link).toMatchObject({ type: 'FS', editable: false });
      const target = tasks.find((task) => task.id === link.target);
      expect(target?.linkable).toBe(false);
    }
  });

  it('uses date-only strings in March–July 2026', () => {
    for (const task of tasks) {
      for (const value of [task.start, task.end]) {
        if (value === undefined) continue;
        expect(value).toMatch(/^2026-0[3-7]-\d{2}$/);
        expect(() => toDayNumber(value as string)).not.toThrow();
      }
    }
  });

  it('starts every dated task on a working day', () => {
    for (const task of tasks) {
      if (typeof task.start === 'string') expect(isWorkingDay(task.start, calendar)).toBe(true);
    }
  });

  it('FR-DATA-2: states durations in working days consistent with start and end', () => {
    for (const task of tasks) {
      if (typeof task.start !== 'string' || typeof task.end !== 'string') continue;
      if (typeof task.duration !== 'number') continue;
      expect([task.id, countWorkingDays(task.start, task.end, calendar)]).toEqual([
        task.id,
        task.duration,
      ]);
    }
  });

  it('has a weekend calendar with named and unnamed holidays', () => {
    expect(calendar.weekends).toEqual([0, 6]);
    const holidays = calendar.holidays ?? [];
    expect(holidays.some((holiday) => typeof holiday === 'string')).toBe(true);
    expect(holidays.filter((holiday) => typeof holiday === 'object').length).toBeGreaterThan(3);
  });

  it('carries a data payload with a kind on every task', () => {
    for (const task of tasks) expect(task.data?.kind).toBeTypeOf('string');
  });

  it('FR-DATA-1: is deep-frozen', () => {
    expect(Object.isFrozen(sampleProject)).toBe(true);
    expect(Object.isFrozen(tasks)).toBe(true);
    expect(Object.isFrozen(tasks[0])).toBe(true);
    expect(Object.isFrozen(tasks[0]?.data)).toBe(true);
    expect(Object.isFrozen(calendar.holidays)).toBe(true);
  });
});
