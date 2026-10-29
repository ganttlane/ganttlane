import type * as Core from '@ganttlane/core';
import type { GanttCore, GanttCoreOptions, GanttSnapshot, LinkType, Task } from '@ganttlane/core';
import { edgeCase, type Fixture, sampleProject } from '@ganttlane/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLayerHarness,
  createTestCore,
  describeLayerContract,
  type LayerHarness,
} from '../../testing';
import { createLinksLayer } from './index';

// The layer must call the core's router, and a test must be able to count the calls: the spy
// wraps the real `routeLink`, `reference` is the untouched one for computing expectations.
vi.mock('@ganttlane/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return { ...actual, routeLink: vi.fn(actual.routeLink) };
});
const reference = await vi.importActual<typeof Core>('@ganttlane/core');
const { routeLink } = await import('@ganttlane/core');

describeLayerContract('links', createLinksLayer);

const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];

// ---- helpers ----

/** The display options a layer test can change (`LayerHarness.setDisplay`). */
type DisplayOptions = Parameters<LayerHarness<'links'>['setDisplay']>[0];

interface Chart {
  readonly core: GanttCore;
  readonly root: SVGGElement;
  readonly harness: LayerHarness<'links'>;
  /** Draws the core's current snapshot, with the previous one as `previous`. */
  redraw(): GanttSnapshot;
  /** Draws the current snapshot again as `update(snapshot, snapshot)` (display-only change). */
  redrawSame(): void;
  /** Changes the display options, as `setDisplay` does, and draws. */
  display(options: DisplayOptions): void;
  /** Scrolls the core to the position and draws. */
  scrollTo(left: number, top: number): GanttSnapshot;
}

const charts: Chart[] = [];
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  charts.length = 0;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(
  core: GanttCore,
  options: { width?: number; height?: number; display?: DisplayOptions } = {},
): Chart {
  core.setViewport({ width: options.width ?? 900, height: options.height ?? 500 });
  const harness = createLayerHarness('links', options.display);
  const layer = createLinksLayer();
  layer.mount(harness.context);
  let previous: GanttSnapshot | undefined;
  const redraw = (): GanttSnapshot => {
    const next = core.getSnapshot();
    layer.update(next, previous);
    previous = next;
    return next;
  };
  redraw();
  cleanups.push(() => {
    layer.destroy();
    core.destroy();
  });
  const chart: Chart = {
    core,
    root: harness.root,
    harness,
    redraw,
    redrawSame: () => {
      layer.update(core.getSnapshot(), core.getSnapshot());
    },
    display: (patch) => {
      harness.setDisplay(patch);
      chart.redrawSame();
    },
    scrollTo: (left, top) => {
      core.scroll({ left, top });
      return redraw();
    },
  };
  charts.push(chart);
  return chart;
}

/** A core over a fixture, like the playground builds one. */
function coreOf(fixture: Fixture, overrides: Partial<GanttCoreOptions> = {}): GanttCore {
  return createTestCore({
    tasks: fixture.tasks,
    links: fixture.links,
    ...(fixture.calendar && { calendar: fixture.calendar }),
    ...fixture.options,
    ...overrides,
  });
}

const groups = (root: Element): SVGGElement[] => [
  ...root.querySelectorAll<SVGGElement>('g.gantt__link'),
];
const idOf = (group: Element): string => group.getAttribute('data-link-id') ?? '';
const drawnIds = (root: Element): string[] => groups(root).map(idOf);
const pathOf = (group: Element, part: 'path' | 'arrow' | 'hit'): string =>
  group.querySelector(`.gantt__link-${part}`)?.getAttribute('d') ?? '';
const groupById = (root: Element, id: string): SVGGElement => {
  const found = groups(root).find((group) => idOf(group) === id);
  if (found === undefined) throw new Error(`Link ${id} is not drawn.`);
  return found;
};
const nodesById = (root: Element): Map<string, SVGGElement> =>
  new Map(groups(root).map((group) => [idOf(group), group]));

const rowGapOf = (snapshot: GanttSnapshot): number =>
  snapshot.layoutOptions.rowHeight - snapshot.layoutOptions.barHeight;

/** Core's router over the bars of the snapshot's layout, found by task id. */
function routeOfLink(snapshot: GanttSnapshot, id: string, radius = 5) {
  const link = snapshot.state.derived.graph.linkById.get(id);
  if (link === undefined) throw new Error(`Link ${id} is not in the graph.`);
  const source = snapshot.layout.getBarRect(link.source);
  const target = snapshot.layout.getBarRect(link.target);
  if (source === undefined || target === undefined) throw new Error(`Link ${id} has no bars.`);
  return reference.routeLink({
    type: link.type,
    source,
    target,
    options: { curveRadius: radius, rowGap: rowGapOf(snapshot) },
  });
}

