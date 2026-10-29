import { deepFreeze } from '@ganttlane/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PointerInput } from '../interaction';
import type { Task } from '../model';
import { type DateTimeMs, DAY, parseDateInput, toDate } from '../time';
import { VIEWPORT_DEFAULTS } from '../viewport';
import {
  createGanttCore,
  type GanttCore,
  type GanttCoreOptions,
  type RangeChangeInfo,
} from './index';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const DAY_PX = 40;
const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'phase', name: 'Phase', start: '2026-04-06', end: '2026-04-17' },
  { id: 'child', name: 'Child', parentId: 'phase', start: '2026-04-13', end: '2026-04-17' },
]);

function chart(options: Partial<GanttCoreOptions> = {}, width = 800): GanttCore {
  const gantt = createGanttCore({
    tasks: TASKS,
    calendar: { weekends: [0, 6] },
    now: () => '2026-03-04',
    ...options,
  });
  gantt.setViewport({ width, height: 400 });
  return gantt;
}

/** The date at a viewport x of the current snapshot. */
function dateAt(gantt: GanttCore, viewportX: number): DateTimeMs {
  const { scale, scrollLeft } = gantt.getSnapshot().timeline;
  return scale.xToDate(scrollLeft + viewportX);
}

/** The exact date (not rounded to ms) at a viewport x of the current snapshot. */
function exactDateAt(gantt: GanttCore, viewportX: number): number {
  const { range, scale, scrollLeft } = gantt.getSnapshot().timeline;
  return range.start + ((scrollLeft + viewportX) * DAY) / scale.pxPerDay;
}

function ranges(gantt: GanttCore): RangeChangeInfo[] {
  const list: RangeChangeInfo[] = [];
  gantt.on('rangeChange', (range) => list.push(range));
  return list;
}

describe('createGanttCore: viewport and initial scroll', () => {
  it('FR-TL-1, FR-SCROLL-1: mounts on the first width, emits the initial range and scrolls to today', () => {
    const changes: RangeChangeInfo[] = [];
    const gantt = createGanttCore({
      tasks: TASKS.slice(0, 2),
      now: () => '2026-03-04',
      scroll: { align: 'center' },
      onRangeChange: (range) => changes.push(range),
    });
    expect(gantt.setViewport({ width: 0, height: 400 })).toBeUndefined();
    expect(gantt.scrollToToday()).toBeUndefined();
    // Not shown yet: the range re-resolved for new data is reported by the mount.
    gantt.setTasks(TASKS);
    expect(changes).toEqual([]);
    // 14 days of padding (the day mode's) on each side of the data.
    const { range } = gantt.getSnapshot().timeline;
    expect([range.start, range.end]).toEqual([at('2026-02-16'), at('2026-05-02')]);
    const request = gantt.setViewport({ width: 800, height: 400 });
    expect(request).toMatchObject({ id: 1, reason: 'initial', behavior: 'instant' });
    expect(changes).toEqual([
      { start: toDate(range.start), end: toDate(range.end), reason: 'initial' },
    ]);
    // Today (00:00) in the middle of the viewport.
    expect(dateAt(gantt, 400)).toBe(at('2026-03-04'));
    expect(gantt.getSnapshot().scrollRequest).toBe(request);
    expect(gantt.setViewport({ width: 900, height: 400 })).toBeUndefined();
  });

  it('FR-SCROLL-1: initial scroll none, start, first-task and a date', () => {
    expect(chart({ scroll: { initial: 'none' } }).getSnapshot().scrollRequest).toBeUndefined();
    expect(chart({ scroll: { initial: 'start' } }).getSnapshot().timeline.scrollLeft).toBe(0);
    expect(dateAt(chart({ scroll: { initial: 'first-task' } }), 0)).toBe(at('2026-03-02'));
    expect(dateAt(chart({ scroll: { initial: '2026-03-09' } }), 0)).toBe(at('2026-03-09'));
  });

  it('FR-TL-1: the range follows new data with the left-edge date kept (reason data)', () => {
    const gantt = chart({ scroll: { initial: '2026-03-09' } });
    const list = ranges(gantt);
    const left = dateAt(gantt, 0);
    gantt.setTasks([
      { id: 'early', name: 'Early', start: '2026-01-05', end: '2026-01-09' },
      ...TASKS,
    ]);
    expect(list).toEqual([expect.objectContaining({ reason: 'data' })]);
    expect(gantt.getSnapshot().timeline.range.start).toBe(at('2025-12-22'));
    expect(dateAt(gantt, 0)).toBe(left);
    expect(gantt.getSnapshot().scrollRequest).toMatchObject({
      reason: 'data',
      behavior: 'instant',
    });
  });
});

