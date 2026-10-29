import type { CalendarDay, GanttCoreOptions, GanttSnapshot, Task } from '@ganttlane/core';
import type { Fixture } from '@ganttlane/fixtures';
import { fixtureCatalog } from '@ganttlane/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayerHarness, createTestCore, describeLayerContract } from '../../testing';
import { createGridLayer } from './index';

describeLayerContract('grid', createGridLayer);

// The day mode draws 40 px per day; the test core starts at 2026-02-16 (x = 0), so 2026-03-04 is
// at x = 640 and the chart opens scrolled there. Today is a fixed clock reading.
const TODAY = new Date(2026, 2, 4, 10, 30);
const DAY_MS = 86_400_000;

/** The display options a layer harness takes (`DisplayOptions` of the renderer). */
type DisplayOptions = NonNullable<Parameters<typeof createLayerHarness>[1]>;

interface ChartOptions {
  readonly core?: Partial<GanttCoreOptions>;
  readonly viewMode?: string;
  readonly display?: DisplayOptions;
  readonly viewport?: { readonly width: number; readonly height: number };
}

/** Mounts a grid layer over a real core; `redraw()` feeds it the core's current snapshot. */
function chart({ core: coreOptions, viewMode, display, viewport }: ChartOptions = {}) {
  // The core's clock is the (faked) system clock, which a test moves and then `refreshNow()`s.
  const core = createTestCore({ now: () => new Date(), ...coreOptions });
  core.setViewport(viewport ?? { width: 800, height: 400 });
  if (viewMode !== undefined) core.setViewMode(viewMode);
  const harness = createLayerHarness('grid', display);
  const layer = createGridLayer();
  layer.mount(harness.context);
  let shown: GanttSnapshot = core.getSnapshot();
  layer.update(shown, undefined);
  return {
    core,
    harness,
    layer,
    root: harness.root,
    /** Draws the core's current snapshot and returns it. */
    redraw(): GanttSnapshot {
      const previous = shown;
      shown = core.getSnapshot();
      layer.update(shown, previous);
      return shown;
    },
    /** Draws the same snapshot again, as the renderer does after `setDisplay`. */
    refresh(): void {
      layer.update(shown, shown);
    },
  };
}

const all = <E extends Element = SVGElement>(root: Element, selector: string): E[] => [
  ...root.querySelectorAll<E>(selector),
];
const rows = (root: Element): SVGElement[] => all(root, '.gantt__row');
const days = (root: Element): SVGElement[] => all(root, '.gantt__nonworking-day');
const lines = (root: Element): SVGElement[] => all(root, '.gantt__gridline');
const num = (element: Element, name: string): number => Number(element.getAttribute(name));
const weekday = (element: Element): number =>
  new Date(num(element, 'data-day') * DAY_MS).getUTCDay();
const dayKeyOf = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** Records every DOM write below `root` (attributes, children, text) until `take()`. */
function watch(root: Element): { take(): MutationRecord[]; stop(): void } {
  const observer = new MutationObserver(() => undefined);
  observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
  return {
    take: () => observer.takeRecords(),
    stop: () => {
      observer.disconnect();
    },
  };
}

const GROUPS: readonly Task[] = [
  { id: 'g1', name: 'G1', start: '2026-03-02', end: '2026-03-06' },
  { id: 'g1a', name: 'G1a', parentId: 'g1', start: '2026-03-02', end: '2026-03-04' },
  { id: 'g2', name: 'G2', start: '2026-03-09', end: '2026-03-13' },
  { id: 'g2a', name: 'G2a', parentId: 'g2', start: '2026-03-09', end: '2026-03-11' },
  { id: 'g3', name: 'G3', start: '2026-03-16', end: '2026-03-20' },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('grid structure', () => {
  it('FR-UI-1: the groups sit in g.gantt__grid in the contract order', () => {
    const { root } = chart();

    expect([...root.children].map((child) => child.getAttribute('class'))).toEqual([
      'gantt__rows',
      'gantt__nonworking',
      'gantt__highlights',
      'gantt__gridlines',
      'gantt__today',
    ]);
  });

  it('NFR-PERF-2: reads no layout', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const { core, redraw } = chart();

    core.scroll({ left: 2000, top: 0 });
    redraw();

    expect(rect).not.toHaveBeenCalled();
  });
});