/**
 * Which links to draw, worked out from scratch: every active link in the graph whose `linkBBox`
 * touches the window (its rows' top and bottom, `left` and `right`), by task id and `getBarRect`
 * instead of the layer's row indexes.
 */
function expectedIds(snapshot: GanttSnapshot, radius = 5): string[] {
  const { layout, window } = snapshot;
  const first = layout.rows.rows[window.firstRow];
  const last = layout.rows.rows[window.lastRow];
  if (first === undefined || last === undefined) return [];
  const top = first.y;
  const bottom = last.y + last.height;
  const ids: string[] = [];
  for (const link of snapshot.state.derived.graph.links) {
    if (!link.active) continue;
    const source = layout.getBarRect(link.source);
    const target = layout.getBarRect(link.target);
    if (source === undefined || target === undefined) continue;
    const box = reference.linkBBox({
      type: link.type,
      source,
      target,
      options: { curveRadius: radius, rowGap: rowGapOf(snapshot) },
    });
    if (
      box.x <= window.right &&
      box.x + box.width >= window.left &&
      box.y <= bottom &&
      box.y + box.height >= top
    ) {
      ids.push(link.id);
    }
  }
  return ids;
}

/** Asserts that what is drawn is exactly what should be, each with the router's `d`. */
function expectPicture(chart: Chart, snapshot: GanttSnapshot, radius = 5): void {
  expect(drawnIds(chart.root)).toEqual(expectedIds(snapshot, radius));
  for (const group of groups(chart.root)) {
    const route = routeOfLink(snapshot, idOf(group), radius);
    expect(pathOf(group, 'path')).toBe(route.d);
    expect(pathOf(group, 'hit')).toBe(route.d);
    expect(pathOf(group, 'arrow')).toBe(route.arrow);
  }
}

/** Task `id` at rows in the order given, from a compact description. */
const task = (id: string, start: string, end: string, extra: Partial<Task> = {}): Task => ({
  id,
  name: id,
  start,
  end,
  ...extra,
});

// ---- tests ----

describe('links layer: structure (FR-LINK-3, FR-SEL-1)', () => {
  it('FR-LINK-3: each link is a group with the route, the arrowhead and the hit path', () => {
    const chart = mount(coreOf(edgeCase('link-types')));

    const all = groups(chart.root);
    expect(all).toHaveLength(8);
    for (const group of all) {
      expect(group.getAttribute('class')).toBe('gantt__link');
      expect([...group.children].map((child) => child.tagName)).toEqual(['path', 'path', 'path']);
      expect([...group.children].map((child) => child.getAttribute('class'))).toEqual([
        'gantt__link-path',
        'gantt__link-arrow',
        'gantt__link-hit',
      ]);
      expect(group.hasAttribute('style')).toBe(false);
      expect(group.querySelector('[style]')).toBeNull();
    }
  });

  it('FR-SEL-1: the group and the hit path carry the link id, the group the type', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const snapshot = chart.core.getSnapshot();

    for (const link of snapshot.state.derived.graph.links) {
      const group = groupById(chart.root, link.id);
      expect(group.getAttribute('data-type')).toBe(link.type);
      const hit = group.querySelector('.gantt__link-hit');
      expect(hit?.getAttribute('data-link-id')).toBe(link.id);
      // A renderer resolves `{ kind: 'link', id }` from whatever it hit.
      expect(hit?.closest('[data-link-id]')?.getAttribute('data-link-id')).toBe(link.id);
      expect(group.querySelector('.gantt__link-path')?.hasAttribute('data-link-id')).toBe(false);
    }
  });

  it('FR-LINK-3: the hit path is the same route as the visible one', () => {
    const chart = mount(coreOf(edgeCase('link-types')));

    for (const group of groups(chart.root)) {
      expect(pathOf(group, 'hit')).not.toBe('');
      expect(pathOf(group, 'hit')).toBe(pathOf(group, 'path'));
    }
  });

  it('draws into the layer root only, and removes it again on destroy', () => {
    const chart = mount(coreOf(edgeCase('link-types')));

    expect(chart.root.getAttribute('class')).toBe('gantt__links');
    expect(chart.root.children.length).toBeGreaterThan(0);
    expect([...chart.root.children].every((child) => child.matches('g.gantt__link'))).toBe(true);
  });
});