describe('createGanttCore: the infinite timeline through scroll()', () => {
  const infinite = { timeline: { infinite: { extendBy: '2w' } } } as const;

  it('FR-TL-2, FR-TL-3: extending the start keeps the date under the left edge', () => {
    const gantt = chart({ ...infinite, scroll: { initial: '2026-03-09' } });
    const list = ranges(gantt);
    const before = gantt.getSnapshot().timeline;
    const left = before.scale.xToDate(0);
    // The renderer scrolled to the very start.
    const change = gantt.scroll({ left: 0, top: 0 });
    expect(change?.reason).toBe('extend-start');
    expect(change!.shift).toBeGreaterThan(0);
    const after = gantt.getSnapshot().timeline;
    expect(after.scrollLeft).toBe(change!.shift);
    expect(after.scale.xToDate(after.scrollLeft)).toBe(left);
    expect(list).toEqual([
      { start: toDate(after.range.start), end: toDate(after.range.end), reason: 'extend-start' },
    ]);
    // The compensated position comes back: nothing more to do.
    expect(gantt.scroll({ left: after.scrollLeft, top: 0 })).toBeUndefined();
  });

  it('FR-TL-2, FR-TL-4: extends the end without a shift and trims within maxSpan', () => {
    const gantt = chart({ timeline: { infinite: { extendBy: '2w', maxSpan: '6mo' } } });
    const list = ranges(gantt);
    let { timeline } = gantt.getSnapshot();
    const shifts: number[] = [];
    for (let i = 0; i < 40; i++) {
      // Scroll to the end, then report the (compensated) position again on the next frame.
      const end = timeline.scale.durationToPx(timeline.range.end - timeline.range.start) - 800;
      const grown = gantt.scroll({ left: end, top: 0 });
      if (grown !== undefined) shifts.push(grown.shift);
      const trimmed = gantt.scroll({ left: gantt.getSnapshot().timeline.scrollLeft, top: 0 });
      if (trimmed !== undefined) shifts.push(trimmed.shift);
      timeline = gantt.getSnapshot().timeline;
    }
    expect(new Set(list.map((range) => range.reason))).toEqual(
      new Set(['extend-end', 'trim-start']),
    );
    // Growing the end moves nothing; trimming the start moves everything left.
    expect(
      shifts.every((shift, i) => (list[i]!.reason === 'extend-end' ? shift === 0 : shift < 0)),
    ).toBe(true);
    const span = timeline.range.end - timeline.range.start;
    expect(span).toBeLessThanOrEqual(200 * DAY);
  });

  it('FR-TL-6: scrollToDate outside the range grows it first and jumps without a visible move', () => {
    const gantt = chart({ ...infinite, scroll: { initial: '2026-03-09', behavior: 'smooth' } });
    const list = ranges(gantt);
    const left = dateAt(gantt, 0);
    const request = gantt.scrollToDate('2025-06-02')!;
    const { timeline } = gantt.getSnapshot();
    expect(list).toEqual([expect.objectContaining({ reason: 'scroll-to' })]);
    expect(timeline.range.start).toBeLessThanOrEqual(at('2025-06-02'));
    expect(request).toMatchObject({ reason: 'scroll-to', behavior: 'smooth' });
    // `from` is the old picture in the new coordinates; the smooth scroll ends at the date.
    expect(timeline.scale.xToDate(request.from!)).toBe(left);
    expect(timeline.scrollLeft).toBe(request.from);
    expect(timeline.scale.xToDate(request.left!)).toBe(at('2025-06-02'));
  });

  it('FR-TL-6: without the infinite timeline a scroll target is clamped to the range', () => {
    const gantt = chart({ scroll: { initial: '2026-03-09' } });
    const request = gantt.scrollToDate('2025-06-02', { behavior: 'instant', align: 'center' })!;
    expect(request).toMatchObject({ from: undefined, left: 0, behavior: 'instant' });
    expect(gantt.getSnapshot().timeline.scrollLeft).toBe(0);
    expect(gantt.scrollToDate('not a date')).toBeUndefined();
  });

  it('FR-EDIT-6: a scroll during a drag keeps the bar under the still pointer', () => {
    const gantt = chart({ scroll: { initial: 'start', autoScroll: { edge: 40 } } }, 2000);
    const bar = gantt.getBarRect('design')!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width / 2;
    const event = (type: PointerInput['type'], dx: number): PointerInput => ({
      type,
      pointerId: 1,
      x: x + dx,
      y,
      time: 0,
    });
    gantt.send(event('down', 0));
    gantt.send(event('move', DAY_PX));
    expect(gantt.getSnapshot().feedback.patch?.start).toBe(at('2026-03-03'));
    // The renderer scrolled one day further (autoscroll, wheel): the pointer now points at it.
    gantt.scroll({ left: DAY_PX, top: 0 });
    expect(gantt.getSnapshot().feedback.patch?.start).toBe(at('2026-03-04'));
    // Near the right edge the autoscroll velocity shows up in the effects and the snapshot.
    const effects = gantt.send(event('move', 2000 - x + DAY_PX - 5));
    expect(effects.find((effect) => effect.type === 'autoscroll')).toMatchObject({
      velocity: expect.any(Number) as number,
    });
    expect(gantt.getSnapshot().autoScroll).toBeGreaterThan(0);
  });
});

