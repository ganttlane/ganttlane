import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import {
  type Link,
  type LinkType,
  type NormalizedModel,
  normalizeModel,
  type Task,
  type TaskId,
} from '../model';
import { addDays, DAY, parseDateInput, toISODate } from '../time';
import { anchorTime, buildLinkGraph, linkAnchors, type LinkGraph, wouldCreateCycle } from './index';

const { calendar } = createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-11'] });
const ORIGIN = (() => {
  const parsed = parseDateInput('2026-03-02');
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
})();
const TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/** Task ids mix numbers and strings; index `size` stands for an unknown task. */
const idOf = (i: number): TaskId => (i % 2 === 0 ? i : `t${i}`);

/** Small projects: dated tasks (some placeholders) and random links, cycles and bad ones too. */
const projects = fc.integer({ min: 1, max: 20 }).chain((size) =>
  fc.record({
    tasks: fc.array(
      fc.record({
        offset: fc.integer({ min: 0, max: 40 }),
        length: fc.integer({ min: 0, max: 10 }),
        placeholder: fc.integer({ min: 0, max: 5 }).map((n) => n === 0),
        working: fc.boolean(),
      }),
      { minLength: size, maxLength: size },
    ),
    links: fc.array(
      fc.record({
        source: fc.nat({ max: size }),
        target: fc.nat({ max: size }),
        type: fc.constantFrom(...TYPES),
        lag: fc.option(fc.integer({ min: -3, max: 3 }), { nil: undefined }),
      }),
      { maxLength: 40 },
    ),
  }),
);

type Project = typeof projects extends fc.Arbitrary<infer P> ? P : never;

interface Built {
  readonly tasks: Task[];
  readonly links: Link[];
  readonly model: NormalizedModel;
  readonly graph: LinkGraph;
}

function build(project: Project): Built {
  const tasks: Task[] = project.tasks.map((spec, i) => ({
    id: idOf(i),
    name: `T${i}`,
    ...(spec.placeholder
      ? { type: 'placeholder' as const }
      : { start: toISODate(addDays(ORIGIN, spec.offset)), duration: spec.length }),
    durationMode: spec.working ? 'working' : 'calendar',
  }));
  const size = tasks.length;
  const links: Link[] = project.links.map(({ source, target, type, lag }, i) => ({
    id: `l${i}`,
    source: source === size ? 'ghost' : idOf(source),
    target: target === size ? 'ghost' : idOf(target),
    type,
    lag,
  }));
  const model = normalizeModel({ tasks, links }, { calendar });
  return { tasks, links, model, graph: buildLinkGraph(model) };
}

/** Tasks reachable from `start` through active links (`start` only when it is on a cycle). */
function reachable(graph: LinkGraph, start: TaskId): Set<TaskId> {
  const seen = new Set<TaskId>();
  const queue = [start];
  for (const id of queue) {
    for (const link of graph.successorsOf(id)) {
      if (seen.has(link.target)) continue;
      seen.add(link.target);
      queue.push(link.target);
    }
  }
  return seen;
}

describe('link graph properties', () => {
  it('FR-SCH-5: the order has every task once and respects every link not on a cycle', () => {
    fc.assert(
      fc.property(projects, (project) => {
        const { tasks, graph } = build(project);
        expect(graph.topologicalOrder).toHaveLength(tasks.length);
        expect(new Set(graph.topologicalOrder)).toEqual(new Set(tasks.map((task) => task.id)));
        const position = new Map(graph.topologicalOrder.map((id, i) => [id, i]));
        for (const link of graph.links) {
          if (!link.active || link.inCycle) continue;
          expect(position.get(link.source)!).toBeLessThan(position.get(link.target)!);
        }
      }),
    );
  });

  it('FR-LINK-7: a link is on a cycle exactly when its target reaches its source', () => {
    fc.assert(
      fc.property(projects, (project) => {
        const { graph } = build(project);
        for (const link of graph.links) {
          const closes = link.active && reachable(graph, link.target).has(link.source);
          expect(link.inCycle).toBe(closes);
        }
        const cycles = graph.issues.filter((issue) => issue.code === 'cycle');
        expect(cycles.flatMap((issue) => issue.linkIds ?? []).sort()).toEqual(
          graph.links
            .filter((link) => link.inCycle)
            .map((link) => link.id)
            .sort(),
        );
        for (const issue of cycles) expect(issue.taskIds!.length).toBeGreaterThan(1);
      }),
    );
  });

  it('FR-LINK-6: wouldCreateCycle agrees with reachability', () => {
    fc.assert(
      fc.property(projects, fc.nat(), fc.nat(), (project, a, b) => {
        const { tasks, graph } = build(project);
        const source = idOf(a % tasks.length);
        const target = idOf(b % tasks.length);
        const expected = source === target || reachable(graph, target).has(source);
        expect(wouldCreateCycle(graph, source, target)).toBe(expected);
      }),
    );
  });

  it('FR-LINK-1, FR-DATA-4: kept links are known, distinct and active exactly with two bars', () => {
    fc.assert(
      fc.property(projects, (project) => {
        const { tasks, links, graph } = build(project);
        const byId = new Map(tasks.map((task) => [task.id, task]));
        const keys = new Set<string>();
        for (const link of graph.links) {
          const source = byId.get(link.source);
          const target = byId.get(link.target);
          expect(source !== undefined && target !== undefined && source !== target).toBe(true);
          const key = `${String(link.source)}|${String(link.target)}|${link.type}`;
          expect(keys.has(key)).toBe(false);
          keys.add(key);
          const bars = source?.type !== 'placeholder' && target?.type !== 'placeholder';
          expect(link.active).toBe(bars);
        }
        const dropped = graph.issues.filter(
          (issue) => issue.code === 'self-link' || issue.code === 'duplicate-link',
        ).length;
        const unknown = new Set(
          graph.issues
            .filter((issue) => issue.code === 'unknown-link-task')
            .map((issue) => issue.linkId),
        ).size;
        expect(graph.links.length + dropped + unknown).toBe(links.length);
      }),
    );
  });

  it('FR-LINK-8, FR-SCH-9: a derived lag is the gap between the anchors in the successor mode', () => {
    fc.assert(
      fc.property(projects, (project) => {
        const { model, graph } = build(project);
        for (const link of graph.links) {
          if (!link.active) continue;
          const target = model.taskById.get(link.target)!;
          expect(link.lag.mode).toBe(target.durationMode);
          expect(link.lag.days).toBe(link.lag.ms / DAY);
          if (!link.lag.derived) {
            expect(link.lag.ms).toBe(link.model.lag);
            continue;
          }
          const anchors = linkAnchors(link.type);
          const from = anchorTime(model.taskById.get(link.source)!.span!, anchors.source);
          const to = anchorTime(target.span!, anchors.target);
          const gap =
            target.durationMode === 'working' ? calendar.countWorkingTime(from, to) : to - from;
          expect(link.lag.ms).toBe(gap);
        }
      }),
    );
  });
});