describe('links layer: shape (FR-LINK-3)', () => {
  /**
   * A source in the middle and a target in each of the six places a link can go: above and below,
   * each ahead of the source, behind it and overlapping it.
   */
  const SPREAD: readonly Task[] = [
    task('up-ahead', '2026-03-18', '2026-03-20'),
    task('up-behind', '2026-03-02', '2026-03-05'),
    task('up-overlap', '2026-03-11', '2026-03-17'),
    task('source', '2026-03-09', '2026-03-13'),
    task('down-ahead', '2026-03-18', '2026-03-20'),
    task('down-behind', '2026-03-02', '2026-03-05'),
    task('down-overlap', '2026-03-11', '2026-03-17'),
  ];
  const TARGETS = SPREAD.filter((entry) => entry.id !== 'source');

  it.each(LINK_TYPES)(
    'FR-LINK-3: %s links, up and down, ahead, behind and overlapping, equal routeLink',
    (type) => {
      const chart = mount(
        createTestCore({
          tasks: SPREAD,
          links: TARGETS.map((target) => ({ source: 'source', target: target.id, type })),
          scroll: { initial: 'start' },
        }),
      );
      const snapshot = chart.core.getSnapshot();

      expect(drawnIds(chart.root)).toHaveLength(TARGETS.length);
      expectPicture(chart, snapshot);
      // The six routes differ: the test would pass for a layer that drew one shape six times.
      const lines = new Set(groups(chart.root).map((group) => pathOf(group, 'path')));
      expect(lines.size).toBe(TARGETS.length);
    },
  );

  it('FR-LINK-3: the router is given each link, once, with the radius and the row gap', () => {
    vi.mocked(routeLink).mockClear();
    const chart = mount(coreOf(edgeCase('link-types')));
    const snapshot = chart.core.getSnapshot();

    expect(vi.mocked(routeLink)).toHaveBeenCalledTimes(8);
    const calls = vi.mocked(routeLink).mock.calls.map(([input]) => input);
    expect(calls.map((input) => input.type).sort()).toEqual(
      snapshot.state.derived.graph.links.map((link) => link.type).sort(),
    );
    for (const input of calls) {
      expect(input.options).toEqual({ curveRadius: 5, rowGap: rowGapOf(snapshot) });
    }
  });

  it('FR-LINK-3: every type of the link-types edge case equals routeLink', () => {
    const chart = mount(coreOf(edgeCase('link-types')));

    expect(new Set(groups(chart.root).map((group) => group.getAttribute('data-type')))).toEqual(
      new Set(LINK_TYPES),
    );
    expectPicture(chart, chart.core.getSnapshot());
  });

  it('FR-LINK-3: the arrowhead is the router arrow, pointing into the target', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const snapshot = chart.core.getSnapshot();

    for (const group of groups(chart.root)) {
      const arrow = pathOf(group, 'arrow');
      expect(arrow).toBe(routeOfLink(snapshot, idOf(group)).arrow);
      expect(arrow).toMatch(/^M[\d.]+ [\d.]+l-?[\d.]+ -[\d.]+v[\d.]+z$/);
    }
  });
});