describe('createGanttCore: options that change a gesture in progress', () => {
  it('FR-EDIT-6, FR-EDIT-7: turning autoscroll off mid-drag stops it at once, without a pointer event', () => {
    const gantt = chart({ scroll: { initial: 'start', autoScroll: { edge: 40 } } }, 2000);
    const bar = gantt.getBarRect('design')!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width / 2;
    const event = (type: PointerInput['type'], to: number): PointerInput => ({
      type,
      pointerId: 1,
      x: to,
      y,
      time: 0,
    });
    gantt.send(event('down', x));
    gantt.send(event('move', 2000 - 5));
    expect(gantt.getSnapshot().autoScroll).toBeGreaterThan(0);

    gantt.setOptions({ scroll: { autoScroll: false } });

    expect(gantt.getSnapshot().autoScroll).toBe(0);
    expect(gantt.getSnapshot().feedback.phase).toBe('dragging');
  });
});

describe('createGanttCore: scroll requests', () => {
  it('FR-SCROLL-2: scrollToTask scrolls both axes and expands collapsed ancestors', () => {
    const gantt = chart({ scroll: { initial: 'start' } }, 400);
    // The body shows one row below the 75 px header.
    gantt.setViewport({ width: 400, height: 75 + 48 });
    gantt.collapse('phase');
    const expanded: unknown[] = [];
    gantt.on('expandedChange', (keys) => expanded.push(keys));
    const request = gantt.scrollToTask('child', { align: 'start', behavior: 'instant' })!;
    expect(expanded).toEqual([['phase']]);
    const row = gantt.getRowMetrics('child')!;
    expect(request).toMatchObject({ reason: 'scroll-to', top: row.y, behavior: 'instant' });
    expect(dateAt(gantt, 0)).toBe(at('2026-04-13'));
    expect(gantt.getSnapshot().scrollTop).toBe(row.y);
    gantt.collapse('phase');
    expect(gantt.scrollToTask('child', { expand: false })).toBeUndefined();
    expect(gantt.scrollToTask('ghost')).toBeUndefined();
  });

  it('FR-SCALE-3: setViewMode keeps the centre date; keepScroll false scrolls like at mount', () => {
    const gantt = chart({ scroll: { initial: '2026-03-23' } });
    const events: string[] = [];
    gantt.on('viewModeChange', (viewMode) => events.push(viewMode.id));
    const centre = dateAt(gantt, 400);
    const request = gantt.setViewMode('week')!;
    expect(request).toMatchObject({ reason: 'view-mode', behavior: 'instant' });
    expect(gantt.getSnapshot().timeline.scale.pxPerDay).toBe(20);
    expect(Math.abs(dateAt(gantt, 400) - centre)).toBeLessThan(DAY);
    gantt.setViewMode('day', { keepScroll: false });
    expect(dateAt(gantt, 0)).toBe(at('2026-03-23'));
    expect(gantt.setViewMode('day')).toBeUndefined();
    gantt.setOptions({ viewMode: 'month' });
    expect(events).toEqual(['week', 'day', 'month']);
    // An unknown id falls back to the day mode, with an issue.
    gantt.setViewMode('fortnight');
    expect(gantt.getSnapshot().viewMode.id).toBe('day');
    expect(gantt.getIssues().options.map((found) => found.code)).toEqual(['unknown-view-mode']);
  });

  it('FR-SCALE-6: zoomTo keeps the date under the anchor', () => {
    const gantt = chart({ scroll: { initial: '2026-03-23' } });
    const anchored = dateAt(gantt, 100);
    const request = gantt.zoomTo(80, { anchor: 100 })!;
    expect(request).toMatchObject({ reason: 'zoom' });
    expect(gantt.getSnapshot().timeline.scale.pxPerDay).toBe(80);
    expect(Math.abs(dateAt(gantt, 100) - anchored)).toBeLessThanOrEqual(1);
    expect(gantt.zoomTo(-1)).toBeUndefined();
    expect(gantt.zoomTo(80)).toBeUndefined();
    // Another view mode drops the zoom.
    gantt.setViewMode('week');
    gantt.setViewMode('day');
    expect(gantt.getSnapshot().timeline.scale.pxPerDay).toBe(40);
  });

  it('applies the direction and the locale to the scale and the header', () => {
    const gantt = chart({ direction: 'rtl', locale: 'uk' });
    expect(gantt.getSnapshot().timeline.scale.direction).toBe('rtl');
    expect(gantt.getSnapshot().header.locale).toBe('uk');
    const header = gantt.getSnapshot().header;
    gantt.setOptions({ direction: 'ltr' });
    expect(gantt.getSnapshot().timeline.scale.direction).toBe('ltr');
    expect(gantt.getSnapshot().header).not.toBe(header);
  });
});

