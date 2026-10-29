import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import {
  type DurationMode,
  type Link,
  type LinkType,
  normalizeModel,
  type NormalizeModelOptions,
  type Task,
} from '../model';
import {
  asDateTimeMs,
  type DateTimeMs,
  DAY,
  HOUR,
  MINUTE,
  parseDateInput,
  parseGranularity,
} from '../time';
import {
  anchorTime,
  buildLinkGraph,
  linkAnchors,
  type LinkGraph,
  type LinkRecord,
  measureLag,
  type ScheduleIssue,
  wouldCreateCycle,
} from './index';

const { calendar } = createWorkCalendar({ weekends: [0, 6] });

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

function graphOf(
  tasks: readonly Task[],
  links: readonly Link[] = [],
  options: Partial<NormalizeModelOptions> = {},
): LinkGraph {
  return buildLinkGraph(normalizeModel({ tasks, links }, { calendar, ...options }));
}

function record(graph: LinkGraph, id: string): LinkRecord {
  const found = graph.linkById.get(id);
  if (!found) throw new Error(`No link ${id}`);
  return found;
}

function codes(issues: readonly ScheduleIssue[]): string[] {
  return issues.map(
    (issue) => `${issue.code}${issue.severity === 'warning' ? '?' : ''}@${issue.path ?? ''}`,
  );
}

const ONE_HOUR = (() => {
  const parsed = parseGranularity('1h');
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
})();

// 2026-03-02 is a Monday; Saturday and Sunday are off.
const PREDECESSOR: Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-04' };

describe('link anchors', () => {
  it('FR-LINK-1: every link type connects its edges', () => {
    expect(linkAnchors('FS')).toEqual({ source: 'end', target: 'start' });
    expect(linkAnchors('SS')).toEqual({ source: 'start', target: 'start' });
    expect(linkAnchors('FF')).toEqual({ source: 'end', target: 'end' });
    expect(linkAnchors('SF')).toEqual({ source: 'start', target: 'end' });
    expect(Object.isFrozen(linkAnchors('FS'))).toBe(true);
    expect(() => linkAnchors('XX' as LinkType)).toThrow(TypeError);
  });

  it('FR-TIME-3: the end anchor is the exclusive end of the bar', () => {
    const span = normalizeModel({ tasks: [PREDECESSOR] }, { calendar }).tasks[0]!.span!;
    expect(anchorTime(span, 'start')).toBe(at('2026-03-02'));
    expect(anchorTime(span, 'end')).toBe(at('2026-03-05'));
  });
});

describe('derived lags', () => {
  // [case, type, successor start, successor end (inclusive), calendar days, working days]
  const CASES: [string, LinkType, string, string, number, number][] = [
    ['FS over a weekend', 'FS', '2026-03-09', '2026-03-10', 4, 2],
    ['SS', 'SS', '2026-03-10', '2026-03-11', 8, 6],
    ['FF', 'FF', '2026-03-03', '2026-03-09', 5, 3],
    ['SF (target before source)', 'SF', '2026-02-20', '2026-02-26', -3, -1],
    ['FS overlap (negative)', 'FS', '2026-02-27', '2026-03-03', -6, -4],
    ['FS adjacent', 'FS', '2026-03-05', '2026-03-06', 0, 0],
  ];

  it.each(CASES)(
    'FR-LINK-1, FR-LINK-8: %s is the current gap in the successor mode',
    (_, type, start, end, calendarDays, workingDays) => {
      for (const [mode, days] of [
        ['calendar', calendarDays],
        ['working', workingDays],
      ] as const) {
        const successor: Task = { id: 'b', name: 'B', start, end, durationMode: mode };
        const graph = graphOf([PREDECESSOR, successor], [{ source: 'a', target: 'b', type }]);
        expect(graph.issues).toEqual([]);
        expect(record(graph, `a:${type}:b`).lag).toEqual({
          ms: days * DAY,
          mode,
          derived: true,
          days,
        });
      }
    },
  );

  it('FR-LINK-8: a gap of only non-working days is a working lag of +0', () => {
    const friday: Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' };
    const monday: Task = {
      id: 'b',
      name: 'B',
      start: '2026-03-09',
      end: '2026-03-09',
      durationMode: 'working',
    };
    const lag = record(graphOf([friday, monday], [{ source: 'a', target: 'b' }]), 'a:FS:b').lag;
    expect(Object.is(lag?.ms, 0)).toBe(true);
    expect(lag?.mode).toBe('working');
  });

  it("FR-SCH-9: time-precision tasks with granularity '1h' and a 4h gap", () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', start: '2026-03-02T08:00', end: '2026-03-02T12:00' },
      { id: 'b', name: 'B', start: '2026-03-02T16:00', end: '2026-03-02T18:00' },
    ];
    const graph = graphOf(tasks, [{ source: 'a', target: 'b' }], { granularity: '1h' });
    expect(record(graph, 'a:FS:b').lag).toEqual({
      ms: 4 * HOUR,
      mode: 'calendar',
      derived: true,
      days: 1 / 6,
    });
  });

  it('FR-SCH-9: a working-time gap of hours skips the weekend', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', start: '2026-03-06T16:00', end: '2026-03-06T20:00' },
      { id: 'b', name: 'B', start: '2026-03-09T04:00', end: '2026-03-09T08:00' },
    ];
    for (const [mode, hours] of [
      ['calendar', 56],
      ['working', 8],
    ] as const) {
      const graph = graphOf(
        tasks,
        [{ source: 'a', target: 'b' }],
        { granularity: '1h', durationMode: mode }, // the successor's mode via the default
      );
      expect(record(graph, 'a:FS:b').lag).toMatchObject({ ms: hours * HOUR, mode });
    }
  });

  it('FR-SCH-9: measureLag aligns to the nearest multiple of the granularity', () => {
    const options = { calendar, granularity: ONE_HOUR };
    const monday = at('2026-03-09');
    expect(measureLag(monday, asDateTimeMs(monday + 90 * MINUTE), 'calendar', options)).toBe(
      2 * HOUR,
    );
    expect(measureLag(monday, asDateTimeMs(monday + 80 * MINUTE), 'calendar', options)).toBe(HOUR);
    expect(measureLag(asDateTimeMs(monday + 90 * MINUTE), monday, 'calendar', options)).toBe(-HOUR);
    const saturday = at('2026-03-07T10:00');
    expect(measureLag(saturday, asDateTimeMs(monday + 100 * MINUTE), 'working', options)).toBe(
      2 * HOUR,
    );
  });
});

