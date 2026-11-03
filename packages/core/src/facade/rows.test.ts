import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it, vi } from 'vitest';

import type { PointerInput } from '../interaction';
import type { Task, TaskId } from '../model';
import { createGanttCore, type GanttCore, type GanttCoreOptions } from './index';

// Five rows of 48 px (the default) under a header of 75 px (the default of the day mode).
const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'phase', name: 'Phase', start: '2026-03-16', end: '2026-03-27' },
  { id: 'one', name: 'One', parentId: 'phase', start: '2026-03-16', end: '2026-03-18' },
  { id: 'two', name: 'Two', parentId: 'phase', start: '2026-03-19', end: '2026-03-20' },
  { id: 'late', name: 'Late', start: '2026-09-01', end: '2026-09-04' },
]);

function chart(options: Partial<GanttCoreOptions> = {}, height = 200): GanttCore {
  const gantt = createGanttCore({
    tasks: TASKS,
    calendar: { weekends: [] },
    now: () => '2026-03-04',
    scroll: { initial: 'start', behavior: 'instant' },
    ...options,
  });
  gantt.setViewport({ width: 400, height });
  return gantt;
}

let clock = 0;
function pointer(type: PointerInput['type'], x: number, y: number): PointerInput {
  clock += 10;
  return { type, pointerId: 1, x, y, time: clock, event: { type } };
}

/** The middle of a bar, in the content coordinates `send` takes. */
function barMiddle(gantt: GanttCore, id: TaskId): { x: number; y: number } {
  const bar = gantt.getBarRect(id);
  if (bar === undefined) throw new Error(`no bar for ${String(id)}`);
  return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
}

function click(gantt: GanttCore, at: { x: number; y: number }): void {
  gantt.send(pointer('down', at.x, at.y));
  gantt.send(pointer('up', at.x, at.y));
}