describe('createGanttCore: review of the timeline and scrolling', () => {
  it('FR-TL-4, FR-SCALE-6: a view mode switch of a long infinite timeline settles within maxWidth', () => {
    const gantt = chart({
      viewMode: 'year',
      timeline: { infinite: true },
      scroll: { initial: '2026-03-09' },
    });
    // Twelve scrolls to the very start: each grows the range by two viewport widths of time.
    for (let i = 0; i < 12; i++) gantt.scroll({ left: 0, top: 0 });
    // At the hour mode's 960 px per day the whole range would be far over the browsers' limits.
    expect(gantt.getSnapshot().contentWidth * 960).toBeGreaterThan(20_000_000);
    const centre = exactDateAt(gantt, 400);
    const list = ranges(gantt);
    const request = gantt.setViewMode('hour')!;
    const after = gantt.getSnapshot();
    expect(after.contentWidth).toBeLessThanOrEqual(VIEWPORT_DEFAULTS.maxWidth);
    expect(request).toMatchObject({
      reason: 'view-mode',
      left: after.timeline.scrollLeft,
      behavior: 'instant',
    });
    expect(request.left).toBeLessThanOrEqual(after.contentWidth - 800);
    expect(Math.abs(exactDateAt(gantt, 400) - centre) * (960 / DAY)).toBeLessThan(1e-3);
    expect(list).toEqual([expect.objectContaining({ reason: 'view-mode' })]);
    // Nothing more to do at the reported position.
    expect(gantt.scroll({ left: after.timeline.scrollLeft, top: 0 })).toBeUndefined();
  });

  it('FR-TL-4, FR-SCALE-7, FR-TL-7: zoomTo settles the same way and reports zoom', () => {
    const gantt = chart({
      viewMode: 'year',
      timeline: { infinite: true },
      scroll: { initial: '2026-03-09' },
    });
    for (let i = 0; i < 12; i++) gantt.scroll({ left: 0, top: 0 });
    const anchored = exactDateAt(gantt, 100);
    const list = ranges(gantt);
    const request = gantt.zoomTo(960, { anchor: 100 })!;
    const after = gantt.getSnapshot();
    expect(after.contentWidth).toBeLessThanOrEqual(VIEWPORT_DEFAULTS.maxWidth);
    expect(request).toMatchObject({ reason: 'zoom', left: after.timeline.scrollLeft });
    expect(Math.abs(exactDateAt(gantt, 100) - anchored) * (960 / DAY)).toBeLessThan(1e-3);
    expect(list).toEqual([expect.objectContaining({ reason: 'zoom' })]);
  });

  it('FR-TL-4: data changes keep the range of the infinite timeline instead of growing it back', async () => {
    const tasks: readonly Task[] = [
      ...TASKS,
      { id: 'late', name: 'Late', start: '2027-06-01', end: '2027-06-04' },
    ];
    const gantt = chart({
      tasks,
      timeline: { infinite: { maxSpan: '6mo' } },
      scroll: { initial: '2026-03-09' },
    });
    const { range } = gantt.getSnapshot().timeline;
    // The data and its padding span 16 months: trimmed to six at the mount already.
    expect(range.end - range.start).toBeLessThanOrEqual(184 * DAY);
    const list = ranges(gantt);
    const made = gantt.getSnapshot().scrollRequest;
    gantt.setTasks([...tasks]);
    gantt.setTasks(tasks.map((task) => (task.id === 'build' ? { ...task, name: 'Built' } : task)));
    await gantt.updateTask('late', { start: '2027-07-01' });
    expect(gantt.getSnapshot().timeline.range).toEqual(range);
    expect(list).toEqual([]);
    expect(gantt.getSnapshot().scrollRequest).toBe(made);
  });

  it('FR-TL-6: a far scroll whose range change cuts the view away jumps instantly', () => {
    const tasks: readonly Task[] = [
      ...TASKS,
      { id: 'late', name: 'Late', start: '2027-06-01', end: '2027-06-04' },
    ];
    const gantt = chart({
      tasks,
      timeline: { infinite: { maxSpan: '3mo' } },
      scroll: { initial: '2026-03-09', behavior: 'smooth' },
    });
    const list = ranges(gantt);
    const request = gantt.scrollToDate('2026-07-20')!;
    // The range kept no part of the old view: no smooth scroll from an unrelated place.
    expect(request).toMatchObject({ reason: 'scroll-to', from: undefined, behavior: 'instant' });
    expect(gantt.getSnapshot().timeline.scrollLeft).toBe(request.left);
    expect(dateAt(gantt, 0)).toBe(at('2026-07-20'));
    expect(list).toEqual([expect.objectContaining({ reason: 'scroll-to' })]);
    // The same for a task far away.
    gantt.scroll({ left: request.left!, top: 0 });
    const task = gantt.scrollToTask('late')!;
    expect(task).toMatchObject({ from: undefined, behavior: 'instant' });
    expect(dateAt(gantt, 0)).toBe(at('2027-06-01'));
    // A near target keeps the view and scrolls smoothly.
    gantt.scroll({ left: task.left!, top: 0 });
    expect(gantt.scrollToDate('2027-06-08')).toMatchObject({ behavior: 'smooth' });
  });

  it('FR-SCROLL-2: a smooth request after an instant one not reported back yet says where to start', () => {
    const gantt = chart({ scroll: { initial: '2026-03-09', behavior: 'smooth' } });
    gantt.scroll({ left: gantt.getSnapshot().timeline.scrollLeft, top: 0 });
    gantt.setTasks([
      { id: 'early', name: 'Early', start: '2026-01-05', end: '2026-01-09' },
      ...TASKS,
    ]);
    const data = gantt.getSnapshot().scrollRequest!;
    expect(data).toMatchObject({ reason: 'data', behavior: 'instant' });
    // A renderer that applies only the latest request in a frame skips `data`: the smooth one
    // starts from the offset `data` stood for.
    const request = gantt.scrollToDate('2026-04-06')!;
    expect(request).toMatchObject({ behavior: 'smooth', from: data.left });
    // Once the renderer reports a position, smooth requests start wherever it is.
    gantt.scroll({ left: request.left!, top: 0 });
    expect(gantt.scrollToDate('2026-03-16')).toMatchObject({ behavior: 'smooth', from: undefined });
  });

  it('FR-TL-1: a range that grows at the end only asks for no scroll', () => {
    const gantt = chart({ scroll: { initial: '2026-03-09' } });
    const made = gantt.getSnapshot().scrollRequest;
    const list = ranges(gantt);
    const left = dateAt(gantt, 0);
    gantt.setTasks([
      ...TASKS,
      { id: 'late', name: 'Late', start: '2026-06-01', end: '2026-06-05' },
    ]);
    expect(list).toEqual([expect.objectContaining({ reason: 'data' })]);
    expect(gantt.getSnapshot().scrollRequest).toBe(made);
    expect(dateAt(gantt, 0)).toBe(left);
  });

  it('FR-TL-2: a viewport widened after the mount extends the infinite timeline', () => {
    const bounded = chart({
      timeline: { infinite: { bounds: { min: '2026-02-16' } } },
      scroll: { initial: 'start' },
    });
    expect(bounded.getSnapshot().timeline.scrollLeft).toBe(0);
    const list = ranges(bounded);
    // The start is at its bound: the end grows, nothing to compensate.
    expect(bounded.setViewport({ width: 3280, height: 400 })).toBeUndefined();
    const { timeline, contentWidth } = bounded.getSnapshot();
    expect(timeline.scrollLeft).toBe(0);
    expect(contentWidth - 3280).toBeGreaterThan(3280);
    expect(list).toEqual([expect.objectContaining({ reason: 'resize' })]);

    // Without a bound the start grows as well, and the renderer compensates.
    const free = chart({ timeline: { infinite: true }, scroll: { initial: '2026-03-09' } });
    const left = exactDateAt(free, 0);
    const request = free.setViewport({ width: 3280, height: 400 })!;
    expect(request).toMatchObject({
      reason: 'resize',
      behavior: 'instant',
      left: free.getSnapshot().timeline.scrollLeft,
    });
    expect(Math.abs(exactDateAt(free, 0) - left) * (40 / DAY)).toBeLessThan(1e-3);
    // The same width again changes nothing.
    expect(free.setViewport({ width: 3280, height: 500 })).toBeUndefined();
  });

  it('FR-EDIT-6: new tasks during a drag keep the dragged bar at its preview', () => {
    const gantt = chart({ scroll: { initial: 'start' } }, 2000);
    const bar = gantt.getBarRect('design')!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width / 2;
    gantt.send({ type: 'down', pointerId: 1, x, y, time: 0 });
    gantt.send({ type: 'move', pointerId: 1, x: x + DAY_PX, y, time: 0 });
    expect(gantt.getBarRect('design')!.x).toBe(bar.x + DAY_PX);
    gantt.setTasks(TASKS.map((task) => ({ ...task })));
    expect(gantt.getSnapshot().feedback.patch?.start).toBe(at('2026-03-03'));
    expect(gantt.getBarRect('design')!.x).toBe(bar.x + DAY_PX);
  });

  it('FR-SCROLL-1, FR-TL-2: the infinite timeline opens on the data range edge for start and end', () => {
    const start = chart({ timeline: { infinite: true }, scroll: { initial: 'start' } });
    expect(dateAt(start, 0)).toBe(at('2026-02-16'));
    // With more timeline before it, so the first extension does not fire right away.
    expect(start.getSnapshot().timeline.range.start).toBeLessThan(at('2026-02-16'));
    expect(start.scroll({ left: start.getSnapshot().timeline.scrollLeft, top: 0 })).toBeUndefined();
    const end = chart({ timeline: { infinite: true }, scroll: { initial: 'end' } });
    expect(dateAt(end, 800)).toBe(at('2026-05-02'));
    expect(end.getSnapshot().timeline.range.end).toBeGreaterThan(at('2026-05-02'));
  });

  it('FR-TL-7: range changes driven by options say so', () => {
    const gantt = chart({ scroll: { initial: '2026-03-09' } });
    const list = ranges(gantt);
    const left = dateAt(gantt, 0);
    gantt.setOptions({ timeline: { padding: '1mo' } });
    expect(list.map((range) => range.reason)).toEqual(['options']);
    // The start moved: the left edge date is kept by an instant request.
    expect(gantt.getSnapshot().scrollRequest).toMatchObject({
      reason: 'options',
      behavior: 'instant',
    });
    expect(dateAt(gantt, 0)).toBe(left);
    gantt.setOptions({ now: () => '2026-09-01', timeline: { padding: '1mo', includeToday: true } });
    expect(list.map((range) => range.reason)).toEqual(['options', 'options']);
  });
});