describe('explicit lags', () => {
  it('FR-LINK-1, ADR-007: an explicit lag is kept, an omitted one is derived', () => {
    const successor = (durationMode: DurationMode): Task => ({
      id: 'b',
      name: 'B',
      start: '2026-03-09',
      end: '2026-03-10',
      durationMode,
    });
    const links: Link[] = [
      { id: 'two', source: 'a', target: 'b', lag: 2 },
      { id: 'zero', source: 'a', target: 'b', type: 'SS', lag: 0 },
      { id: 'lead', source: 'a', target: 'b', type: 'FF', lag: -1 },
      { id: 'derived', source: 'a', target: 'b', type: 'SF' },
    ];
    for (const mode of ['calendar', 'working'] as const) {
      const graph = graphOf([PREDECESSOR, successor(mode)], links);
      expect(graph.links.map((link) => [link.id, link.lag?.days, link.lag?.derived])).toEqual([
        ['two', 2, false],
        ['zero', 0, false],
        ['lead', -1, false],
        ['derived', mode === 'calendar' ? 9 : 7, true],
      ]);
      expect(graph.links.every((link) => link.lag?.mode === mode)).toBe(true);
    }
  });

  it("FR-SCH-9: a '4h' lag stays in milliseconds", () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', start: '2026-03-02T08:00', end: '2026-03-02T12:00' },
      { id: 'b', name: 'B', start: '2026-03-03T08:00', end: '2026-03-03T10:00' },
    ];
    const graph = graphOf(tasks, [{ source: 'a', target: 'b', lag: '4h' }], { granularity: '1h' });
    expect(record(graph, 'a:FS:b').lag).toEqual({
      ms: 4 * HOUR,
      mode: 'calendar',
      derived: false,
      days: 1 / 6,
    });
  });
});

describe('FS + FF pair', () => {
  it('FR-LINK-2: both constraints are kept between the same tasks', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13', durationMode: 'working' },
    ];
    const graph = graphOf(tasks, [
      { source: 'a', target: 'b', type: 'FS' },
      { source: 'a', target: 'b', type: 'FF' },
    ]);
    expect(graph.issues).toEqual([]);
    expect(graph.successorsOf('a').map((link) => [link.type, link.lag.days])).toEqual([
      ['FS', 0],
      ['FF', 5],
    ]);
    expect(graph.predecessorsOf('b')).toEqual(graph.successorsOf('a'));
    expect(graph.topologicalOrder).toEqual(['a', 'b']);
  });
});