describe('createGanttCore: rows for what stands beside the chart', () => {
  it('FR-ROW-5: getRows has what a list draws, in the order of the chart', () => {
    const gantt = chart();
    const rows = gantt.getRows();
    expect(rows.map((row) => row.id)).toEqual(['design', 'phase', 'one', 'two', 'late']);
    expect(rows[1]).toMatchObject({
      index: 1,
      name: 'Phase',
      depth: 0,
      hasChildren: true,
      isExpanded: true,
      setSize: 3,
      position: 2,
    });
    expect(rows[3]).toMatchObject({
      id: 'two',
      depth: 1,
      hasChildren: false,
      isExpanded: false,
      setSize: 2,
      position: 2,
    });
    expect(rows[3]?.record).toBe(gantt.getTask('two'));
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });

  it('FR-ROW-5: getRows keeps its identity until a row changes, and keeps the rows that did not', () => {
    const gantt = chart();
    const before = gantt.getRows();
    gantt.scroll({ left: 40, top: 10 });
    gantt.select(['design']);
    gantt.setHoveredRow('design');
    expect(gantt.getRows()).toBe(before);

    gantt.collapse('phase');
    const collapsed = gantt.getRows();
    expect(collapsed).not.toBe(before);
    expect(collapsed.map((row) => row.id)).toEqual(['design', 'phase', 'late']);
    expect(collapsed[0]).toBe(before[0]);
    expect(collapsed[1]).not.toBe(before[1]);
    expect(collapsed[1]?.isExpanded).toBe(false);
  });

  it('FR-ROW-6: rowsChange reports new rows, and nothing for a scroll, a hover or a drag preview', () => {
    const seen: (readonly TaskId[])[] = [];
    const gantt = chart({ onRowsChange: (rows) => seen.push(rows.map((row) => row.id)) });
    gantt.scroll({ left: 40, top: 10 });
    gantt.select(['design']);
    gantt.setHoveredRow('design');
    expect(seen).toEqual([]);

    gantt.collapse('phase');
    expect(seen).toEqual([['design', 'phase', 'late']]);

    // The preview of a drag is no change of the rows; what it commits is.
    const at = barMiddle(gantt, 'design');
    gantt.send(pointer('down', at.x, at.y));
    gantt.send(pointer('move', at.x + 80, at.y));
    expect(seen).toHaveLength(1);
    gantt.send(pointer('up', at.x + 80, at.y));
    expect(seen).toHaveLength(2);

    gantt.setTasks(TASKS.map((task) => (task.id === 'late' ? { ...task, name: 'Later' } : task)));
    expect(seen).toHaveLength(3);
  });

  it('FR-ROW-6: a listener added later hears only what comes after it', () => {
    const gantt = chart();
    gantt.collapse('phase');
    const seen: number[] = [];
    const off = gantt.on('rowsChange', (rows) => seen.push(rows.length));
    gantt.scroll({ left: 0, top: 5 });
    expect(seen).toEqual([]);
    gantt.expand('phase');
    expect(seen).toEqual([5]);
    off();
    gantt.collapse('phase');
    expect(seen).toEqual([5]);
  });

  it('FR-ROW-5: getLayoutMetrics has the sizes of the chart, the same object while they are the same', () => {
    const gantt = chart({ layout: { rowHeight: 30, barHeight: 20, headerRowHeight: 25 } });
    const metrics = gantt.getLayoutMetrics();
    expect(metrics).toMatchObject({
      headerHeight: 50,
      rowHeight: 30,
      barHeight: 20,
      bodyHeight: 150,
      viewportWidth: 400,
      viewportHeight: 200,
    });
    expect(metrics.contentWidth).toBe(gantt.getSnapshot().contentWidth);
    gantt.scroll({ left: 40, top: 10 });
    expect(gantt.getLayoutMetrics()).toBe(metrics);
    gantt.setOptions({ layout: { rowHeight: 40 } });
    expect(gantt.getLayoutMetrics()).not.toBe(metrics);
    expect(gantt.getLayoutMetrics().bodyHeight).toBe(200);
  });

  it('FR-ROW-5: getRowWindow is the rows the chart draws, the same object while they are the same', () => {
    const gantt = chart({ layout: { rowHeight: 20 } }, 75 + 40);
    const first = gantt.getRowWindow();
    expect(first).toEqual({
      firstRow: gantt.getSnapshot().window.firstRow,
      lastRow: gantt.getSnapshot().window.lastRow,
    });
    gantt.scroll({ left: 100, top: 0 });
    expect(gantt.getRowWindow()).toBe(first);
  });

  it('FR-ROW-5: with no viewport yet there are rows, and none to draw', () => {
    const gantt = createGanttCore({ tasks: TASKS });
    expect(gantt.getRows()).toHaveLength(5);
    const { firstRow, lastRow } = gantt.getRowWindow();
    expect(firstRow).toBeGreaterThan(lastRow);
  });

  it('FR-ROW-2: toggle flips one parent, and leaves a task without children alone', () => {
    const gantt = chart();
    const keys: unknown[] = [];
    gantt.on('expandedChange', (expandedKeys) => keys.push(expandedKeys));
    gantt.toggle('phase');
    expect(gantt.getRowMetrics('one')).toBeUndefined();
    gantt.toggle('phase');
    expect(gantt.getRowMetrics('one')).toBeDefined();
    gantt.toggle('one');
    gantt.toggle('ghost');
    expect(keys).toHaveLength(2);
  });

  it('FR-ROW-2: expandedChange also gives the parents that are expanded, always as a list', () => {
    const tasks = [
      ...TASKS,
      { id: 'phase-b', name: 'Phase B', start: '2026-04-01', end: '2026-04-03' },
      { id: 'b1', name: 'B1', parentId: 'phase-b', start: '2026-04-01', end: '2026-04-02' },
    ];
    const gantt = chart({ tasks });
    const seen: unknown[] = [];
    gantt.on('expandedChange', (expandedKeys, expandedIds) => {
      seen.push([expandedKeys, expandedIds]);
    });
    gantt.collapseAll();
    gantt.setOptions({ hierarchy: { expandedKeys: ['design', 'phase'] } });
    gantt.expand('phase-b');
    gantt.setOptions({ hierarchy: { expandedKeys: 'all' } });
    gantt.collapse('phase');
    expect(seen).toEqual([
      [[], []],
      [
        ['design', 'phase', 'phase-b'],
        ['phase', 'phase-b'],
      ],
      [['phase-b'], ['phase-b']],
    ]);
  });
});