describe('row backgrounds (FR-ROW-3, FR-ROW-4)', () => {
  it('FR-ROW-3: draws a background for each visible row, across the content', () => {
    const { core, root } = chart();

    const { contentWidth } = core.getSnapshot();
    expect(rows(root).map((row) => row.getAttribute('data-task-id'))).toEqual([
      'design',
      'build',
      'phase',
      'child',
    ]);
    expect(rows(root).map((row) => row.getAttribute('data-row'))).toEqual(['0', '1', '2', '3']);
    expect(rows(root).map((row) => num(row, 'y'))).toEqual([0, 48, 96, 144]);
    for (const row of rows(root)) {
      expect(num(row, 'x')).toBe(0);
      expect(num(row, 'width')).toBe(contentWidth);
      expect(num(row, 'height')).toBe(48);
    }
  });

  it('FR-ROW-3: a collapsed parent hides its children`s rows and the others move up', () => {
    const { core, root, redraw } = chart();
    const build = rows(root)[1]!;

    core.collapse('phase');
    redraw();

    expect(rows(root).map((row) => row.getAttribute('data-task-id'))).toEqual([
      'design',
      'build',
      'phase',
    ]);
    expect(rows(root)[1]).toBe(build);
  });

  it('FR-ROW-3: a row of an invalid task has data-invalid, a placeholder row data-placeholder', () => {
    const { root } = chart({
      core: {
        tasks: [
          { id: 'ok', name: 'Ok', start: '2026-03-02', end: '2026-03-04' },
          { id: 'bad', name: 'Bad', start: '2026-03-05', end: '2026-03-01' },
          { id: 'plan', name: 'Plan', type: 'placeholder' },
          { id: 'undated', name: 'Undated' },
        ],
      },
    });

    const flags = (id: string): [boolean, boolean] => {
      const row = rows(root).find((candidate) => candidate.dataset.taskId === id)!;
      return [row.hasAttribute('data-invalid'), row.hasAttribute('data-placeholder')];
    };
    expect(flags('ok')).toEqual([false, false]);
    expect(flags('bad')).toEqual([true, false]);
    expect(flags('plan')).toEqual([false, true]);
    expect(flags('undated')).toEqual([false, true]);
  });

  it('FR-ROW-4: the rowClassName of a task joins the class of its row, tidied', () => {
    const { root } = chart({
      core: {
        tasks: [
          {
            id: 'a',
            name: 'A',
            start: '2026-03-02',
            end: '2026-03-04',
            rowClassName: ' hot   special ',
          },
          { id: 'b', name: 'B', start: '2026-03-02', end: '2026-03-04', rowClassName: '' },
          { id: 'c', name: 'C', start: '2026-03-02', end: '2026-03-04' },
        ],
      },
    });

    expect(rows(root).map((row) => row.getAttribute('class'))).toEqual([
      'gantt__row hot special',
      'gantt__row',
      'gantt__row',
    ]);
  });

  it('FR-ROW-4: zebra by row marks every second row', () => {
    const { root } = chart({ core: { tasks: GROUPS }, display: { rowStripes: 'row' } });

    expect(rows(root).map((row) => row.hasAttribute('data-stripe'))).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it('FR-ROW-4: zebra by group keeps a parent and its children together', () => {
    const { root } = chart({ core: { tasks: GROUPS }, display: { rowStripes: 'group' } });

    expect(rows(root).map((row) => row.hasAttribute('data-stripe'))).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it('FR-ROW-4: rowStripes = false marks nothing', () => {
    const { root } = chart({ core: { tasks: GROUPS } });

    expect(root.querySelector('[data-stripe]')).toBeNull();
  });

  it('FR-ROW-4: the stripes follow display changes, on the nodes that are there', () => {
    const { harness, root, refresh } = chart({ core: { tasks: GROUPS } });
    const before = rows(root);

    harness.setDisplay({ rowStripes: 'row' });
    refresh();
    expect(rows(root).filter((row) => row.hasAttribute('data-stripe'))).toHaveLength(2);

    harness.setDisplay({ rowStripes: 'group' });
    refresh();
    expect(rows(root).filter((row) => row.hasAttribute('data-stripe'))).toHaveLength(2);
    expect(rows(root)[2]!.hasAttribute('data-stripe')).toBe(true);

    harness.setDisplay({ rowStripes: false });
    refresh();
    expect(root.querySelector('[data-stripe]')).toBeNull();
    rows(root).forEach((row, i) => {
      expect(row).toBe(before[i]);
    });
  });

  it('NFR-PERF-3: only the rows of the window exist, and a vertical scroll reuses them', () => {
    const tasks = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`,
      name: `Task ${i}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    const { core, root, redraw } = chart({ core: { tasks } });
    const first = core.getSnapshot().window;
    expect(rows(root)).toHaveLength(first.lastRow - first.firstRow + 1);
    expect(rows(root).length).toBeLessThan(20);
    const before = rows(root);

    core.scroll({ left: 640, top: 480 });
    const next = redraw();

    expect(next.window.firstRow).toBeGreaterThan(0);
    expect(rows(root).map((row) => row.dataset.row)).toEqual(
      Array.from({ length: next.window.lastRow - next.window.firstRow + 1 }, (_, i) =>
        String(next.window.firstRow + i),
      ),
    );
    // Rows that were in both windows are the same nodes.
    expect(rows(root).filter((row) => before.includes(row)).length).toBeGreaterThan(3);
  });

  it('NFR-PERF-1: a change of a task`s data redraws no row node', () => {
    const { core, root, redraw } = chart();
    const before = rows(root);

    core.setTasks([
      { id: 'design', name: 'Renamed', start: '2026-03-03', end: '2026-03-06' },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
      { id: 'phase', name: 'Phase', start: '2026-04-06', end: '2026-04-17' },
      { id: 'child', name: 'Child', parentId: 'phase', start: '2026-04-13', end: '2026-04-17' },
    ]);
    redraw();

    rows(root).forEach((row, i) => {
      expect(row).toBe(before[i]);
    });
  });
});

describe('non-working days (FR-UI-2)', () => {
  it('FR-UI-2: fill mode draws a rect for each weekend day of the visible time', () => {
    const { core, root } = chart();

    const group = root.querySelector('.gantt__nonworking')!;
    expect(group.getAttribute('data-mode')).toBe('fill');
    expect(days(root).length).toBeGreaterThan(8);
    expect(days(root).every((day) => [0, 6].includes(weekday(day)))).toBe(true);
    expect(days(root).every((day) => day.getAttribute('data-reason') === 'weekend')).toBe(true);
    // Geometry: a day column, as tall as the body, no pattern fill.
    const sunday = days(root).find((day) => num(day, 'data-day') === dayKeyOf('2026-03-08'))!;
    expect(num(sunday, 'x')).toBe(
      core.getSnapshot().header.scale.dateToX(Date.UTC(2026, 2, 8) as never),
    );
    expect(num(sunday, 'x')).toBe(800);
    expect(num(sunday, 'width')).toBe(40);
    expect(num(sunday, 'y')).toBe(0);
    expect(num(sunday, 'height')).toBe(192);
    expect(sunday.hasAttribute('fill')).toBe(false);
    expect(root.querySelector('defs')).toBeNull();
  });

  it('FR-CAL-2: a holiday is a non-working day with its own reason, a worked Saturday is not', () => {
    const { root } = chart({
      core: {
        calendar: {
          weekends: [0, 6],
          holidays: [{ date: '2026-03-11', name: 'Spring day' }],
          workingDays: ['2026-03-07'],
        },
      },
    });

    const reasons = new Map(days(root).map((day) => [num(day, 'data-day'), day.dataset.reason]));
    expect(reasons.get(dayKeyOf('2026-03-11'))).toBe('holiday');
    expect(reasons.get(dayKeyOf('2026-03-08'))).toBe('weekend');
    expect(reasons.has(dayKeyOf('2026-03-07'))).toBe(false);
  });

  it('FR-CAL-1: a change of the calendar redraws the days', () => {
    const { core, root, redraw } = chart();
    expect(days(root).some((day) => weekday(day) === 0)).toBe(true);

    core.setOptions({ calendar: { weekends: [5] } });
    redraw();

    expect(days(root).length).toBeGreaterThan(3);
    expect(days(root).every((day) => weekday(day) === 5)).toBe(true);
  });

  it('FR-UI-2: stripes mode fills the rects with the instance`s pattern', () => {
    const { root } = chart({ display: { nonWorkingDays: 'stripes' } });

    const group = root.querySelector('.gantt__nonworking')!;
    expect(group.getAttribute('data-mode')).toBe('stripes');
    const pattern = group.querySelector('defs > pattern')!;
    expect(pattern.id).toBe('test-1-stripes');
    expect(pattern.getAttribute('class')).toBe('gantt__stripes');
    expect(pattern.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(days(root).length).toBeGreaterThan(8);
    for (const day of days(root)) expect(day.getAttribute('fill')).toBe('url(#test-1-stripes)');
    // The colour comes from the theme: lines carry geometry only.
    const hatch = [...pattern.querySelectorAll('line')];
    expect(hatch.length).toBeGreaterThan(0);
    for (const line of hatch) {
      expect(line.getAttribute('class')).toBe('gantt__stripes-line');
      expect(line.hasAttribute('stroke')).toBe(false);
      expect(line.hasAttribute('style')).toBe(false);
    }
    expect(group.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('FR-UI-2: two instances have their own pattern, each referenced by its own rects', () => {
    const make = (prefix: string) => {
      const harness = createLayerHarness('grid', { nonWorkingDays: 'stripes' }, prefix);
      const layer = createGridLayer();
      layer.mount(harness.context);
      const core = createTestCore();
      core.setViewport({ width: 800, height: 400 });
      layer.update(core.getSnapshot(), undefined);
      return harness.root;
    };
    const [one, two] = [make('gantt-1'), make('gantt-2')];

    const ids = [...document.querySelectorAll('pattern')].map((pattern) => pattern.id);
    expect(ids.sort()).toEqual(['gantt-1-stripes', 'gantt-2-stripes']);
    expect(new Set(days(one).map((day) => day.getAttribute('fill')))).toEqual(
      new Set(['url(#gantt-1-stripes)']),
    );
    expect(new Set(days(two).map((day) => day.getAttribute('fill')))).toEqual(
      new Set(['url(#gantt-2-stripes)']),
    );
  });

  it('FR-UI-2: switching the mode swaps the pattern and the fill, on the same nodes', () => {
    const { harness, root, refresh } = chart();
    const before = days(root);

    harness.setDisplay({ nonWorkingDays: 'stripes' });
    refresh();
    expect(root.querySelectorAll('pattern')).toHaveLength(1);
    expect(days(root).every((day) => day.hasAttribute('fill'))).toBe(true);
    days(root).forEach((day, i) => {
      expect(day).toBe(before[i]);
    });

    harness.setDisplay({ nonWorkingDays: 'fill' });
    refresh();
    expect(root.querySelector('pattern')).toBeNull();
    expect(root.querySelector('[fill]')).toBeNull();
    expect(root.querySelector('.gantt__nonworking')!.getAttribute('data-mode')).toBe('fill');

    harness.setDisplay({ nonWorkingDays: false });
    refresh();
    expect(days(root)).toHaveLength(0);
    expect(root.querySelector('.gantt__nonworking')!.hasAttribute('data-mode')).toBe(false);
  });

  it('FR-UI-2: the hour mode draws a weekend day as one wide rect', () => {
    const { core, root } = chart({ viewMode: 'hour' });

    expect(days(root).length).toBeGreaterThan(0);
    expect(days(root).length).toBeLessThan(6);
    for (const day of days(root)) {
      expect(num(day, 'width')).toBe(960);
      expect(num(day, 'x')).toBeGreaterThanOrEqual(0);
    }
    expect(core.getSnapshot().header.scale.pxPerDay).toBe(960);
  });

  it('NFR-PERF-3: days narrower than 2 px are not drawn (the year view)', () => {
    const { core, root } = chart({
      viewMode: 'year',
      display: { highlightDays: [{ id: 'all', match: () => true }] },
    });

    expect(core.getSnapshot().header.scale.pxPerDay).toBe(1);
    expect(days(root)).toHaveLength(0);
    expect(all(root, '.gantt__highlight')).toHaveLength(0);
  });

  it('NFR-PERF-3: a range of many years costs only the days of the window', () => {
    const { root } = chart({
      core: { calendar: { weekends: [0, 1, 2, 3, 4, 5, 6] } },
    });

    // Every day of a 70-day range is off, but only the ~40 days near the viewport are drawn.
    expect(days(root).length).toBeGreaterThan(30);
    expect(days(root).length).toBeLessThan(50);
  });
});

describe('highlights (FR-UI-3)', () => {
  const highlights = (root: Element): SVGElement[] => all(root, '.gantt__highlight');
  const keys = (root: Element): number[] => highlights(root).map((rect) => num(rect, 'data-day'));

  it('FR-UI-3: dates, a range and a predicate become day rects with the id of the highlight', () => {
    const { root } = chart({
      display: {
        highlightDays: [
          { id: 'release', dates: ['2026-03-06', new Date(2026, 2, 12)] },
          { id: 'sprint', range: { start: '2026-03-16', end: '2026-03-18' } },
          { id: 'mondays', match: (day: CalendarDay) => day.weekday === 1 && day.dayKey > 0 },
        ],
      },
    });

    const ofId = (id: string): number[] =>
      highlights(root)
        .filter((rect) => rect.dataset.highlight === id)
        .map((rect) => num(rect, 'data-day'));
    expect(ofId('release')).toEqual([dayKeyOf('2026-03-06'), dayKeyOf('2026-03-12')]);
    expect(ofId('sprint')).toEqual([
      dayKeyOf('2026-03-16'),
      dayKeyOf('2026-03-17'),
      dayKeyOf('2026-03-18'),
    ]);
    expect(ofId('mondays')).toEqual(
      ['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30'].map(
        dayKeyOf,
      ),
    );
    const release = highlights(root)[0]!;
    expect(num(release, 'width')).toBe(40);
    expect(num(release, 'height')).toBe(192);
  });

  it('FR-UI-3: a day is placed on the scale (2026-03-06 is 18 days from the origin)', () => {
    const { root } = chart({ display: { highlightDays: [{ id: 'd', dates: ['2026-03-06'] }] } });

    expect(num(highlights(root)[0]!, 'x')).toBe(18 * 40);
  });

  it('FR-UI-3: className joins the class, color becomes --gantt-highlight-color', () => {
    const { root } = chart({
      display: {
        highlightDays: [
          { id: 'a', dates: ['2026-03-06'], className: 'holiday  big', color: 'tomato' },
          { id: 'b', dates: ['2026-03-06'] },
        ],
      },
    });

    const [a, b] = highlights(root) as [SVGElement, SVGElement];
    expect(a.getAttribute('class')).toBe('gantt__highlight holiday big');
    expect((a as unknown as HTMLElement).style.getPropertyValue('--gantt-highlight-color')).toBe(
      'tomato',
    );
    expect(a.hasAttribute('fill')).toBe(false);
    expect(b.getAttribute('class')).toBe('gantt__highlight');
    expect((b as unknown as HTMLElement).style.getPropertyValue('--gantt-highlight-color')).toBe(
      '',
    );
  });

  it('FR-UI-3: the predicate is told about the day (key, date, weekday, y / m / d)', () => {
    const seen: CalendarDay[] = [];
    chart({
      display: {
        highlightDays: [
          {
            id: 'spy',
            match: (day) => {
              seen.push(day);
              return false;
            },
          },
        ],
      },
    });

    const day = seen.find((candidate) => candidate.dayKey === dayKeyOf('2026-03-04'))!;
    expect(day).toEqual({
      dayKey: dayKeyOf('2026-03-04'),
      date: Date.UTC(2026, 2, 4),
      weekday: 3,
      year: 2026,
      month: 3,
      day: 4,
    });
  });

  it('NFR-PERF-3: only the visible days of a long range are drawn', () => {
    const { root } = chart({
      display: {
        highlightDays: [{ id: 'long', range: { start: '2000-01-01', end: '2099-12-31' } }],
      },
    });

    expect(highlights(root).length).toBeGreaterThan(30);
    expect(highlights(root).length).toBeLessThan(50);
  });

  it('FR-UI-3: display.highlights = false hides them, and they come back', () => {
    const { harness, root, refresh } = chart({
      display: { highlightDays: [{ id: 'd', dates: ['2026-03-06'] }] },
    });
    expect(highlights(root)).toHaveLength(1);

    harness.setDisplay({ highlights: false });
    refresh();
    expect(highlights(root)).toHaveLength(0);

    harness.setDisplay({ highlights: true });
    refresh();
    expect(highlights(root)).toHaveLength(1);
  });

  it('FR-UI-3: a new list redraws, keeping the nodes of the days that stay', () => {
    const { harness, root, refresh } = chart({
      display: { highlightDays: [{ id: 'd', dates: ['2026-03-06', '2026-03-07'] }] },
    });
    const [first] = highlights(root);

    harness.setDisplay({ highlightDays: [{ id: 'd', dates: ['2026-03-06', '2026-03-10'] }] });
    refresh();

    expect(keys(root)).toEqual([dayKeyOf('2026-03-06'), dayKeyOf('2026-03-10')]);
    expect(highlights(root)[0]).toBe(first);
  });

  it('FR-UI-3: dates that cannot be read are skipped without an error', () => {
    const { root } = chart({
      display: {
        highlightDays: [
          { id: 'bad', dates: ['not a date', 'later'], range: { start: 'x', end: '2026-03-06' } },
        ],
      },
    });

    expect(highlights(root)).toHaveLength(0);
  });

  it('FR-UI-3: a highlight with a malformed field is skipped and the rest of the grid still draws', () => {
    // What a JavaScript caller (or a JSON config) can hand over: none of it may crash the grid.
    const malformed = [
      null,
      7,
      'text',
      { id: 'dates-number', dates: 5 },
      { id: 'dates-object', dates: { 0: '2026-03-06', length: 1 } },
      { id: 'dates-string', dates: '2026-03-06' },
      { id: 'dates-null', dates: null },
      { id: 'range-null', range: null },
      { id: 'range-number', range: 3 },
      { id: 'range-empty', range: {} },
      { id: 'range-open', range: { start: '2026-03-06' } },
      { id: 'match-string', match: 'weekend' },
      { id: 'match-object', match: {} },
      { id: 'colour', dates: ['2026-03-09'], color: 7, className: 7 },
      { id: 'ok', dates: ['2026-03-06'] },
    ];
    const { root } = chart({ display: { highlightDays: malformed as never } });

    expect(highlights(root).map((rect) => [rect.dataset.highlight, rect.dataset.day])).toEqual([
      ['ok', String(dayKeyOf('2026-03-06'))],
      ['colour', String(dayKeyOf('2026-03-09'))],
    ]);
    // A colour that is not text sets nothing, a class that is not text adds nothing.
    const colour = highlights(root).find((rect) => rect.dataset.highlight === 'colour')!;
    expect(
      (colour as unknown as HTMLElement).style.getPropertyValue('--gantt-highlight-color'),
    ).toBe('');
    expect(colour.getAttribute('class')).toBe('gantt__highlight');
    expect(rows(root).length).toBeGreaterThan(0);
    expect(lines(root).length).toBeGreaterThan(0);
    expect(all(root, '.gantt__today')).toHaveLength(1);
  });

  it('FR-UI-3: a highlight keeps the days it can read when another field of it is malformed', () => {
    const { root } = chart({
      display: {
        highlightDays: [
          {
            id: 'mixed',
            dates: ['2026-03-06'],
            range: { start: '2026-03-10', end: '2026-03-11' },
            match: 'nope',
          },
          { id: 'only-range', dates: 5, range: { start: '2026-03-12', end: '2026-03-12' } },
        ] as never,
      },
    });

    expect(highlights(root).map((rect) => [rect.dataset.highlight, num(rect, 'data-day')])).toEqual(
      [
        ['mixed', dayKeyOf('2026-03-06')],
        ['mixed', dayKeyOf('2026-03-10')],
        ['mixed', dayKeyOf('2026-03-11')],
        ['only-range', dayKeyOf('2026-03-12')],
      ].sort((a, b) => Number(a[1]) - Number(b[1])),
    );
  });

  it('FR-UI-3: highlights that share an id are all drawn, none of their days is dropped', () => {
    const { harness, root, refresh } = chart({
      display: {
        highlightDays: [
          { id: 'x', dates: ['2026-03-06'], color: 'red' },
          { id: 'x', dates: ['2026-03-06', '2026-03-07'], className: 'second' },
          { id: 'y', dates: ['2026-03-06'] },
        ],
      },
    });

    const drawn = (): string[] =>
      highlights(root).map((rect) =>
        [rect.dataset.highlight, rect.dataset.day, rect.getAttribute('class')].join(':'),
      );
    const day6 = dayKeyOf('2026-03-06');
    expect(drawn().sort()).toEqual(
      [
        `x:${day6}:gantt__highlight`,
        `x:${day6}:gantt__highlight second`,
        `x:${day6 + 1}:gantt__highlight second`,
        `y:${day6}:gantt__highlight`,
      ].sort(),
    );

    // Unchanged lists keep their nodes; a longer list keeps the nodes of the days that stay.
    const before = highlights(root);
    refresh();
    expect(highlights(root)).toEqual(before);
    harness.setDisplay({
      highlightDays: [
        { id: 'x', dates: ['2026-03-06'], color: 'red' },
        { id: 'x', dates: ['2026-03-06', '2026-03-07'], className: 'second' },
        { id: 'y', dates: ['2026-03-06', '2026-03-08'] },
      ],
    });
    refresh();
    expect(highlights(root)).toHaveLength(5);
    expect(before.every((rect) => highlights(root).includes(rect))).toBe(true);
  });
});

describe('grid lines (FR-UI-4, FR-SCALE-5)', () => {
  const vertical = (root: Element): SVGElement[] =>
    lines(root).filter((line) => line.dataset.orientation === 'vertical');
  const horizontal = (root: Element): SVGElement[] =>
    lines(root).filter((line) => line.dataset.orientation === 'horizontal');

  it('FR-UI-4: both draws a vertical line per column and a horizontal one per row', () => {
    const { core, root } = chart();

    const { contentWidth } = core.getSnapshot();
    expect(vertical(root).length).toBeGreaterThan(30);
    expect(vertical(root).every((line) => num(line, 'x1') === num(line, 'x2'))).toBe(true);
    expect(vertical(root).every((line) => num(line, 'y1') === 0 && num(line, 'y2') === 192)).toBe(
      true,
    );
    expect(horizontal(root).map((line) => num(line, 'y1'))).toEqual([48, 96, 144, 192]);
    for (const line of horizontal(root)) {
      expect(num(line, 'y1')).toBe(num(line, 'y2'));
      expect(num(line, 'x1')).toBe(0);
      expect(num(line, 'x2')).toBe(contentWidth);
    }
  });

  it.each([
    ['none', false, false],
    ['vertical', true, false],
    ['horizontal', false, true],
    ['both', true, true],
  ] as const)('FR-UI-4: %s', (gridLines, hasVertical, hasHorizontal) => {
    const { root } = chart({ display: { gridLines } });

    expect(vertical(root).length > 0).toBe(hasVertical);
    expect(horizontal(root).length > 0).toBe(hasHorizontal);
  });

  it('FR-UI-4: switching the option redraws the lines', () => {
    const { harness, root, refresh } = chart();
    const verticals = vertical(root);

    harness.setDisplay({ gridLines: 'horizontal' });
    refresh();
    expect(vertical(root)).toHaveLength(0);
    expect(horizontal(root)).toHaveLength(4);

    harness.setDisplay({ gridLines: 'both' });
    refresh();
    expect(vertical(root)).toHaveLength(verticals.length);
    expect(horizontal(root)).toHaveLength(4);
  });

  it('FR-SCALE-5: major lines are the view mode`s rule (Mondays in the day mode)', () => {
    const { root } = chart();

    const majors = vertical(root).filter((line) => line.hasAttribute('data-major'));
    // 2026-02-23 is at x = 280, then every 7 days.
    expect(majors.map((line) => num(line, 'x1')).slice(0, 4)).toEqual([280, 560, 840, 1120]);
    expect(vertical(root).some((line) => line.hasAttribute('data-minor'))).toBe(false);
    expect(horizontal(root).some((line) => line.hasAttribute('data-major'))).toBe(false);
  });

  it('FR-SCALE-5: the hour mode has major lines at midnight and minor ones every 15 minutes', () => {
    const { root } = chart({ viewMode: 'hour', viewport: { width: 2400, height: 400 } });

    const verticals = vertical(root);
    const majors = verticals.filter((line) => line.hasAttribute('data-major'));
    const minors = verticals.filter((line) => line.hasAttribute('data-minor'));
    expect(majors.length).toBeGreaterThan(0);
    // A day is 960 px: midnights are 960 px apart.
    expect(num(majors[1]!, 'x1') - num(majors[0]!, 'x1')).toBe(960);
    // 15 minutes are 10 px, between two hour columns (40 px) there are three minor lines.
    expect(minors.length).toBeGreaterThan(30);
    expect(
      verticals
        .map((line) => num(line, 'x1'))
        .filter((x) => x > num(majors[0]!, 'x1') && x < num(majors[0]!, 'x1') + 40),
    ).toHaveLength(3);
    // One line per position: a column line and a minor one never share an x.
    expect(new Set(verticals.map((line) => line.getAttribute('x1'))).size).toBe(verticals.length);
  });

  it('NFR-PERF-3: the lines of the window only, however long the range', () => {
    const { root } = chart({
      core: {
        tasks: [
          { id: 'a', name: 'A', start: '2020-01-06', end: '2020-01-10' },
          { id: 'b', name: 'B', start: '2040-01-06', end: '2040-01-10' },
        ],
      },
    });

    expect(vertical(root).length).toBeLessThan(60);
  });
});

describe('today line (FR-UI-1)', () => {
  const today = (root: Element): SVGElement | null => root.querySelector('.gantt__today');

  it('FR-UI-1: draws a line at now, as tall as the body, above everything else', () => {
    const { root } = chart();

    const line = today(root)!;
    expect(num(line, 'x1')).toBe(657.5);
    expect(num(line, 'x2')).toBe(657.5);
    expect(num(line, 'y1')).toBe(0);
    expect(num(line, 'y2')).toBe(192);
    expect(root.lastElementChild).toBe(line);
  });

  it('FR-UI-1: display.today = false removes it, true brings it back', () => {
    const { harness, root, refresh } = chart();

    harness.setDisplay({ today: false });
    refresh();
    expect(today(root)).toBeNull();

    harness.setDisplay({ today: true });
    refresh();
    expect(num(today(root)!, 'x1')).toBe(657.5);
  });

  it('FR-UI-1: no line when today is outside the content', () => {
    vi.setSystemTime(new Date(2031, 5, 1));
    const { root } = chart();

    expect(today(root)).toBeNull();
  });

  it('FR-UI-1: a chart that is created with today = false has no line', () => {
    const { root } = chart({ display: { today: false } });

    expect(today(root)).toBeNull();
  });

  it('FR-UI-1: draws the core`s `now`, not the system clock, and moves only on `refreshNow`', () => {
    // The system clock says 2026-03-04 10:30; the chart's `now` option says another day.
    const { core, root, redraw } = chart({ core: { now: () => '2026-03-10T06:00' } });
    const line = today(root)!;
    const at = (): number =>
      core.getSnapshot().header.scale.dateToX(Date.UTC(2026, 2, 10, 6) as never);
    expect(num(line, 'x1')).toBe(at());

    vi.setSystemTime(new Date(2027, 0, 1));
    redraw();
    expect(today(root)).toBe(line);
    expect(num(line, 'x1')).toBe(at());
  });

  it('FR-UI-1: crossing midnight moves the line after `refreshNow`, no stale line overnight', () => {
    let clock = new Date(2026, 2, 4, 23, 59, 30);
    const { core, root, redraw } = chart({ core: { now: () => clock } });
    const line = today(root)!;
    // 23:59 of the 4th is one minute short of the 5th, which starts at x = 680.
    expect(num(line, 'x1')).toBeCloseTo(680 - 40 / 1440, 6);

    clock = new Date(2026, 2, 5, 0, 0, 10);
    core.refreshNow();
    redraw();

    expect(today(root)).toBe(line);
    expect(num(line, 'x1')).toBe(680);
  });

  it('FR-UI-1: the line follows the clock and the scale', () => {
    const { core, root, redraw } = chart();
    const line = today(root)!;

    vi.setSystemTime(new Date(2026, 2, 4, 22, 30));
    core.refreshNow();
    core.scroll({ left: 650, top: 0 });
    redraw();
    expect(today(root)).toBe(line);
    expect(num(line, 'x1')).toBe(677.5);

    core.setViewMode('week');
    const next = redraw();
    expect(num(today(root)!, 'x1')).toBe(
      next.header.scale.dateToX(Date.UTC(2026, 2, 4, 22, 30) as never),
    );
  });
});

describe('work per update (NFR-PERF-1, NFR-PERF-3)', () => {
  it('NFR-PERF-1: a scroll inside the drawn window writes nothing and keeps every node', () => {
    const { core, root, redraw } = chart();
    const before = all(root, '*');
    const changes = watch(root);

    core.scroll({ left: 700, top: 0 });
    redraw();
    core.scroll({ left: 520, top: 0 });
    redraw();

    expect(changes.take()).toEqual([]);
    expect(all(root, '*')).toEqual(before);
    changes.stop();
  });

  it('NFR-PERF-1: an unchanged snapshot and a feedback-only snapshot write nothing', () => {
    const { core, root, redraw, refresh } = chart();
    const changes = watch(root);

    refresh();
    core.send({ type: 'move', pointerId: 1, time: 0, x: 700, y: 20 });
    redraw();

    expect(changes.take()).toEqual([]);
    changes.stop();
  });

  it('NFR-PERF-1: a scroll past the drawn window keeps the nodes of the days that stay', () => {
    const { core, root, redraw } = chart({
      display: { highlightDays: [{ id: 'every', match: () => true }] },
    });
    const days0 = days(root);
    const lines0 = lines(root);
    const marks0 = all(root, '.gantt__highlight');

    core.scroll({ left: 1100, top: 0 });
    redraw();

    expect(days(root).filter((day) => days0.includes(day)).length).toBeGreaterThan(3);
    expect(lines(root).filter((line) => lines0.includes(line)).length).toBeGreaterThan(10);
    expect(
      all(root, '.gantt__highlight').filter((mark) => marks0.includes(mark)).length,
    ).toBeGreaterThan(10);
    expect(days0.some((day) => !day.isConnected)).toBe(true);
    // What is drawn follows the window, not the whole range.
    expect(lines(root).length).toBeLessThan(80);
  });

  it('NFR-PERF-1: a vertical scroll redraws the rows and horizontal lines, not the time', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `t${i}`,
      name: `Task ${i}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    const { core, root, redraw } = chart({ core: { tasks } });
    const verticals = lines(root).filter((line) => line.dataset.orientation === 'vertical');
    const weekends = days(root);

    core.scroll({ left: 640, top: 960 });
    redraw();

    const after = lines(root).filter((line) => line.dataset.orientation === 'vertical');
    after.forEach((line, i) => {
      expect(line).toBe(verticals[i]);
    });
    days(root).forEach((day, i) => {
      expect(day).toBe(weekends[i]);
    });
    expect(rows(root)[0]!.dataset.row).not.toBe('0');
  });

  it('NFR-PERF-1: a new content width (a longer range) is applied to the rows and lines', () => {
    const { core, root, redraw } = chart();
    const before = core.getSnapshot().contentWidth;

    core.setTasks([
      { id: 'late', name: 'Late', start: '2026-09-01', end: '2026-09-03' },
      { id: 'early', name: 'Early', start: '2026-03-02', end: '2026-03-04' },
    ]);
    const next = redraw();

    expect(next.contentWidth).not.toBe(before);
    for (const row of rows(root)) expect(num(row, 'width')).toBe(next.contentWidth);
    for (const line of lines(root).filter(
      (candidate) => candidate.dataset.orientation === 'horizontal',
    )) {
      expect(num(line, 'x2')).toBe(next.contentWidth);
    }
  });

  it('NFR-PERF-1: a body that grows or shrinks resizes the days and the lines', () => {
    const { core, root, redraw } = chart();

    core.collapse('phase');
    const next = redraw();

    expect(next.layout.rows.bodyHeight).toBe(144);
    expect(days(root).every((day) => num(day, 'height') === 144)).toBe(true);
    expect(
      lines(root)
        .filter((line) => line.dataset.orientation === 'vertical')
        .every((line) => num(line, 'y2') === 144),
    ).toBe(true);
    expect(num(root.querySelector('.gantt__today')!, 'y2')).toBe(144);
  });
});

describe('grid lifecycle', () => {
  it('FR-API-1: destroy removes every group, the pattern and the today line', () => {
    const { layer, root } = chart({
      display: {
        nonWorkingDays: 'stripes',
        rowStripes: 'row',
        highlightDays: [{ id: 'd', dates: ['2026-03-06'] }],
      },
    });
    expect(root.querySelector('pattern')).not.toBeNull();
    expect(root.querySelector('.gantt__today')).not.toBeNull();

    layer.destroy();

    expect(root.childNodes).toHaveLength(0);
  });

  it('FR-API-1: an update before mount and a second destroy do nothing', () => {
    const harness = createLayerHarness('grid');
    const layer = createGridLayer();
    const core = createTestCore();
    core.setViewport({ width: 800, height: 400 });

    layer.update(core.getSnapshot(), undefined);
    layer.mount(harness.context);
    layer.destroy();
    layer.destroy();

    expect(harness.root.childNodes).toHaveLength(0);
  });

  it('FR-UI-3: a predicate that throws fails that update only, the next one draws again', () => {
    const { harness, root, refresh } = chart();

    harness.setDisplay({
      highlightDays: [
        {
          id: 'd',
          match: () => {
            throw new Error('boom');
          },
        },
      ],
    });
    expect(() => {
      refresh();
    }).toThrow('boom');

    harness.setDisplay({ highlightDays: [{ id: 'd', dates: ['2026-03-06'] }] });
    refresh();
    expect(all(root, '.gantt__highlight')).toHaveLength(1);
  });

  it('FR-UI-3: a predicate that throws does not stop the grid: lines, rows, days and the today line are drawn, then the error is thrown', () => {
    const { harness, root, refresh } = chart();
    const bare = chart();
    const drawnBare = (selector: string): number => all(bare.root, selector).length;
    expect(drawnBare('.gantt__gridline')).toBeGreaterThan(0);

    harness.setDisplay({
      highlightDays: [
        { id: 'works', dates: ['2026-03-06'] },
        {
          id: 'broken',
          match: () => {
            throw new Error('boom');
          },
        },
      ],
    });
    expect(() => {
      refresh();
    }).toThrow('boom');

    // Everything else is where a grid without the broken highlight puts it.
    for (const selector of [
      '.gantt__row',
      '.gantt__nonworking-day',
      '.gantt__gridline',
      '.gantt__today',
    ]) {
      expect(all(root, selector).length, selector).toBe(drawnBare(selector));
    }
    expect(all(root, '.gantt__today')).toHaveLength(1);
    expect(all(root, '.gantt__highlight').map((rect) => rect.dataset.highlight)).toEqual(['works']);
  });

  it('FR-UI-3: a predicate that throws on some days highlights the others, and is reported once per highlight', () => {
    const { harness, root, refresh } = chart();
    const bad = dayKeyOf('2026-03-05');
    const errors: unknown[] = [];
    const picky = (name: string) => (day: CalendarDay) => {
      if (day.dayKey === bad) {
        const error = new Error(name);
        errors.push(error);
        throw error;
      }
      return day.weekday === 1;
    };
    harness.setDisplay({
      highlightDays: [
        { id: 'a', match: picky('a') },
        { id: 'b', match: picky('b') },
      ],
    });

    let thrown: unknown;
    try {
      refresh();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual(errors);
    expect(errors).toHaveLength(2);
    const mondays = all(root, '.gantt__highlight[data-highlight="a"]').map((rect) =>
      num(rect, 'data-day'),
    );
    expect(mondays).toContain(dayKeyOf('2026-03-02'));
    expect(mondays).toContain(dayKeyOf('2026-03-09'));
    expect(mondays).not.toContain(bad);
  });

  it('FR-UI-3: the failed draw is the drawn state: the same inputs neither redraw nor throw again', () => {
    const { core, harness, root, refresh, redraw } = chart();
    const match = vi.fn(() => {
      throw new Error('boom');
    });
    harness.setDisplay({ highlightDays: [{ id: 'd', match }] });
    expect(() => {
      refresh();
    }).toThrow('boom');
    const calls = match.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    // The renderer repeats a snapshot per frame, and a scroll inside the drawn window moves
    // nothing: a predicate that is broken is not asked again, nor reported again, for them.
    refresh();
    refresh();
    core.scroll({ left: core.getSnapshot().timeline.scrollLeft + 40, top: 0 });
    redraw();
    expect(match.mock.calls).toHaveLength(calls);

    // A new list is new input: it is asked, and reported, again.
    harness.setDisplay({ highlightDays: [{ id: 'd', match }] });
    expect(() => {
      refresh();
    }).toThrow('boom');
    expect(match.mock.calls.length).toBeGreaterThan(calls);
    expect(all(root, '.gantt__today')).toHaveLength(1);
  });
});

/** The core a fixture describes, as the playground creates it. */
function coreOf(fixture: Fixture) {
  return createTestCore({
    tasks: fixture.tasks,
    links: fixture.links,
    ...(fixture.calendar && { calendar: fixture.calendar }),
    ...fixture.options,
  });
}

describe('real data (@ganttlane/fixtures)', () => {
  it.each(
    fixtureCatalog
      .filter((entry) => entry.id !== 'generated-10k')
      .map((entry) => [entry.id, entry] as const),
  )('FR-ROW-3: draws the grid of the fixture %s and removes it again', (_id, entry) => {
    const core = coreOf(entry.load());
    core.setViewport({ width: 900, height: 500 });
    const harness = createLayerHarness('grid', {
      rowStripes: 'group',
      nonWorkingDays: 'stripes',
      highlightDays: [{ id: 'mondays', match: (day) => day.weekday === 1 }],
    });
    const layer = createGridLayer();
    layer.mount(harness.context);

    const snapshot = core.getSnapshot();
    layer.update(snapshot, undefined);

    const { firstRow, lastRow } = snapshot.window;
    expect(rows(harness.root)).toHaveLength(Math.max(lastRow - firstRow + 1, 0));
    for (const row of rows(harness.root)) {
      const task = snapshot.state.derived.model.taskById.get(
        snapshot.layout.rows.rows[Number(row.dataset.row)]!.id,
      );
      expect(row.hasAttribute('data-invalid')).toBe(!task!.valid);
    }
    layer.destroy();
    expect(harness.root.childNodes).toHaveLength(0);
  });
});