describe('reference checks', () => {
  const tasks: Task[] = [
    { id: 'a', name: 'A', start: '2026-03-02', duration: 2 },
    { id: 'b', name: 'B', start: '2026-03-04', duration: 2, dependencies: ['ghost'] },
  ];

  it('FR-DATA-4: a link to an unknown task is dropped, one issue per missing end', () => {
    const graph = graphOf(tasks, [
      { source: 'x', target: 'y' },
      { source: 'a', target: 'b' },
    ]);
    expect(graph.links.map((link) => link.id)).toEqual(['a:FS:b']);
    expect(graph.linkById.has('x:FS:y')).toBe(false);
    expect(graph.issues).toEqual([
      {
        code: 'unknown-link-task',
        severity: 'error',
        message: 'links[0]: unknown source task "x", dropped',
        path: 'links[0]',
        linkId: 'x:FS:y',
        value: 'x',
      },
      expect.objectContaining({ path: 'links[0]', value: 'y' }),
      {
        code: 'unknown-link-task',
        severity: 'error',
        message: 'tasks[1].dependencies[0]: unknown source task "ghost", dropped',
        path: 'tasks[1].dependencies[0]',
        taskId: 'b',
        linkId: 'ghost:FS:b',
        value: 'ghost',
      },
    ]);
  });

  it('FR-DATA-4: ids are compared with ===', () => {
    const numeric: Task[] = [
      { id: 1, name: 'One', start: '2026-03-02', duration: 1 },
      { id: '1', name: 'One as text', start: '2026-03-03', duration: 1 },
    ];
    const graph = graphOf(numeric, [
      { source: 1, target: '1' },
      { source: 1, target: 2 },
    ]);
    expect(graph.links.map((link) => link.id)).toEqual(['1:FS:1']);
    expect(graph.successorsOf(1)).toHaveLength(1);
    expect(graph.successorsOf('1')).toEqual([]);
    expect(codes(graph.issues)).toEqual(['unknown-link-task@links[1]']);
  });

  it('FR-LINK-7: a self-link is dropped', () => {
    const graph = graphOf(tasks, [{ source: 'a', target: 'a', type: 'SS' }]);
    expect(graph.links).toEqual([]);
    expect(graph.issues).toEqual([
      expect.objectContaining({
        code: 'self-link',
        severity: 'error',
        message: 'links[0]: links task "a" to itself, dropped',
        linkId: 'a:SS:a',
      }),
      expect.objectContaining({ code: 'unknown-link-task' }),
    ]);
  });

  it('FR-LINK-6: a link with the same source, target and type is dropped', () => {
    const graph = graphOf(tasks, [
      { id: 'one', source: 'a', target: 'b' },
      { id: 'two', source: 'a', target: 'b', type: 'FS', lag: 3 },
      { id: 'three', source: 'a', target: 'b', type: 'SS' },
      { id: 'back', source: 'b', target: 'a', type: 'SF' },
    ]);
    expect(graph.links.map((link) => link.id)).toEqual(['one', 'three', 'back']);
    expect(graph.issues[0]).toEqual({
      code: 'duplicate-link',
      severity: 'error',
      message: 'links[1]: same source, target and type as link "one", dropped',
      path: 'links[1]',
      linkId: 'two',
    });
  });
});

describe('inactive links', () => {
  const tasks: Task[] = [
    { id: 'a', name: 'A', start: '2026-03-02', duration: 2 },
    { id: 'p', name: 'Placeholder', type: 'placeholder', start: '2026-03-02', duration: 2 },
    { id: 'n', name: 'No dates' },
    { id: 'i', name: 'Invalid', start: '2026-03-05', end: '2026-03-02' },
    { id: 'b', name: 'B', start: '2026-03-09', duration: 1 },
  ];
  const links: Link[] = [
    { source: 'a', target: 'p' },
    { source: 'n', target: 'a', type: 'SS' },
    { source: 'a', target: 'i', lag: 1 },
    { source: 'p', target: 'n' },
    { source: 'i', target: 'b', type: 'FF' },
    { source: 'a', target: 'b' },
  ];

  it('FR-DATA-3, FR-ROW-3: links to tasks without a bar are kept but inactive', () => {
    const graph = graphOf(tasks, links);
    expect(graph.links.map((link) => [link.id, link.active, link.inCycle, link.lag?.days])).toEqual(
      [
        ['a:FS:p', false, false, undefined],
        ['n:SS:a', false, false, undefined],
        ['a:FS:i', false, false, 1],
        ['p:FS:n', false, false, undefined],
        ['i:FF:b', false, false, undefined],
        ['a:FS:b', true, false, 5],
      ],
    );
    expect(record(graph, 'a:FS:i').lag).toEqual({
      ms: DAY,
      mode: 'calendar',
      derived: false,
      days: 1,
    });
    expect(codes(graph.issues)).toEqual([
      'inactive-link?@links[0]',
      'inactive-link?@links[1]',
      'inactive-link?@links[2]',
      'inactive-link?@links[3]',
      'inactive-link?@links[4]',
    ]);
    expect(graph.issues[3]!.message).toBe(
      'links[3]: no bar on task "p" and "n", the link is inactive',
    );
    expect(record(graph, 'a:FS:p').issues).toEqual([graph.issues[0]]);
  });

  it('FR-LINK-3: inactive links are neither adjacent nor ordered', () => {
    const graph = graphOf(tasks, [...links, { source: 'p', target: 'a' }]);
    expect(graph.successorsOf('a').map((link) => link.id)).toEqual(['a:FS:b']);
    expect(graph.predecessorsOf('a')).toEqual([]);
    expect(graph.predecessorsOf('p')).toEqual([]);
    expect(graph.topologicalOrder).toEqual(['a', 'p', 'n', 'i', 'b']);
    expect(graph.issues.some((issue) => issue.code === 'cycle')).toBe(false);
  });
});