describe('links layer: what is drawn (FR-LINK-3, NFR-PERF-1)', () => {
  it('draws the links of the sample project that touch the window, wherever it is', () => {
    const chart = mount(coreOf(sampleProject), { width: 900, height: 300 });
    const all = chart.core
      .getSnapshot()
      .state.derived.graph.links.filter((link) => link.active)
      .map((link) => link.id);
    const seen = new Set<string>();
    let partial = 0;

    for (const top of [0, 500, 1000, 1500]) {
      for (let left = 0; left <= 4800; left += 300) {
        const snapshot = chart.scrollTo(left, top);
        expectPicture(chart, snapshot);
        for (const id of drawnIds(chart.root)) seen.add(id);
        const count = drawnIds(chart.root).length;
        if (count > 0 && count < all.length) partial++;
      }
    }

    // The sweep has teeth: windows that show some links and not others, and together all.
    expect(partial).toBeGreaterThan(5);
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it('draws a link whose ends are both outside the window but whose path crosses it', () => {
    // 33 rows; the two tasks of rows 12 and 13 are a year later than the rest.
    const tasks = Array.from({ length: 33 }, (_, i) =>
      i === 12 || i === 13
        ? task(`late-${i}`, '2027-03-02', '2027-03-04')
        : task(`t${i}`, '2026-03-02', '2026-03-04'),
    );
    const chart = mount(
      createTestCore({
        tasks,
        links: [
          { source: 't0', target: 't32', type: 'FS' },
          { source: 'late-12', target: 'late-13', type: 'FS' },
        ],
        scroll: { initial: 'start' },
      }),
      { width: 900, height: 330 },
    );

    // Rows 10 … 25 are in the window, rows 0 and 32 are not.
    const snapshot = chart.scrollTo(0, 48 * 15);
    expect(snapshot.window.firstRow).toBeGreaterThan(0);
    expect(snapshot.window.lastRow).toBeLessThan(32);
    // The long link crosses the window; the link between two tasks of the rows in it does not,
    // as it lies a year to the right.
    expect(drawnIds(chart.root)).toEqual(['t0:FS:t32']);
    expectPicture(chart, snapshot);

    chart.scrollTo(0, 0);
    expect(drawnIds(chart.root)).toEqual(['t0:FS:t32']);
  });

  it('draws nothing when the viewport shows no rows', () => {
    const chart = mount(coreOf(edgeCase('link-types')), { height: 75 });

    expect(chart.core.getSnapshot().window.firstRow).toBeGreaterThan(
      chart.core.getSnapshot().window.lastRow,
    );
    expect(drawnIds(chart.root)).toEqual([]);
  });

  it('FR-ROW-2: links of rows hidden by a collapsed parent are not drawn', () => {
    const core = createTestCore({
      tasks: [
        task('p', '2026-03-02', '2026-03-13'),
        task('c1', '2026-03-02', '2026-03-05', { parentId: 'p' }),
        task('c2', '2026-03-06', '2026-03-10', { parentId: 'p' }),
        task('d', '2026-03-16', '2026-03-20'),
      ],
      links: [
        { source: 'c1', target: 'c2', type: 'FS' },
        { source: 'c2', target: 'd', type: 'FS' },
        { source: 'p', target: 'd', type: 'FS' },
      ],
      scroll: { initial: 'start' },
    });
    const chart = mount(core);
    expect(drawnIds(chart.root)).toEqual(['c1:FS:c2', 'c2:FS:d', 'p:FS:d']);
    const parentLink = groupById(chart.root, 'p:FS:d');

    core.collapse('p');
    const collapsed = chart.redraw();

    // A link into a hidden task is not re-pointed at its parent's row: it is simply not drawn.
    expect(drawnIds(chart.root)).toEqual(['p:FS:d']);
    expect(groupById(chart.root, 'p:FS:d')).toBe(parentLink);
    expectPicture(chart, collapsed);

    core.expand('p');
    const expanded = chart.redraw();

    expect(drawnIds(chart.root)).toEqual(['c1:FS:c2', 'c2:FS:d', 'p:FS:d']);
    expect(groupById(chart.root, 'p:FS:d')).toBe(parentLink);
    expectPicture(chart, expanded);
  });

  it('FR-ROW-3: links that touch a task without a bar are not drawn', () => {
    const tasks: Task[] = [
      ...edgeCase('no-dates').tasks,
      task('later', '2026-03-09', '2026-03-12'),
    ];
    const chart = mount(
      createTestCore({
        tasks,
        links: [
          { source: 'dated', target: 'placeholder' },
          { source: 'start-only', target: 'dated' },
          { source: 'dated', target: 'later' },
        ],
        scroll: { initial: 'start' },
      }),
    );
    const graph = chart.core.getSnapshot().state.derived.graph;

    // The graph keeps the links to rows without a bar, as inactive.
    expect(graph.links.filter((link) => !link.active)).toHaveLength(2);
    expect(drawnIds(chart.root)).toEqual(['dated:FS:later']);
  });

  it('ignores links the graph dropped (unknown task, self link, duplicate)', () => {
    const chart = mount(coreOf(edgeCase('unknown-link-target')));
    expect(drawnIds(chart.root)).toEqual(['a:FS:b']);

    const cycles = mount(coreOf(edgeCase('link-cycle')));
    // The self link D -> D is not in the graph; the rest is.
    expect(drawnIds(cycles.root)).toEqual(['A:FS:B', 'B:FS:C', 'C:FS:A', 'E:FS:F']);
  });

  it('FR-LINK-3: the curve radius follows the display options', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const snapshot = chart.core.getSnapshot();
    const nodes = nodesById(chart.root);
    const rounded = groups(chart.root).map((group) => pathOf(group, 'path'));
    expect(rounded.some((d) => d.includes('a'))).toBe(true);

    chart.display({ linkCurveRadius: 0 });
    expectPicture(chart, snapshot, 0);
    for (const group of groups(chart.root)) {
      expect(pathOf(group, 'path')).not.toMatch(/a/);
      expect(nodes.get(idOf(group))).toBe(group);
    }

    chart.display({ linkCurveRadius: 12 });
    expectPicture(chart, snapshot, 12);
    expect(groups(chart.root).map((group) => pathOf(group, 'path'))).not.toEqual(rounded);

    chart.display({ linkCurveRadius: 5 });
    expectPicture(chart, snapshot, 5);
    expect(groups(chart.root).map((group) => pathOf(group, 'path'))).toEqual(rounded);
  });

  it('NFR-PERF-1: display options that do not touch links write nothing and route nothing', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const writes = spyOnWrites();
    vi.mocked(routeLink).mockClear();

    chart.display({ gridLines: 'none', today: false });
    chart.display({ linkCurveRadius: 5 });

    expect(writes.calls()).toBe(0);
    expect(vi.mocked(routeLink)).not.toHaveBeenCalled();
  });
});