describe('createGanttCore: scrolling asked for before the chart has a width', () => {
  /** A core that has not been given a viewport yet (a hidden container, a slow stylesheet). */
  function unmounted(options: Partial<GanttCoreOptions> = {}): GanttCore {
    return createGanttCore({
      tasks: TASKS,
      calendar: { weekends: [0, 6] },
      now: () => '2026-03-04',
      ...options,
    });
  }

  it('FR-SCROLL-2: scrollToDate before the mount is performed by the mount, in place of scroll.initial', () => {
    const gantt = unmounted({ scroll: { initial: 'start' } });

    // Nothing to scroll yet: no request now, but the call is not forgotten.
    expect(gantt.scrollToDate('2026-04-06', { align: 0 })).toBeUndefined();
    expect(gantt.setViewport({ width: 0, height: 400 })).toBeUndefined();
    const request = gantt.setViewport({ width: 800, height: 400 });

    expect(request).toMatchObject({ reason: 'initial', behavior: 'instant' });
    expect(gantt.getSnapshot().scrollRequest).toBe(request);
    expect(dateAt(gantt, 0)).toBe(at('2026-04-06'));
    // Once mounted, calls are requests again and nothing is replayed.
    expect(gantt.scrollToDate('2026-03-09', { behavior: 'instant', align: 0 })).toMatchObject({
      reason: 'scroll-to',
    });
    expect(gantt.setViewport({ width: 900, height: 400 })).toBeUndefined();
  });

  it('FR-SCROLL-2: the latest call wins, and an unreadable date does not replace an earlier one', () => {
    const gantt = unmounted({ scroll: { initial: 'start' } });

    gantt.scrollToDate('2026-03-23', { align: 0 });
    gantt.scrollToDate('2026-04-06', { align: 0 });
    gantt.scrollToDate('not a date');
    gantt.setViewport({ width: 800, height: 400 });

    expect(dateAt(gantt, 0)).toBe(at('2026-04-06'));
  });

  it('FR-SCROLL-2: scrollToToday before the mount keeps its options and reads today at the mount', () => {
    let today = '2026-03-04';
    const gantt = unmounted({ now: () => today, scroll: { initial: 'start' } });

    gantt.scrollToToday({ align: 'center' });
    today = '2026-03-10';
    gantt.setViewport({ width: 800, height: 400 });

    expect(dateAt(gantt, 400)).toBe(at('2026-03-10'));
  });

  it('FR-SCROLL-2: scrollToTask before the mount scrolls both axes and expands the ancestors', () => {
    const gantt = unmounted({ scroll: { initial: 'start' } });
    gantt.collapse('phase');

    expect(gantt.scrollToTask('child', { align: 'start', behavior: 'smooth' })).toBeUndefined();
    // The body shows one row below the 75 px header.
    const request = gantt.setViewport({ width: 400, height: 75 + 48 })!;

    const row = gantt.getRowMetrics('child')!;
    expect(request).toMatchObject({ reason: 'initial', top: row.y, behavior: 'instant' });
    expect(dateAt(gantt, 0)).toBe(at('2026-04-13'));
    expect(gantt.getSnapshot().scrollTop).toBe(row.y);
  });

  it('FR-SCROLL-2: a task that is not there leaves scroll.initial to place the chart', () => {
    const gantt = unmounted({ scroll: { initial: '2026-03-09' } });

    gantt.scrollToTask('ghost');
    gantt.setViewport({ width: 800, height: 400 });

    expect(dateAt(gantt, 0)).toBe(at('2026-03-09'));
  });

  it('FR-SCROLL-2: a later scroll.initial does not override a scroll the application asked for', () => {
    const gantt = unmounted({ scroll: { initial: 'start' } });

    gantt.scrollToDate('2026-04-06', { align: 0 });
    gantt.setOptions({ scroll: { initial: 'end' } });
    gantt.setViewport({ width: 800, height: 400 });

    expect(dateAt(gantt, 0)).toBe(at('2026-04-06'));
  });

  it('FR-SCROLL-2, FR-TL-6: with the infinite timeline the range grows to hold the date first', () => {
    const gantt = unmounted({
      timeline: { infinite: { extendBy: '2w' } },
      scroll: { initial: 'start' },
    });
    const list: RangeChangeInfo[] = [];
    gantt.on('rangeChange', (range) => list.push(range));

    gantt.scrollToDate('2025-06-02', { align: 0 });
    gantt.setViewport({ width: 800, height: 400 });

    expect(dateAt(gantt, 0)).toBe(at('2025-06-02'));
    expect(gantt.getSnapshot().timeline.range.start).toBeLessThanOrEqual(at('2025-06-02'));
    expect(list.map((range) => range.reason)).toEqual(['initial']);
  });
});