describe('cycles', () => {
  const tasks: Task[] = ['x', 'a', 'b', 'c', 'd', 'e', 'z'].map((id, i) => ({
    id,
    name: id.toUpperCase(),
    start: '2026-03-02',
    duration: i + 1,
  }));
  const links: Link[] = [
    { source: 'c', target: 'a' },
    { source: 'x', target: 'a' },
    { source: 'a', target: 'b' },
    { source: 'e', target: 'd', type: 'FF' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'z' },
    { source: 'd', target: 'e', type: 'SS' },
  ];

  it('FR-LINK-7: each cycle is one issue listing its tasks and links', () => {
    const graph = graphOf(tasks, links);
    expect(graph.issues).toEqual([
      {
        code: 'cycle',
        severity: 'error',
        message: 'tasks "a", "b", "c" form a cycle, its links are not scheduled',
        taskIds: ['a', 'b', 'c'],
        linkIds: ['c:FS:a', 'a:FS:b', 'b:FS:c'],
      },
      {
        code: 'cycle',
        severity: 'error',
        message: 'tasks "d", "e" form a cycle, its links are not scheduled',
        taskIds: ['d', 'e'],
        linkIds: ['e:FF:d', 'd:SS:e'],
      },
    ]);
    expect(graph.links.map((link) => [link.id, link.inCycle])).toEqual([
      ['c:FS:a', true],
      ['x:FS:a', false],
      ['a:FS:b', true],
      ['e:FF:d', true],
      ['b:FS:c', true],
      ['c:FS:z', false],
      ['d:SS:e', true],
    ]);
    expect(record(graph, 'a:FS:b').issues).toEqual([graph.issues[0]]);
    expect(record(graph, 'x:FS:a').issues).toEqual([]);
  });

  it('FR-SCH-5: links on a cycle stay adjacent but leave the order', () => {
    const graph = graphOf(tasks, links);
    expect(graph.successorsOf('c').map((link) => link.id)).toEqual(['c:FS:a', 'c:FS:z']);
    expect(graph.predecessorsOf('a').map((link) => link.id)).toEqual(['c:FS:a', 'x:FS:a']);
    expect(graph.topologicalOrder).toEqual(['x', 'a', 'b', 'c', 'd', 'e', 'z']);
  });

  it('FR-LINK-7: overlapping cycles form one component', () => {
    const graph = graphOf(tasks, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a', type: 'SS' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'b', type: 'FF' },
    ]);
    expect(graph.issues.map((issue) => issue.taskIds)).toEqual([['a', 'b', 'c']]);
  });

  it('FR-LINK-7: a long cycle is named briefly and found without recursion', () => {
    const many: Task[] = Array.from({ length: 20_000 }, (_, i) => ({
      id: i,
      name: `T${i}`,
      start: '2026-03-02',
      duration: 1,
    }));
    const chain: Link[] = many.map((_, i) => ({ source: i, target: (i + 1) % many.length }));
    const graph = graphOf(many, chain);
    expect(graph.issues).toHaveLength(1);
    expect(graph.issues[0]!.message).toBe(
      'tasks 0, 1, 2, 3, 4 and 19995 more form a cycle, its links are not scheduled',
    );
    expect(graph.issues[0]!.taskIds).toHaveLength(20_000);
    expect(graph.topologicalOrder).toHaveLength(20_000);
  });
});