describe('links layer: state flags (FR-SEL-1, FR-SCH-6, FR-LINK-7)', () => {
  it('FR-SEL-1: marks the selected link and moves the mark with the selection', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const nodes = nodesById(chart.root);
    const selected = (): string[] =>
      groups(chart.root)
        .filter((group) => group.hasAttribute('data-selected'))
        .map(idOf);
    expect(selected()).toEqual([]);

    chart.core.selectLink('a:SS:ss');
    chart.redraw();
    expect(selected()).toEqual(['a:SS:ss']);
    expect(groupById(chart.root, 'a:SS:ss').getAttribute('data-selected')).toBe('');

    chart.core.selectLink('a:FF:ff');
    chart.redraw();
    expect(selected()).toEqual(['a:FF:ff']);

    chart.core.clearSelection();
    chart.redraw();
    expect(selected()).toEqual([]);
    for (const group of groups(chart.root)) expect(nodes.get(idOf(group))).toBe(group);
  });

  it('FR-SEL-1: a selection change writes only the two groups it concerns', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    chart.core.selectLink('a:SS:ss');
    chart.redraw();
    const writes = spyOnWrites();
    vi.mocked(routeLink).mockClear();

    chart.core.selectLink('a:FF:ff');
    chart.redraw();

    expect(writes.targets()).toEqual(
      new Set([groupById(chart.root, 'a:SS:ss'), groupById(chart.root, 'a:FF:ff')]),
    );
    expect(vi.mocked(routeLink)).not.toHaveBeenCalled();
  });

  it('FR-SEL-1: a selected link that is not in the window leaves nothing selected', () => {
    const chart = mount(coreOf(sampleProject), { width: 900, height: 300 });
    chart.core.selectLink('group-5:FS:group-6');
    chart.scrollTo(0, 0);

    expect(drawnIds(chart.root)).not.toContain('group-5:FS:group-6');
    expect(chart.root.querySelector('[data-selected]')).toBeNull();
  });

  it('FR-SCH-6: marks the links that a link-violated conflict names', () => {
    const core = createTestCore({
      tasks: [
        task('a', '2026-03-02', '2026-03-06'),
        task('b', '2026-03-04', '2026-03-06'),
        task('c', '2026-03-09', '2026-03-12'),
      ],
      // Explicit lags: `b` starts before `a` ends although the link wants no overlap.
      links: [
        { source: 'a', target: 'b', type: 'FS', lag: 0 },
        { source: 'a', target: 'c', type: 'FS', lag: 0 },
      ],
      scroll: { initial: 'start' },
    });
    const chart = mount(core);
    const snapshot = chart.core.getSnapshot();
    const violated = [...snapshot.state.derived.conflicts.values()]
      .flat()
      .flatMap((conflict) => (conflict.type === 'link-violated' ? [conflict.linkId] : []));
    expect(violated).toEqual(['a:FS:b']);

    const flagged = groups(chart.root)
      .filter((group) => group.hasAttribute('data-conflict'))
      .map(idOf);
    expect(flagged).toEqual(violated);
    expect(groupById(chart.root, 'a:FS:b').getAttribute('data-conflict')).toBe('');

    // Moving `b` clear of `a` resolves the conflict, and the mark goes.
    core.setTasks([
      task('a', '2026-03-02', '2026-03-06'),
      task('b', '2026-03-09', '2026-03-11'),
      task('c', '2026-03-09', '2026-03-12'),
    ]);
    chart.redraw();
    expect(chart.root.querySelector('[data-conflict]')).toBeNull();
  });

  it('FR-LINK-7: marks the links on a cycle', () => {
    const chart = mount(coreOf(edgeCase('link-cycle')));
    const snapshot = chart.core.getSnapshot();
    const onCycle = snapshot.state.derived.graph.links
      .filter((link) => link.active && link.inCycle)
      .map((link) => link.id);
    expect(onCycle).toEqual(['A:FS:B', 'B:FS:C', 'C:FS:A']);

    const flagged = groups(chart.root)
      .filter((group) => group.hasAttribute('data-cycle'))
      .map(idOf);
    expect(flagged).toEqual(onCycle);
    // Cycle links are drawn like any other, with their route.
    expectPicture(chart, snapshot);
    expect(groupById(chart.root, 'E:FS:F').hasAttribute('data-cycle')).toBe(false);
  });

  it('the flags are independent and clear when their cause goes', () => {
    const chart = mount(coreOf(edgeCase('link-cycle')));
    chart.core.selectLink('B:FS:C');
    chart.redraw();
    const group = groupById(chart.root, 'B:FS:C');
    expect(group.hasAttribute('data-selected')).toBe(true);
    expect(group.hasAttribute('data-cycle')).toBe(true);

    chart.core.setLinks([{ source: 'A', target: 'B', type: 'FS' }]);
    chart.redraw();

    // The cycle is gone, and so is the selected link.
    expect(drawnIds(chart.root)).toEqual(['A:FS:B']);
    expect(groupById(chart.root, 'A:FS:B').hasAttribute('data-cycle')).toBe(false);
    expect(chart.root.querySelector('[data-selected]')).toBeNull();
  });
});