describe('createGanttCore: the lit row', () => {
  it('FR-ROW-6: the row under the pointer is lit, over its bar and over empty space', () => {
    const gantt = chart();
    const lit: unknown[] = [];
    gantt.on('rowHoverChange', (record) => lit.push(record?.id ?? null));
    const at = barMiddle(gantt, 'phase');
    gantt.send(pointer('move', at.x, at.y));
    expect(gantt.getSnapshot().hoveredRow).toBe('phase');
    // Far to the right of the bar, on the same row.
    gantt.send(pointer('move', at.x + 2000, at.y));
    expect(gantt.getSnapshot().hoveredRow).toBe('phase');
    gantt.send(pointer('move', at.x, 1000));
    expect(gantt.getSnapshot().hoveredRow).toBeUndefined();
    expect(lit).toEqual(['phase', null]);
  });

  it('FR-ROW-6: setHoveredRow lights a row over the pointer, and undefined gives it back', () => {
    const gantt = chart();
    const lit: unknown[] = [];
    gantt.on('rowHoverChange', (record) => lit.push(record?.id ?? null));
    const at = barMiddle(gantt, 'phase');
    gantt.send(pointer('move', at.x, at.y));
    gantt.setHoveredRow('design');
    expect(gantt.getSnapshot().hoveredRow).toBe('design');
    gantt.setHoveredRow(undefined);
    expect(gantt.getSnapshot().hoveredRow).toBe('phase');
    gantt.setHoveredRow('ghost');
    expect(gantt.getSnapshot().hoveredRow).toBe('phase');
    expect(lit).toEqual(['phase', 'design', 'phase']);
  });

  it('FR-ROW-6: a row that goes away is no longer lit', () => {
    const gantt = chart();
    const lit: unknown[] = [];
    gantt.on('rowHoverChange', (record) => lit.push(record?.id ?? null));
    gantt.setHoveredRow('one');
    gantt.collapse('phase');
    expect(gantt.getSnapshot().hoveredRow).toBeUndefined();
    expect(lit).toEqual(['one', null]);
  });
});

describe('createGanttCore: the focused task', () => {
  it('FR-SEL-3: focusTask says which row has the focus, and reports a change once', () => {
    const gantt = chart();
    const seen: unknown[] = [];
    gantt.on('focusChange', (record) => seen.push(record?.id ?? null));
    expect(gantt.getSnapshot().focusedTask).toBeUndefined();
    gantt.focusTask('design');
    gantt.focusTask('design');
    expect(gantt.getSnapshot().focusedTask).toBe('design');
    gantt.focusTask(undefined);
    expect(gantt.getSnapshot().focusedTask).toBeUndefined();
    expect(seen).toEqual(['design', null]);
  });

  it('FR-SEL-3: a task without a visible row cannot have the focus, and one that loses its row loses it', () => {
    const gantt = chart();
    const seen: unknown[] = [];
    gantt.on('focusChange', (record) => seen.push(record?.id ?? null));
    gantt.focusTask('ghost');
    expect(gantt.getSnapshot().focusedTask).toBeUndefined();
    gantt.focusTask('one');
    gantt.collapse('phase');
    expect(gantt.getSnapshot().focusedTask).toBeUndefined();
    gantt.focusTask('two');
    expect(gantt.getSnapshot().focusedTask).toBeUndefined();
    expect(seen).toEqual(['one', null]);
  });
});