describe('adjacency and order', () => {
  const tasks: Task[] = [1, 2, 3, 4, 5].map((id) => ({
    id,
    name: `T${id}`,
    start: '2026-03-02',
    duration: 1,
  }));

  it('FR-SCH-5: the order is stable, ties keep the model order', () => {
    expect(graphOf(tasks).topologicalOrder).toEqual([1, 2, 3, 4, 5]);
    expect(graphOf(tasks, [{ source: 5, target: 1 }]).topologicalOrder).toEqual([2, 3, 4, 5, 1]);
    const graph = graphOf(tasks, [
      { source: 4, target: 2 },
      { source: 3, target: 2 },
      { source: 5, target: 3 },
    ]);
    expect(graph.topologicalOrder).toEqual([1, 4, 5, 3, 2]);
  });

  it('FR-LINK-1: successors and predecessors in model order, empty for unknown ids', () => {
    const graph = graphOf(tasks, [
      { source: 1, target: 3 },
      { source: 1, target: 2, type: 'SS' },
      { source: 2, target: 3 },
    ]);
    expect(graph.successorsOf(1).map((link) => link.id)).toEqual(['1:FS:3', '1:SS:2']);
    expect(graph.predecessorsOf(3).map((link) => link.id)).toEqual(['1:FS:3', '2:FS:3']);
    expect(graph.successorsOf(3)).toEqual([]);
    expect(graph.successorsOf('missing')).toEqual([]);
    expect(graph.predecessorsOf('1')).toEqual([]);
  });
});

describe('wouldCreateCycle', () => {
  const tasks: Task[] = [
    { id: 'a', name: 'A', start: '2026-03-02', duration: 1 },
    { id: 'b', name: 'B', start: '2026-03-03', duration: 1 },
    { id: 'c', name: 'C', start: '2026-03-04', duration: 1 },
    { id: 'd', name: 'D', start: '2026-03-04', duration: 1 },
    { id: 'p', name: 'P', type: 'placeholder' },
  ];
  const graph = graphOf(tasks, [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'd', target: 'b', type: 'SS' },
    { source: 'c', target: 'p' },
  ]);

  it('FR-LINK-6: a link back up a chain closes a cycle', () => {
    expect(wouldCreateCycle(graph, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(graph, 'b', 'a')).toBe(true);
    expect(wouldCreateCycle(graph, 'c', 'd')).toBe(true);
    expect(wouldCreateCycle(graph, 'a', 'a')).toBe(true);
  });

  it('FR-LINK-6: parallel paths, unknown tasks and inactive links do not', () => {
    expect(wouldCreateCycle(graph, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(graph, 'a', 'd')).toBe(false);
    expect(wouldCreateCycle(graph, 'c', 'ghost')).toBe(false);
    expect(wouldCreateCycle(graph, 'ghost', 'a')).toBe(false);
    expect(wouldCreateCycle(graph, 'p', 'a')).toBe(false);
  });
});

describe('immutability', () => {
  it('FR-DATA-1: never mutates the input and freezes every output', () => {
    const tasks = deepFreeze<Task[]>([
      { id: 'a', name: 'A', start: '2026-03-02', duration: 2 },
      { id: 'b', name: 'B', start: '2026-03-04', duration: 2 },
      { id: 'p', name: 'P', type: 'placeholder' },
    ]);
    const links = deepFreeze<Link[]>([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a', type: 'SS' },
      { source: 'a', target: 'p' },
    ]);
    const model = normalizeModel({ tasks, links }, { calendar });
    const graph = buildLinkGraph(model);
    expect(graph.links.map((link) => link.model)).toEqual(model.links);
    expect(graph.links[0]!.model).toBe(model.links[0]);

    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.links)).toBe(true);
    expect(Object.isFrozen(graph.issues)).toBe(true);
    expect(Object.isFrozen(graph.topologicalOrder)).toBe(true);
    expect(Object.isFrozen(graph.successorsOf('a'))).toBe(true);
    expect(Object.isFrozen(graph.predecessorsOf('a'))).toBe(true);
    expect(Object.isFrozen(graph.successorsOf('p'))).toBe(true);
    for (const link of graph.links) {
      expect(Object.isFrozen(link)).toBe(true);
      expect(Object.isFrozen(link.lag)).toBe(true);
      expect(Object.isFrozen(link.issues)).toBe(true);
    }
    for (const issue of graph.issues) {
      expect(Object.isFrozen(issue)).toBe(true);
      if (issue.taskIds) expect(Object.isFrozen(issue.taskIds)).toBe(true);
      if (issue.linkIds) expect(Object.isFrozen(issue.linkIds)).toBe(true);
    }
    expect(codes(graph.issues)).toEqual(['inactive-link?@links[2]', 'cycle@']);
  });
});