describe('createGanttCore: renderer input never throws once it has changed something', () => {
  const infinite = { timeline: { infinite: { extendBy: '2w' } } } as const;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * What the core hands to the host's unhandled-rejection channel (`Promise.reject`), without
   * letting it reach the test runner.
   */
  function captureReports(): unknown[] {
    const reports: unknown[] = [];
    vi.spyOn(Promise, 'reject').mockImplementation((reason) => {
      reports.push(reason);
      return new Promise<never>(() => undefined);
    });
    return reports;
  }

  const boom = (): void => {
    throw new Error('boom');
  };

  it('FR-EVT-1, FR-TL-3: a throwing rangeChange listener does not take the compensation away from scroll()', () => {
    const reports = captureReports();
    const gantt = chart({ ...infinite, scroll: { initial: '2026-03-09' } });
    gantt.on('rangeChange', boom);
    // The renderer scrolled to the very start: the date there is the one that has to stay put.
    const left = gantt.getSnapshot().timeline.scale.xToDate(0);

    // The range was extended and published: the renderer needs the change to compensate for it.
    const change = gantt.scroll({ left: 0, top: 0 });

    expect(change).toMatchObject({ reason: 'extend-start' });
    expect(change!.shift).toBeGreaterThan(0);
    const { timeline } = gantt.getSnapshot();
    expect(timeline.range).toEqual(change!.range);
    expect(timeline.scale.xToDate(timeline.scrollLeft)).toBe(left);
    // Never swallowed: reported outside the call, where a listener error of the host would be.
    expect(reports).toEqual([new Error('boom')]);
  });

  it('FR-EVT-1: errors of listeners reach the error channel first, and nothing is reported when one listens', () => {
    const reports = captureReports();
    const gantt = chart({ ...infinite, scroll: { initial: '2026-03-09' } });
    const errors: unknown[] = [];
    gantt.on('error', ({ error }) => errors.push(error));
    gantt.on('rangeChange', boom);

    expect(gantt.scroll({ left: 0, top: 0 })).toMatchObject({ reason: 'extend-start' });

    expect(errors).toEqual([new Error('boom')]);
    expect(reports).toEqual([]);
  });

  it('FR-EVT-1: setViewport, send and refreshNow do not throw after a throwing listener ran either', () => {
    const reports = captureReports();
    const gantt = createGanttCore({ tasks: TASKS, now: () => '2026-03-04' });
    gantt.on('rangeChange', boom);
    // The mount: the request is returned, not lost with the listener's error.
    expect(gantt.setViewport({ width: 800, height: 400 })).toMatchObject({ reason: 'initial' });
    expect(reports).toHaveLength(1);

    // A click on a bar: the effects of the event are returned.
    gantt.on('taskClick', boom);
    const bar = gantt.getBarRect('design')!;
    const point = { pointerId: 1, x: bar.x + 4, y: bar.y + bar.height / 2, time: 0 };
    gantt.send({ type: 'down', ...point });
    expect(Array.isArray(gantt.send({ type: 'up', ...point }))).toBe(true);
    expect(reports).toHaveLength(2);

    // The clock: a subscriber that throws when the minute moves.
    let minute = '2026-03-04T10:00';
    const ticking = createGanttCore({ tasks: TASKS, now: () => minute });
    ticking.setViewport({ width: 800, height: 400 });
    ticking.subscribe(boom);
    minute = '2026-03-04T10:01';
    expect(() => {
      ticking.refreshNow();
    }).not.toThrow();
    expect(reports).toHaveLength(3);
  });

  it('FR-EVT-1: the other methods still throw what their listeners threw, after the change was made', () => {
    const gantt = chart();
    gantt.on('selectionChange', boom);

    expect(() => {
      gantt.select(['design']);
    }).toThrow('boom');
    expect(gantt.getSnapshot().selection.tasks).toEqual(['design']);
  });
});