describe('links layer: updates (NFR-PERF-1, NFR-PERF-2)', () => {
  it('NFR-PERF-2: a scroll that leaves the same links in the window writes nothing', () => {
    const chart = mount(coreOf(sampleProject), { width: 900, height: 300 });
    const first = chart.core.getSnapshot();
    const before = groups(chart.root);
    expect(before.length).toBeGreaterThan(0);
    const writes = spyOnWrites();
    vi.mocked(routeLink).mockClear();

    let previous = first;
    for (let step = 1; step <= 5; step++) {
      const snapshot = chart.scrollTo(first.timeline.scrollLeft + step, first.scrollTop);
      // A new window every time, but the same links in it.
      expect(snapshot.window).not.toBe(previous.window);
      expect(drawnIds(chart.root)).toEqual(expectedIds(snapshot));
      previous = snapshot;
    }

    expect(groups(chart.root)).toHaveLength(before.length);
    groups(chart.root).forEach((group, i) => {
      expect(group).toBe(before[i]);
    });
    expect(writes.calls()).toBe(0);
    expect(vi.mocked(routeLink)).not.toHaveBeenCalled();
  });

  it('NFR-PERF-2: a draw with nothing new (the same snapshot again) does nothing', () => {
    const chart = mount(coreOf(sampleProject), { width: 900, height: 300 });
    const writes = spyOnWrites();
    vi.mocked(routeLink).mockClear();

    chart.redrawSame();
    chart.redraw();

    expect(writes.calls()).toBe(0);
    expect(vi.mocked(routeLink)).not.toHaveBeenCalled();
  });

  it('NFR-PERF-1: a scroll that changes the set adds and removes only the links that moved', () => {
    const chart = mount(coreOf(sampleProject), { width: 900, height: 300 });
    let before = nodesById(chart.root);
    let moved = 0;

    for (const [left, top] of [
      [1200, 0],
      [2400, 0],
      [2400, 700],
      [1200, 1400],
      [0, 700],
    ] as const) {
      const snapshot = chart.scrollTo(left, top);
      const after = nodesById(chart.root);
      expectPicture(chart, snapshot);
      for (const [id, node] of after) {
        if (before.has(id)) {
          expect(node).toBe(before.get(id));
        } else {
          moved++;
        }
      }
      for (const [id, node] of before) {
        if (!after.has(id)) {
          moved++;
          expect(node.isConnected).toBe(false);
        }
      }
      before = after;
    }

    // The sweep has teeth: links did enter and leave.
    expect(moved).toBeGreaterThan(2);
  });

  it('FR-EDIT-5: a drag preview re-routes only the links of the bars that moved', () => {
    const core = createTestCore({
      tasks: [
        task('a', '2026-03-02', '2026-03-06'),
        task('b', '2026-03-09', '2026-03-13'),
        task('c', '2026-03-02', '2026-03-04'),
        task('d', '2026-03-09', '2026-03-11'),
        task('e', '2026-03-16', '2026-03-20'),
        task('f', '2026-03-23', '2026-03-25'),
      ],
      links: [
        { source: 'a', target: 'b', type: 'FS' },
        { source: 'c', target: 'd', type: 'FS' },
        { source: 'e', target: 'f', type: 'SS' },
      ],
      scroll: { initial: 'start' },
    });
    const chart = mount(core);
    const resting = chart.core.getSnapshot();
    const nodes = nodesById(chart.root);
    const restingPaths = new Map(
      [...nodes].map(([id, group]) => [id, pathOf(group, 'path')] as const),
    );
    const bar = core.getBarRect('a')!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width / 2;
    const writes = spyOnWrites();
    vi.mocked(routeLink).mockClear();

    core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
    core.send({ type: 'move', pointerId: 1, x: x + 80, y, time: 1 });
    const dragging = chart.redraw();

    // Dragging `a` two days moved it and its successor `b`.
    expect(dragging.state.draft).toBeDefined();
    expect([...dragging.state.draft!.patches.keys()].sort()).toEqual(['a', 'b']);
    expect(dragging.layout.getBarRect('a')!.x).toBe(bar.x + 80);
    expectPicture(chart, dragging);
    // Only the link between the two that moved changed, and was routed again.
    const changed = [...nodes]
      .filter(([id, group]) => pathOf(group, 'path') !== restingPaths.get(id))
      .map(([id]) => id);
    expect(changed).toEqual(['a:FS:b']);
    expect(vi.mocked(routeLink)).toHaveBeenCalledTimes(1);
    expect(writes.targets()).toEqual(new Set([...groupById(chart.root, 'a:FS:b').children]));
    for (const [id, group] of nodes) expect(groupById(chart.root, id)).toBe(group);

    // Cancelling puts the bars back and re-routes the same one.
    writes.reset();
    vi.mocked(routeLink).mockClear();
    core.send({ type: 'key', key: 'Escape' });
    const cancelled = chart.redraw();

    expect(cancelled.state.draft).toBeUndefined();
    expectPicture(chart, cancelled);
    expect(vi.mocked(routeLink)).toHaveBeenCalledTimes(1);
    for (const [id, group] of nodes) expect(pathOf(group, 'path')).toBe(restingPaths.get(id));
    expect(cancelled.layout.getBarRect('a')).toEqual(resting.layout.getBarRect('a'));
  });

  it('FR-EDIT-5: every step of a drag moves the links with it, nothing else', () => {
    const core = createTestCore({
      tasks: [
        task('a', '2026-03-02', '2026-03-06'),
        task('b', '2026-03-09', '2026-03-13'),
        task('c', '2026-03-02', '2026-03-04'),
        task('d', '2026-03-09', '2026-03-11'),
      ],
      links: [
        { source: 'a', target: 'b', type: 'FS' },
        { source: 'c', target: 'd', type: 'FS' },
      ],
      scroll: { initial: 'start' },
    });
    const chart = mount(core);
    const bar = core.getBarRect('a')!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width / 2;
    const untouched = pathOf(groupById(chart.root, 'c:FS:d'), 'path');
    core.send({ type: 'down', pointerId: 1, x, y, time: 0 });

    const routes = new Set<string>();
    const positions = new Set<number>();
    for (const days of [1, 2, 3, 2, 1, -1, -2]) {
      core.send({ type: 'move', pointerId: 1, x: x + days * 40, y, time: 1 });
      const snapshot = chart.redraw();
      expectPicture(chart, snapshot);
      routes.add(pathOf(groupById(chart.root, 'a:FS:b'), 'path'));
      positions.add(snapshot.layout.getBarRect('a')!.x);
      expect(pathOf(groupById(chart.root, 'c:FS:d'), 'path')).toBe(untouched);
    }
    // The link took one route per place the bar was, and there were several places.
    expect(positions.size).toBeGreaterThan(2);
    expect(routes.size).toBe(positions.size);
  });

  it('FR-DATA-7: a data change that moves no bar keeps every route and writes nothing', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const nodes = nodesById(chart.root);
    const { tasks, derived } = chart.core.getSnapshot().state;
    const writes = spyOnWrites();
    vi.mocked(routeLink).mockClear();

    // Equal tasks in new objects: a new model and link graph, the same picture.
    chart.core.setTasks(tasks.map((entry) => ({ ...entry })));
    const snapshot = chart.redraw();

    expect(snapshot.state.derived.graph).not.toBe(derived.graph);
    expect(writes.calls()).toBe(0);
    expect(vi.mocked(routeLink)).not.toHaveBeenCalled();
    for (const [id, group] of nodes) expect(groupById(chart.root, id)).toBe(group);
  });

  it('FR-DATA-7: a changed task re-routes the links of that task only', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const nodes = nodesById(chart.root);
    const before = new Map([...nodes].map(([id, group]) => [id, pathOf(group, 'path')] as const));
    const tasks = chart.core.getSnapshot().state.tasks;
    vi.mocked(routeLink).mockClear();

    chart.core.setTasks(
      tasks.map((entry) => (entry.id === 'ss' ? { ...entry, start: '2026-03-03' } : entry)),
    );
    const snapshot = chart.redraw();

    expectPicture(chart, snapshot);
    const changed = [...nodes]
      .filter(([id, group]) => pathOf(group, 'path') !== before.get(id))
      .map(([id]) => id);
    expect(changed).toEqual(['a:SS:ss']);
    expect(vi.mocked(routeLink)).toHaveBeenCalledTimes(1);
  });

  it('FR-DATA-7: added links appear, removed ones go, the rest keep their nodes', () => {
    const chart = mount(coreOf(edgeCase('link-types')));
    const nodes = nodesById(chart.root);
    const links = chart.core.getSnapshot().state.links ?? [];
    vi.mocked(routeLink).mockClear();

    chart.core.setLinks([
      ...links.filter((link) => link.type !== 'FF'),
      { source: 'lag', target: 'default', type: 'FS' },
    ]);
    const snapshot = chart.redraw();

    expectPicture(chart, snapshot);
    const after = nodesById(chart.root);
    expect([...after.keys()]).not.toContain('a:FF:ff');
    expect([...after.keys()]).toContain('lag:FS:default');
    for (const [id, group] of after) {
      if (nodes.has(id)) expect(group).toBe(nodes.get(id));
    }
    expect(nodes.get('a:FF:ff')?.isConnected).toBe(false);
    // The two FF links are gone; only the new link needed a route.
    expect(vi.mocked(routeLink)).toHaveBeenCalledTimes(1);
  });

  it('FR-LINK-1: a link whose type changes under the same id changes its type and route', () => {
    const chart = mount(
      createTestCore({
        tasks: [task('a', '2026-03-02', '2026-03-06'), task('b', '2026-03-09', '2026-03-13')],
        links: [{ id: 'dep', source: 'a', target: 'b', type: 'FS' }],
        scroll: { initial: 'start' },
      }),
    );
    const node = groupById(chart.root, 'dep');
    const before = pathOf(node, 'path');

    chart.core.setLinks([{ id: 'dep', source: 'a', target: 'b', type: 'SS' }]);
    chart.redraw();

    expect(groupById(chart.root, 'dep')).toBe(node);
    expect(node.getAttribute('data-type')).toBe('SS');
    expect(pathOf(node, 'path')).not.toBe(before);
    expectPicture(chart, chart.core.getSnapshot());
  });

  it('keeps the links in graph order while others come and go', () => {
    const chart = mount(coreOf(sampleProject), { width: 900, height: 300 });

    for (const [left, top] of [
      [0, 0],
      [2400, 700],
      [1200, 0],
      [0, 1400],
    ] as const) {
      chart.scrollTo(left, top);
      const order = chart.core
        .getSnapshot()
        .state.derived.graph.links.map((link) => link.id)
        .filter((id) => drawnIds(chart.root).includes(id));
      expect(drawnIds(chart.root)).toEqual(order);
    }
  });
});