describe('createGanttCore: selection by clicks', () => {
  it('FR-SEL-2: by default a click selects nothing and clears nothing', () => {
    const gantt = chart();
    gantt.select(['design']);
    click(gantt, barMiddle(gantt, 'phase'));
    expect(gantt.getSnapshot().selection.tasks).toEqual(['design']);
    click(gantt, { x: 390, y: 1 });
    expect(gantt.getSnapshot().selection.tasks).toEqual(['design']);
  });

  it('FR-SEL-2: selection.onClick selects the bar that is clicked, before taskClick is heard', () => {
    const gantt = chart({ selection: { onClick: true } });
    const heard: unknown[] = [];
    gantt.on('selectionChange', (keys) => heard.push(keys));
    gantt.on('taskClick', (record) => heard.push(record.id));
    click(gantt, barMiddle(gantt, 'phase'));
    expect(gantt.getSnapshot().selection.tasks).toEqual(['phase']);
    expect(heard).toEqual([['phase'], 'phase']);
    click(gantt, barMiddle(gantt, 'design'));
    expect(gantt.getSnapshot().selection.tasks).toEqual(['design']);
    // A click on empty space leaves it unless asked to clear it.
    click(gantt, { x: 390, y: 1 });
    expect(gantt.getSnapshot().selection.tasks).toEqual(['design']);
  });

  it('FR-SEL-2: selection.clearOnEmptyClick clears the selected tasks; setOptions merges the group', () => {
    const gantt = chart({ selection: { onClick: true } });
    gantt.setOptions({ selection: { clearOnEmptyClick: true } });
    click(gantt, barMiddle(gantt, 'phase'));
    expect(gantt.getSnapshot().selection.tasks).toEqual(['phase']);
    click(gantt, { x: 390, y: 1 });
    expect(gantt.getSnapshot().selection.tasks).toEqual([]);
  });

  describe('selection.multiple', () => {
    const clickWith = (
      gantt: GanttCore,
      point: { x: number; y: number },
      modifiers: { ctrl?: boolean; meta?: boolean },
    ): void => {
      const event = { pointerId: 1, x: point.x, y: point.y, time: 0, modifiers };
      gantt.send({ type: 'down', ...event });
      gantt.send({ type: 'up', ...event });
    };

    it('FR-SEL-2: Ctrl or Cmd + click adds a task and takes it out, in click order', () => {
      const gantt = chart({ selection: { onClick: true, multiple: true } });
      const heard: unknown[] = [];
      gantt.on('selectionChange', (keys) => heard.push(keys));
      click(gantt, barMiddle(gantt, 'phase'));
      clickWith(gantt, barMiddle(gantt, 'design'), { ctrl: true });
      clickWith(gantt, barMiddle(gantt, 'one'), { meta: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual(['phase', 'design', 'one']);
      clickWith(gantt, barMiddle(gantt, 'design'), { ctrl: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual(['phase', 'one']);
      expect(heard).toEqual([
        ['phase'],
        ['phase', 'design'],
        ['phase', 'design', 'one'],
        ['phase', 'one'],
      ]);
    });

    it('FR-SEL-2: a plain click still selects one task, and the last toggled off leaves none', () => {
      const gantt = chart({ selection: { onClick: true, multiple: true } });
      clickWith(gantt, barMiddle(gantt, 'phase'), { ctrl: true });
      clickWith(gantt, barMiddle(gantt, 'design'), { ctrl: true });
      click(gantt, barMiddle(gantt, 'one'));
      expect(gantt.getSnapshot().selection.tasks).toEqual(['one']);
      clickWith(gantt, barMiddle(gantt, 'one'), { meta: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual([]);
    });

    it('FR-SEL-2: off by default a modifier changes nothing, as before the option existed', () => {
      const gantt = chart({ selection: { onClick: true } });
      click(gantt, barMiddle(gantt, 'phase'));
      clickWith(gantt, barMiddle(gantt, 'design'), { ctrl: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual(['design']);
    });

    it('FR-SEL-2: without onClick a click selects nothing, with or without the modifier', () => {
      const gantt = chart({ selection: { multiple: true } });
      clickWith(gantt, barMiddle(gantt, 'design'), { ctrl: true });
      click(gantt, barMiddle(gantt, 'phase'));
      expect(gantt.getSnapshot().selection.tasks).toEqual([]);
    });

    it('FR-SEL-2: Ctrl or Cmd on an empty part keeps the selection that clearOnEmptyClick clears', () => {
      const gantt = chart({
        selection: { onClick: true, clearOnEmptyClick: true, multiple: true },
      });
      click(gantt, barMiddle(gantt, 'phase'));
      clickWith(gantt, { x: 390, y: 1 }, { ctrl: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual(['phase']);
      click(gantt, { x: 390, y: 1 });
      expect(gantt.getSnapshot().selection.tasks).toEqual([]);
    });

    it('FR-SEL-2: a double click with the modifier toggles twice, and taskDoubleClick is heard', () => {
      const gantt = chart({ selection: { onClick: true, multiple: true } });
      const doubled = vi.fn();
      gantt.on('taskDoubleClick', doubled);
      clickWith(gantt, barMiddle(gantt, 'phase'), { ctrl: true });
      clickWith(gantt, barMiddle(gantt, 'phase'), { ctrl: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual([]);
      expect(doubled).toHaveBeenCalledTimes(1);
    });

    it('FR-SEL-2: a drag is no click: it leaves the selection, with the modifier too', () => {
      const gantt = chart({ selection: { onClick: true, multiple: true } });
      click(gantt, barMiddle(gantt, 'phase'));
      const { x, y } = barMiddle(gantt, 'design');
      const modifiers = { ctrl: true };
      gantt.send({ type: 'down', pointerId: 1, x, y, time: 0, modifiers });
      gantt.send({ type: 'move', pointerId: 1, x: x + 80, y, time: 1, modifiers });
      gantt.send({ type: 'up', pointerId: 1, x: x + 80, y, time: 2, modifiers });
      expect(gantt.getSnapshot().selection.tasks).toEqual(['phase']);
    });

    it('FR-SEL-2: selecting a task with the modifier clears the selected link, not the tasks', () => {
      const gantt = chart({
        selection: { onClick: true, multiple: true },
        links: [{ source: 'design', target: 'one' }],
      });
      click(gantt, barMiddle(gantt, 'phase'));
      gantt.selectLink('design:FS:one');
      expect(gantt.getSnapshot().selection.link).toBe('design:FS:one');
      clickWith(gantt, barMiddle(gantt, 'design'), { meta: true });
      expect(gantt.getSnapshot().selection).toEqual({
        tasks: ['phase', 'design'],
        link: undefined,
      });
    });

    it('FR-SEL-2: a selectedKeys given with select() is what the next toggle starts from', () => {
      const gantt = chart({ selection: { onClick: true, multiple: true } });
      gantt.select(['one', 'phase']);
      clickWith(gantt, barMiddle(gantt, 'one'), { ctrl: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual(['phase']);
    });

    it('FR-DATA-4: a value of the wrong kind is an issue, and multiple stays off', () => {
      const gantt = chart({ selection: { onClick: true, multiple: 1 as unknown as boolean } });
      const found = gantt.getIssues().options.find((item) => item.path === 'selection.multiple');
      expect(found).toMatchObject({ code: 'invalid-option', value: 1, suggested: false });
      click(gantt, barMiddle(gantt, 'phase'));
      clickWith(gantt, barMiddle(gantt, 'design'), { ctrl: true });
      expect(gantt.getSnapshot().selection.tasks).toEqual(['design']);
    });
  });

  describe('a click that no pointer made', () => {
    const keyClick = (gantt: GanttCore, id: string, ctrl = false): void => {
      gantt.send({
        type: 'click',
        target: { kind: 'task', id, part: 'body' },
        modifiers: { ctrl },
        event: 'the key',
      });
    };

    it('FR-SEL-3: it selects and is reported like a click of the pointer', () => {
      const gantt = chart({ selection: { onClick: true, multiple: true } });
      const clicks: unknown[] = [];
      gantt.on('taskClick', (record, event) => clicks.push([record.id, event]));
      keyClick(gantt, 'phase');
      keyClick(gantt, 'design', true);
      expect(gantt.getSnapshot().selection.tasks).toEqual(['phase', 'design']);
      expect(clicks).toEqual([
        ['phase', 'the key'],
        ['design', 'the key'],
      ]);
    });

    it('FR-SEL-3: it moves no hover, starts no gesture and never makes a double click', () => {
      const gantt = chart();
      const hovered = vi.fn();
      const doubled = vi.fn();
      gantt.on('taskHoverChange', hovered);
      gantt.on('taskDoubleClick', doubled);
      const before = gantt.getSnapshot().feedback;
      keyClick(gantt, 'phase');
      keyClick(gantt, 'phase');
      expect(gantt.getSnapshot().feedback).toBe(before);
      expect(hovered).not.toHaveBeenCalled();
      expect(doubled).not.toHaveBeenCalled();
    });
  });

  it('FR-DATA-4: a selection option of the wrong kind is an issue, and its default is used', () => {
    const gantt = chart({ selection: { onClick: 'yes' as unknown as boolean } });
    const found = gantt.getIssues().options.find((item) => item.path === 'selection.onClick');
    expect(found).toMatchObject({ code: 'invalid-option', value: 'yes', suggested: false });
    click(gantt, barMiddle(gantt, 'phase'));
    expect(gantt.getSnapshot().selection.tasks).toEqual([]);
  });
});

describe('createGanttCore: scrolling a position and a task on one axis', () => {
  // 5 rows of 48 px in 125 px of viewport below a 75 px header: `top` runs from 0 to 115.
  it('FR-SCROLL-2: scrollTo moves the axes it is given, clamped, and leaves the other out of the request', () => {
    const gantt = chart();
    const { scrollLeft } = gantt.getSnapshot().timeline;

    const down = gantt.scrollTo({ top: 60 });
    expect(down).toMatchObject({ reason: 'scroll-to', left: undefined, top: 60 });
    expect(gantt.getSnapshot().scrollTop).toBe(60);
    expect(gantt.getSnapshot().timeline.scrollLeft).toBe(scrollLeft);

    expect(gantt.scrollTo({ top: 10_000 })?.top).toBe(115);
    expect(gantt.scrollTo({ top: -5 })?.top).toBe(0);

    const across = gantt.scrollTo({ left: 80 });
    expect(across).toMatchObject({ left: 80, top: undefined });
    expect(gantt.getSnapshot().timeline.scrollLeft).toBe(80);

    const { contentWidth } = gantt.getSnapshot();
    expect(gantt.scrollTo({ left: 1e9 })?.left).toBe(contentWidth - 400);
    expect(gantt.scrollTo({})).toBeUndefined();
    expect(gantt.scrollTo({ top: Number.NaN })).toBeUndefined();
  });

  it('FR-SCROLL-2: scrollTo takes the behaviour of the call, else scroll.behavior', () => {
    const gantt = chart();
    expect(gantt.scrollTo({ top: 60, behavior: 'smooth' })?.behavior).toBe('smooth');
    // A smooth request moves nothing until the renderer reports it.
    expect(gantt.getSnapshot().scrollTop).toBe(0);
    expect(gantt.scrollTo({ top: 60 })?.behavior).toBe('instant');
    expect(gantt.getSnapshot().scrollTop).toBe(60);
  });

  it('FR-SCROLL-2: scrollTo before the mount is kept, and the mount performs it', () => {
    const gantt = createGanttCore({
      tasks: TASKS,
      calendar: { weekends: [] },
      scroll: { initial: 'none' },
    });
    expect(gantt.scrollTo({ top: 60 })).toBeUndefined();
    const request = gantt.setViewport({ width: 400, height: 200 });
    expect(request).toMatchObject({ reason: 'initial', top: 60, behavior: 'instant' });
    expect(gantt.getSnapshot().scrollTop).toBe(60);
  });

  it('FR-SCROLL-2: scrollTo with one axis before the mount leaves scroll.initial to the other', () => {
    const gantt = createGanttCore({
      tasks: TASKS,
      calendar: { weekends: [] },
      now: () => '2026-09-01',
      scroll: { initial: 'today' },
    });
    gantt.scrollTo({ top: 60 });
    const request = gantt.setViewport({ width: 400, height: 200 });
    expect(request?.top).toBe(60);
    expect(request?.left).toBeGreaterThan(0);
  });

  it('FR-SCROLL-2: alignY false scrolls sideways only, and align false vertically only', () => {
    const gantt = chart();
    gantt.scroll({ left: 0, top: 30 });
    const sideways = gantt.scrollToTask('late', { alignY: false, align: 'start' });
    expect(sideways?.top).toBeUndefined();
    expect(sideways?.left).toBeGreaterThan(0);
    expect(gantt.getSnapshot().scrollTop).toBe(30);

    const down = gantt.scrollToTask('design', { align: false, alignY: 'start' });
    expect(down?.left).toBeUndefined();
    expect(down?.top).toBe(0);
  });

  it("FR-SCROLL-2: 'nearest' moves as little as it can, and not at all for what is in view", () => {
    const gantt = chart();
    // The row of `two` is 144 … 192 and 125 px are in view: it is below them.
    expect(gantt.scrollToTask('two', { align: false, alignY: 'nearest' })?.top).toBe(
      144 + 48 - 125,
    );
    expect(gantt.getSnapshot().scrollTop).toBe(67);
    // In view now: nothing to do at all.
    expect(gantt.scrollToTask('two', { align: false, alignY: 'nearest' })).toBeUndefined();
    // Above the view: to the top edge.
    expect(gantt.scrollToTask('design', { align: false, alignY: 'nearest' })?.top).toBe(0);

    const bar = gantt.getBarRect('late')!;
    const right = gantt.scrollToTask('late', { align: 'nearest', alignY: false });
    expect(right?.left).toBeCloseTo(bar.x + bar.width - 400);
    expect(gantt.scrollToTask('late', { align: 'nearest', alignY: false })).toBeUndefined();
    const first = gantt.getBarRect('design')!;
    expect(gantt.scrollToTask('design', { align: 'nearest', alignY: false })?.left).toBe(first.x);
  });

  it("FR-SCROLL-2: 'nearest' for both axes comes from align, and a value it does not know is the default", () => {
    const gantt = chart();
    const both = gantt.scrollToTask('late', { align: 'nearest' });
    expect(both?.left).toBeGreaterThan(0);
    expect(both?.top).toBe(240 - 125);
    gantt.scrollTo({ top: 0 });
    const odd = gantt.scrollToTask('late', {
      align: 'nearest',
      alignY: 'sideways' as unknown as 'start',
    });
    expect(odd?.top).toBe(240 - 125);
  });

  it('FR-TL-6: nearest grows the infinite timeline for a bar outside the range', () => {
    const gantt = chart({
      timeline: { range: { start: '2026-03-01', end: '2026-04-01' }, infinite: true },
    });
    const end = gantt.getSnapshot().timeline.range.end;
    expect(gantt.scrollToTask('late', { align: 'nearest', alignY: false })).toBeDefined();
    expect(gantt.getSnapshot().timeline.range.end).toBeGreaterThan(end);
  });

  it('FR-SCROLL-2: a scrollToTask before the mount that does not move sideways leaves scroll.initial to it', () => {
    const gantt = createGanttCore({
      tasks: TASKS,
      calendar: { weekends: [] },
      now: () => '2026-09-01',
      scroll: { initial: 'today' },
    });
    gantt.scrollToTask('late', { align: false, alignY: 'start' });
    const request = gantt.setViewport({ width: 400, height: 200 });
    expect(request?.left).toBeGreaterThan(0);
    expect(request?.top).toBe(115);
  });
});