describe('links layer: lifecycle', () => {
  it('FR-API-4: destroy removes every link and a later update draws nothing', () => {
    const core = coreOf(edgeCase('link-types'));
    core.setViewport({ width: 900, height: 500 });
    const harness = createLayerHarness('links');
    const layer = createLinksLayer();
    layer.mount(harness.context);
    layer.update(core.getSnapshot(), undefined);
    expect(harness.root.childNodes.length).toBeGreaterThan(0);

    layer.destroy();
    layer.update(core.getSnapshot(), undefined);

    expect(harness.root.childNodes).toHaveLength(0);
    core.destroy();
  });

  it('draws again after being mounted anew, as one layer per chart instance', () => {
    const core = coreOf(edgeCase('link-types'));
    const first = mount(core);
    const second = mount(coreOf(edgeCase('link-types')));

    expect(drawnIds(first.root)).toEqual(drawnIds(second.root));
    expect(first.root).not.toBe(second.root);
    expect(nodesById(first.root).get('a:SS:ss')).not.toBe(nodesById(second.root).get('a:SS:ss'));
  });
});

// ---- DOM write counting ----

/** What {@link spyOnWrites} has seen. */
interface WriteSpy {
  /** Mutating calls so far. */
  calls(): number;
  /** Nodes mutated so far. */
  targets(): Set<Node>;
  /** Forgets what was seen. */
  reset(): void;
}

/**
 * Counts the DOM mutations of the page: attribute writes and removals, and child list changes.
 * Spies on the prototypes, so it sees every node.
 */
function spyOnWrites(): WriteSpy {
  const targets = new Set<Node>();
  let count = 0;
  const watch = (proto: object, name: string): void => {
    const methods = proto as Record<string, (this: Node, ...args: unknown[]) => unknown>;
    const original = methods[name]!;
    vi.spyOn(methods, name).mockImplementation(function (this: Node, ...args: unknown[]) {
      count++;
      targets.add(this);
      return original.apply(this, args);
    });
  };
  watch(Element.prototype, 'setAttribute');
  watch(Element.prototype, 'removeAttribute');
  watch(Node.prototype, 'insertBefore');
  watch(Node.prototype, 'appendChild');
  watch(Node.prototype, 'removeChild');
  watch(Element.prototype, 'append');
  return {
    calls: () => count,
    targets: () => targets,
    reset: () => {
      count = 0;
      targets.clear();
    },
  };
}
