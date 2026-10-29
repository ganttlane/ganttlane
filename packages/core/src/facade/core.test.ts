import { deepFreeze, edgeCases, sampleProject, workingDayScenarios } from '@ganttlane/fixtures';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { barHandles, type PointerInput, type TaskPart } from '../interaction';
import { type Link, patchTask, type Task, type TaskId } from '../model';
import { headerRows } from '../scale';
import { propagate } from '../schedule';
import { type DateTimeMs, parseDateInput, toDate } from '../time';
import { keyOfIssues } from './core';
import {
  createGanttCore,
  type GanttCore,
  type GanttCoreOptions,
  type GanttEventName,
  type TaskRecord,
} from './index';

/** A local `Date` with the wall clock of an ISO string. */
function date(iso: string): Date {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return toDate(parsed.value.value);
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets pending promise callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const DAY_PX = 40;
const TASKS: readonly Task<{ readonly owner: string }>[] = deepFreeze([
  {
    id: 'design',
    name: 'Design',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 50,
    data: { owner: 'ann' },
  },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'phase', name: 'Phase', start: '2026-03-16', end: '2026-03-27' },
  { id: 'child', name: 'Child', parentId: 'phase', start: '2026-03-16', end: '2026-03-18' },
  { id: 'stub', name: 'Stub', type: 'placeholder' },
]);
const LINKS: readonly Link[] = deepFreeze([
  { id: 'design-build', source: 'design', target: 'build' },
]);

type Options = Partial<GanttCoreOptions<{ readonly owner: string }>>;

/** A mounted chart over TASKS: 2000 px wide (no autoscroll zone in reach), scrolled to the start. */
function chart(options: Options = {}): GanttCore<{ readonly owner: string }> {
  const gantt = createGanttCore<{ readonly owner: string }>({
    tasks: TASKS,
    links: LINKS,
    calendar: { weekends: [0, 6] },
    now: () => '2026-03-04',
    scroll: { initial: 'start', autoScroll: false },
    ...options,
  });
  gantt.setViewport({ width: 2000, height: 600 });
  return gantt;
}

/** The centre of a bar part, in the content coordinates `send` takes. */
function point<TData>(
  gantt: GanttCore<TData>,
  id: TaskId,
  part: TaskPart = 'body',
): { x: number; y: number } {
  const bar = gantt.getBarRect(id);
  if (bar === undefined) throw new Error(`no bar for ${String(id)}`);
  const handles = barHandles(bar);
  const box =
    part === 'resize-start'
      ? handles.resizeStart
      : part === 'resize-end'
        ? handles.resizeEnd
        : part === 'link-start'
          ? handles.linkStart
          : part === 'link-end'
            ? handles.linkEnd
            : part === 'progress'
              ? handles.progress
              : bar;
  if (box === undefined) throw new Error(`no ${part} handle`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

let clock = 0;
function pointer(type: PointerInput['type'], at: { x: number; y: number }): PointerInput {
  clock += 10;
  return { type, pointerId: 1, x: at.x, y: at.y, time: clock, event: { type } };
}

/** Drags a part of a bar by `dx` px: down, move, up. */
function drag<TData>(
  gantt: GanttCore<TData>,
  id: TaskId,
  dx: number,
  part: TaskPart = 'body',
): void {
  const from = point(gantt, id, part);
  const to = { x: from.x + dx, y: from.y };
  gantt.send(pointer('down', from));
  gantt.send(pointer('move', to));
  gantt.send(pointer('up', to));
}

/** Logs the public arguments of events. */
function log<TData>(
  gantt: GanttCore<TData>,
  names: readonly GanttEventName[],
): (readonly [GanttEventName, ...unknown[]])[] {
  const entries: (readonly [GanttEventName, ...unknown[]])[] = [];
  for (const name of names) {
    const handler = (...args: unknown[]): void => {
      entries.push([name, ...args]);
    };
    gantt.on(name, handler);
  }
  return entries;
}

describe('createGanttCore: data', () => {
  it('FR-API-1, FR-DATA-8, FR-API-6: builds public records with Dates and the typed payload', () => {
    const gantt = chart();
    const design = gantt.getTask('design')!;
    expectTypeOf(design).toEqualTypeOf<TaskRecord<{ readonly owner: string }>>();
    expect(design).toMatchObject({
      id: 'design',
      name: 'Design',
      type: 'task',
      precision: 'day',
      start: date('2026-03-02'),
      end: date('2026-03-06'),
      endExclusive: date('2026-03-07'),
      progress: 50,
      // 50 % of five days, aligned down to the day (FR-SNAP-15).
      progressDate: date('2026-03-04'),
      level: 0,
      parentId: undefined,
      childIds: [],
      rowIndex: 0,
      isExpanded: false,
      issues: [],
    });
    expect(design.task).toBe(TASKS[0]);
    expect(design.task.data?.owner).toBe('ann');
    expect(design.duration).toMatchObject({ calendarDays: 5, workingDays: 5 });
    expect(gantt.getTask('design')).toBe(design);
    expect(gantt.getTask('phase')).toMatchObject({ childIds: ['child'], isExpanded: true });
    expect(gantt.getTask('child')).toMatchObject({ level: 1, parentId: 'phase', rowIndex: 3 });
    // A placeholder row has no dates (FR-DATA-3).
    expect(gantt.getTask('stub')).toMatchObject({
      type: 'placeholder',
      start: undefined,
      end: undefined,
      duration: undefined,
      rowIndex: 4,
    });
    expect(gantt.getTask('ghost')).toBeUndefined();
    expect(gantt.getLink('design-build')).toMatchObject({ source: 'design', target: 'build' });
    expect(gantt.getLink('ghost')).toBeUndefined();
  });

  it('FR-DATA-1: never mutates the options, tasks or links', () => {
    const options = deepFreeze({
      tasks: TASKS,
      links: LINKS,
      calendar: { weekends: [0, 6] },
      scheduling: { snap: '1d' },
      scroll: { initial: 'start', autoScroll: false },
    } satisfies GanttCoreOptions);
    const gantt = createGanttCore(options);
    gantt.setViewport({ width: 2000, height: 600 });
    drag(gantt, 'design', DAY_PX);
    gantt.setOptions({ scheduling: { propagation: 'none' }, layout: { rowHeight: 40 } });
    expect(gantt.getSnapshot().state.tasks[0]).not.toBe(TASKS[0]);
    expect(TASKS[0]).toMatchObject({ start: '2026-03-02', end: '2026-03-06' });
  });

  it('FR-TX-3: uncontrolled data is patched by a drag; the record and onTaskDatesChange follow', () => {
    const changes: unknown[] = [];
    const gantt = chart({
      onTaskDatesChange: (record, dates) => changes.push([record.id, record.start, dates]),
    });
    drag(gantt, 'design', DAY_PX);
    expect(gantt.getSnapshot().state.tasks[0]).toMatchObject({
      start: '2026-03-03',
      end: '2026-03-07',
    });
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-03'));
    expect(changes).toEqual([
      [
        'design',
        date('2026-03-03'),
        { start: date('2026-03-03'), end: date('2026-03-07'), endExclusive: date('2026-03-08') },
      ],
      [
        'build',
        date('2026-03-10'),
        { start: date('2026-03-10'), end: date('2026-03-14'), endExclusive: date('2026-03-15') },
      ],
    ]);
  });

  it('FR-TX-3: controlled data shows the commit as a draft until the owner passes the tasks back', () => {
    let owned: readonly Task<{ readonly owner: string }>[] = TASKS;
    const gantt: GanttCore<{ readonly owner: string }> = chart({
      dataMode: 'controlled',
      onTasksChange: (changeSet) => {
        const { model } = gantt.getSnapshot().state.derived;
        owned = owned.map((task) => {
          const change = changeSet.changes.find((c) => c.id === task.id);
          return change ? patchTask(task, change.after, model) : task;
        });
      },
    });
    const before = gantt.getBarRect('design')!;
    drag(gantt, 'design', DAY_PX);
    const snapshot = gantt.getSnapshot();
    // The data stays the owner's; the bar is drawn at its new place (the committed draft).
    expect(snapshot.state.tasks).toBe(TASKS);
    expect(snapshot.state.draft?.committed).toBe(true);
    expect(gantt.getBarRect('design')?.x).toBe(before.x + DAY_PX);
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-02'));
    gantt.setTasks(owned);
    expect(gantt.getSnapshot().state.draft).toBeUndefined();
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-03'));
    const { scale } = gantt.getSnapshot().timeline;
    expect(gantt.getBarRect('design')?.x).toBe(scale.dateToX(parseDay('2026-03-03')));
  });

  it('FR-DATA-7: setTasks and setLinks diff by id and keep the records of unchanged tasks', () => {
    const gantt = chart();
    const build = gantt.getTask('build');
    const version = gantt.getSnapshot().state.lastDataChange.version;
    gantt.setTasks([{ ...TASKS[0]!, name: 'Design 2' }, ...TASKS.slice(1)]);
    const { lastDataChange } = gantt.getSnapshot().state;
    expect(lastDataChange).toMatchObject({ version: version + 1, updated: ['design'] });
    expect(gantt.getTask('design')?.name).toBe('Design 2');
    expect(gantt.getTask('build')).toBe(build);
    gantt.setLinks(undefined);
    expect(gantt.getSnapshot().state.lastDataChange.links.removed).toEqual(['design-build']);
    expect(gantt.getLink('design-build')).toBeUndefined();
  });

  it('FR-API-5: queries the visible range, row metrics and bar rects', () => {
    const gantt = chart();
    const { timeline } = gantt.getSnapshot();
    const range = gantt.getVisibleRange();
    expect(range.start).toEqual(toDate(timeline.range.start));
    expect(range.end).toEqual(toDate(timeline.scale.xToDate(2000)));
    expect(gantt.getRowMetrics('build')).toEqual({ id: 'build', index: 1, y: 48, height: 48 });
    expect(gantt.getRowMetrics('ghost')).toBeUndefined();
    const bar = gantt.getBarRect('design')!;
    expect(bar).toMatchObject({ rowIndex: 0, width: 5 * DAY_PX, height: 30 });
    expect(bar.x).toBe(timeline.scale.dateToX(parseDay('2026-03-02')));
    expect(gantt.getBarRect('stub')).toBeUndefined();
  });

  it('FR-ROW-2: expand / collapse / expandAll / collapseAll emit expandedChange', () => {
    const gantt = chart();
    const events = log(gantt, ['expandedChange']);
    gantt.collapse('phase');
    expect(gantt.getRowMetrics('child')).toBeUndefined();
    expect(gantt.getTask('child')?.rowIndex).toBeUndefined();
    expect(gantt.getTask('phase')?.isExpanded).toBe(false);
    gantt.collapse('phase');
    gantt.expand('phase');
    gantt.collapseAll();
    gantt.expandAll();
    expect(events).toEqual([
      ['expandedChange', []],
      ['expandedChange', ['phase']],
      ['expandedChange', []],
      ['expandedChange', ['phase']],
    ]);
    gantt.setOptions({ hierarchy: { expandedKeys: [] } });
    expect(gantt.getRowMetrics('child')).toBeUndefined();
    expect(events).toHaveLength(4);
  });

  it('FR-ROW-2: expand and collapse of a task without children or of an unknown id change nothing', () => {
    const gantt = chart();
    const events = log(gantt, ['expandedChange']);
    const all = gantt.getSnapshot().state.expandedKeys;
    for (const id of ['build', 'child', 'stub', 'ghost']) {
      gantt.expand(id);
      gantt.collapse(id);
    }
    expect(events).toEqual([]);
    expect(gantt.getSnapshot().state.expandedKeys).toBe(all);

    gantt.collapse('phase');
    for (const id of ['build', 'child', 'ghost']) {
      gantt.expand(id);
      gantt.collapse(id);
    }
    expect(events).toEqual([['expandedChange', []]]);
    expect(gantt.getSnapshot().state.expandedKeys).toEqual([]);
    expect(gantt.getTask('phase')?.isExpanded).toBe(false);
  });

  it('FR-ROW-2: setOptions compares hierarchy.expandedKeys with the value given last, and never fires expandedChange', () => {
    const gantt = chart();
    const events = log(gantt, ['expandedChange']);
    const phase = (): boolean | undefined => gantt.getTask('phase')?.isExpanded;
    const keys = ['phase'];
    gantt.setOptions({ hierarchy: { expandedKeys: keys } });
    expect(phase()).toBe(true);
    gantt.collapse('phase');
    expect(events).toEqual([['expandedChange', []]]);
    // The same array again is no change, although the state has moved away from it since.
    gantt.setOptions({ hierarchy: { expandedKeys: keys } });
    expect(phase()).toBe(false);
    // A new array, even an equal one, replaces the state; the application already knows it.
    gantt.setOptions({ hierarchy: { expandedKeys: ['phase'] } });
    expect(phase()).toBe(true);
    // The same goes for "all".
    gantt.setOptions({ hierarchy: { expandedKeys: 'all' } });
    gantt.collapse('phase');
    gantt.setOptions({ hierarchy: { expandedKeys: 'all' } });
    expect(phase()).toBe(false);
    expect(events).toEqual([
      ['expandedChange', []],
      ['expandedChange', []],
    ]);
  });

  it('FR-API-2: setOptions merges a group one level deep; nested objects and lists are replaced whole', () => {
    const gantt = chart();
    const skipped = (): unknown =>
      gantt.getSnapshot().state.settings.propagation.skipNonWorkingDays;
    gantt.setOptions({ scheduling: { skipNonWorkingDays: { move: false, resize: true } } });
    expect(skipped()).toEqual({ move: false, resize: true });
    // `scheduling` is merged, but the object nested in it is taken whole: `move` and `resize`
    // are back to their defaults.
    gantt.setOptions({ scheduling: { skipNonWorkingDays: { progress: false } } });
    expect(skipped()).toEqual({ progress: false });
    // A field given with `undefined` returns to its default; a key left out keeps its value.
    gantt.setOptions({ viewMode: 'week' });
    gantt.setOptions({ scheduling: { durationMode: 'working' } });
    expect(skipped()).toEqual({ progress: false });
    gantt.setOptions({ viewMode: undefined });
    expect(gantt.getSnapshot().viewMode.id).toBe('day');
    // `tasks` has no default: `undefined` is an issue, and the chart is emptied.
    expect(gantt.setOptions({ tasks: undefined as never })).toEqual([
      expect.objectContaining({ code: 'invalid-option', path: 'tasks' }),
    ]);
    expect(gantt.getTask('design')).toBeUndefined();
  });

  it('builds records of the sample project in row order with levels', () => {
    const project = sampleProject;
    const gantt = createGanttCore({
      tasks: project.tasks,
      links: project.links,
      calendar: project.calendar,
    });
    const rows = gantt.getSnapshot().state.derived.rows;
    for (const row of rows) {
      const record = gantt.getTask(row.id)!;
      expect(record.rowIndex).toBe(row.index);
      expect(record.level).toBe(row.depth);
    }
    const placeholder = project.tasks.find((task) => task.type === 'placeholder')!;
    expect(gantt.getTask(placeholder.id)?.start).toBeUndefined();
    const outside = rows.map((row) => gantt.getTask(row.id)!).filter((r) => r.conflicts.length > 0);
    expect(outside.length).toBeGreaterThan(0);
  });
});

describe('createGanttCore: events and handlers', () => {
  it('FR-EVT-2: a handler swapped with setOptions is called instead, in its place, without a new snapshot', () => {
    const calls: string[] = [];
    const gantt = chart({ onTaskClick: (record) => calls.push(`first ${String(record.id)}`) });
    gantt.on('taskClick', (record) => calls.push(`listener ${String(record.id)}`));
    const snapshot = gantt.getSnapshot();
    const click = (): void => {
      const at = point(gantt, 'design');
      gantt.send(pointer('down', at));
      gantt.send(pointer('up', at));
    };
    click();
    gantt.setOptions({ onTaskClick: (record) => calls.push(`second ${String(record.id)}`) });
    expect(gantt.getSnapshot()).not.toBe(snapshot); // the click moved the hover
    const settled = gantt.getSnapshot();
    gantt.setOptions({ onTaskClick: (record) => calls.push(`third ${String(record.id)}`) });
    expect(gantt.getSnapshot()).toBe(settled);
    click();
    gantt.setOptions({ onTaskClick: undefined });
    click();
    expect(calls).toEqual([
      'first design',
      'listener design',
      'third design',
      'listener design',
      'listener design',
    ]);
  });

  it('FR-EVT-3: on() returns an unsubscribe; handlers get the public arguments', () => {
    const gantt = chart();
    const calls: unknown[] = [];
    const off = gantt.on('taskDatesChange', (record, dates) => calls.push([record.id, dates.end]));
    drag(gantt, 'design', DAY_PX);
    off();
    off();
    drag(gantt, 'design', DAY_PX);
    expect(calls).toEqual([
      ['design', date('2026-03-07')],
      ['build', date('2026-03-14')],
    ]);
  });

  it('FR-LINK-9: Link.editable only hides the UI action, removeLink still deletes the link', async () => {
    const gantt = chart({
      links: [{ id: 'pinned', source: 'design', target: 'build', editable: false }],
    });
    expect(gantt.getLink('pinned')?.editable).toBe(false);
    expect(await gantt.removeLink('pinned')).toMatchObject({ status: 'deleted', id: 'pinned' });
    expect(gantt.getLink('pinned')).toBeUndefined();
  });

  it('FR-EVT-1: maps link, range, scroll, selection and click payloads to the public forms', async () => {
    const gantt = chart();
    const events = log(gantt, ['linkCreate', 'linkDelete', 'rangeChange', 'scroll', 'linkClick']);
    expect(await gantt.addLink({ source: 'build', target: 'phase', type: 'SS' })).toMatchObject({
      status: 'created',
      id: 'build:SS:phase',
    });
    expect(await gantt.removeLink('design-build')).toMatchObject({ status: 'deleted' });
    gantt.send({
      ...pointer('down', { x: 10, y: 10 }),
      target: { kind: 'link', id: 'build:SS:phase' },
    });
    gantt.send({
      ...pointer('up', { x: 10, y: 10 }),
      target: { kind: 'link', id: 'build:SS:phase' },
    });
    gantt.scroll({ left: 120, top: 30 });
    const { timeline } = gantt.getSnapshot();
    expect(events).toEqual([
      ['linkCreate', { source: 'build', target: 'phase', type: 'SS' }, 'build:SS:phase'],
      ['linkDelete', expect.objectContaining({ id: 'design-build', source: 'design' })],
      ['linkClick', expect.objectContaining({ id: 'build:SS:phase' }), { type: 'up' }],
      ['scroll', { x: 120, y: 30, date: toDate(timeline.scale.xToDate(120)) }],
    ]);
    expect(gantt.getSnapshot().selection).toEqual({ tasks: [], link: 'build:SS:phase' });
  });

  it('FR-SEL-1, FR-SEL-2: selection of tasks and of a link, pruned when the data loses them', () => {
    const gantt = chart();
    const events = log(gantt, ['selectionChange']);
    gantt.select(['build', 'ghost', 'design', 'build']);
    gantt.select(['build', 'design']);
    gantt.selectLink('design-build');
    gantt.selectLink('ghost');
    gantt.selectLink('design-build');
    // A click on a bar clears the link selection.
    const at = point(gantt, 'phase');
    gantt.send(pointer('down', at));
    gantt.send(pointer('up', at));
    gantt.selectLink('design-build');
    gantt.setTasks(TASKS.filter((task) => task.id !== 'build'));
    gantt.clearSelection();
    expect(events).toEqual([
      ['selectionChange', ['build', 'design'], undefined],
      ['selectionChange', ['build', 'design'], 'design-build'],
      ['selectionChange', ['build', 'design'], undefined],
      ['selectionChange', ['build', 'design'], 'design-build'],
      ['selectionChange', ['build', 'design'], undefined],
      ['selectionChange', ['build', 'design'], 'design-build'],
      // `build` is gone, and with it the link to it.
      ['selectionChange', ['design'], undefined],
      ['selectionChange', [], undefined],
    ]);
  });

  it('FR-EDIT-3: clicks, double clicks and hover reach the public events with records', () => {
    const gantt = chart();
    const events = log(gantt, ['taskClick', 'taskDoubleClick', 'taskHoverChange']);
    const at = point(gantt, 'build');
    gantt.send(pointer('move', at));
    gantt.send(pointer('down', at));
    gantt.send(pointer('up', at));
    // The second click within the double-click time.
    gantt.send(pointer('down', at));
    gantt.send(pointer('up', at));
    gantt.send(pointer('move', { x: at.x, y: 1000 }));
    const build = gantt.getTask('build');
    expect(events).toEqual([
      ['taskHoverChange', build, { type: 'move' }],
      ['taskClick', build, { type: 'up' }],
      ['taskClick', build, { type: 'up' }],
      ['taskDoubleClick', build, { type: 'up' }],
      ['taskHoverChange', null, { type: 'move' }],
    ]);
  });

  it('FR-EDIT-7: a refused gesture is reported as editRefused', () => {
    const gantt = chart({ editing: { move: false } });
    const events = log(gantt, ['editRefused', 'tasksChange']);
    drag(gantt, 'design', DAY_PX);
    expect(events).toEqual([
      [
        'editRefused',
        { gesture: 'move', id: 'design', target: undefined, reason: 'permission', at: 'start' },
      ],
    ]);
    gantt.setOptions({ editing: true });
    drag(gantt, 'design', DAY_PX);
    expect(events.map(([name]) => name)).toEqual(['editRefused', 'tasksChange']);
  });

  it('FR-DATA-4: reports data and option issues once per change, with defaults applied', () => {
    const issues: unknown[] = [];
    const gantt = createGanttCore({
      tasks: [...TASKS, { id: 'bad', name: 'Bad', start: '2026-03-02', end: '2026-02-01' }],
      locale: 'not a locale!',
      layout: { rowHeight: -1 },
      timeline: { padding: 'soon' },
      interaction: { dragThreshold: Number.NaN },
      history: { limit: -2 },
      onIssues: ({ source, issues: list }) =>
        issues.push([source, list.map((found) => found.path ?? found.code)]),
    });
    expect(issues).toEqual([
      ['data', ['tasks[5].end']],
      [
        'options',
        [
          'locale',
          'interaction.dragThreshold',
          'history.limit',
          'layout.rowHeight',
          'timeline.padding',
        ],
      ],
    ]);
    expect(gantt.getIssues().options).toHaveLength(5);
    expect(gantt.getSnapshot().layoutOptions.rowHeight).toBe(48);
    expect(gantt.getSnapshot().header.locale).toBe('en');
    expect(gantt.getTask('bad')?.issues.map((found) => found.code)).toEqual(['end-before-start']);
    // The same options again: nothing new to report.
    gantt.setOptions({ layout: { rowHeight: -1 } });
    expect(issues).toHaveLength(2);
    expect(gantt.setOptions({ layout: { rowHeight: 40 }, locale: 'uk' })).toHaveLength(3);
    expect(issues).toHaveLength(3);
    expect(createGanttCore(null as unknown as GanttCoreOptions).getIssues().options).toEqual([
      expect.objectContaining({ code: 'invalid-option', value: null }),
    ]);
  });

  it('FR-DATA-4: option issues carry the whole option path, also in their message', () => {
    const gantt = createGanttCore({
      tasks: TASKS,
      viewMode: 'fortnight',
      viewModes: { sprint: { pxPerDay: 10 } },
      layout: { rowHeight: -1 },
      timeline: { padding: 'soon', infinite: { extendBy: '0d' } },
      scroll: { initial: 'later' },
    });
    const { options } = gantt.getIssues();
    expect(options.map((found) => [found.code, found.path])).toEqual([
      ['invalid-view-mode', 'viewModes.sprint.unit'],
      ['invalid-view-mode', 'viewModes.sprint.headers'],
      ['unknown-view-mode', 'viewMode'],
      ['invalid-layout-option', 'layout.rowHeight'],
      ['invalid-timeline-option', 'timeline.padding'],
      ['invalid-timeline-option', 'timeline.infinite.extendBy'],
      ['invalid-scroll-option', 'scroll.initial'],
    ]);
    // The production message is `'<path>: <code>'`; the development one starts the same way.
    for (const found of options) expect(found.message).toMatch(`${found.path ?? ''}: `);
    expect(gantt.getIssues().options).toBe(options);
  });

  it('FR-SCALE-3: an invalid override of a preset keeps the preset and reports its cause', () => {
    const gantt = createGanttCore({ tasks: TASKS, viewModes: { day: { pxPerDay: -1 } } });
    expect(gantt.getSnapshot().viewMode).toMatchObject({ id: 'day', pxPerDay: DAY_PX });
    expect(gantt.getIssues().options).toEqual([
      expect.objectContaining({
        code: 'invalid-view-mode',
        path: 'viewModes.day.pxPerDay',
        value: -1,
      }),
    ]);
  });

  it('FR-DATA-4: the option issues keep their identity while their content is the same', () => {
    const gantt = chart({ locale: 'not a locale!' });
    const options = gantt.getIssues().options;
    expect(options).toHaveLength(1);
    gantt.setTasks([...TASKS]);
    expect(gantt.getIssues().options).toBe(options);
    expect(gantt.setOptions({ locale: 'not a locale!' })).toBe(options);
    expect(gantt.setOptions({ locale: 'uk' })).toEqual([]);
  });

  it('FR-I18N-1: the locale labels the header cells; setOptions({ locale }) relabels them, scale and adapter kept', () => {
    const gantt = chart();
    const months = (): string[] => {
      const { viewMode, header, timeline } = gantt.getSnapshot();
      const [row] = headerRows(viewMode, timeline.range, header);
      return [...(row ?? [])].slice(0, 2).map((cell) => cell.label);
    };
    const before = gantt.getSnapshot().header;
    expect(before.locale).toBe('en');
    expect(months()).toEqual(['February 2026', 'March 2026']);

    gantt.setOptions({ locale: 'uk' });
    const after = gantt.getSnapshot().header;

    expect(after.locale).toBe('uk');
    expect(months()).toEqual(['лютий 2026 р.', 'березень 2026 р.']);
    expect(after).not.toBe(before);
    expect(after.scale).toBe(before.scale);
    expect(after.adapter).toBe(before.adapter);

    // The same locale again is no change, and an invalid one falls back to the default, `en`.
    gantt.setOptions({ locale: 'uk' });
    expect(gantt.getSnapshot().header).toBe(after);
    gantt.setOptions({ locale: 'not a locale!' });
    expect(gantt.getSnapshot().header.locale).toBe('en');
    expect(months()).toEqual(['February 2026', 'March 2026']);
  });

  it('FR-DATA-4: issues are reported again only when more than their message changed', () => {
    const reported: string[] = [];
    const gantt = createGanttCore({
      tasks: [{ id: 'odd', name: 'Odd', start: '2026-03-02T10:30', end: '2026-03-02T12:00' }],
      scheduling: { granularity: '1h' },
      onIssues: ({ source }) => reported.push(source),
    });
    expect(reported).toEqual(['data']);
    const [found] = gantt.getIssues().data;
    // At '2h' the start is aligned to the same 10:00: only the development text changes, and the
    // production build, whose message is `'<path>: <code>'`, would see no change at all.
    gantt.setOptions({ scheduling: { granularity: '2h' } });
    const [next] = gantt.getIssues().data;
    expect(next?.message).not.toBe(found?.message);
    expect({ ...next, message: '' }).toEqual({ ...found, message: '' });
    expect(reported).toEqual(['data']);
    gantt.setOptions({ scheduling: { granularity: '30min' } });
    expect(gantt.getIssues().data).toEqual([]);
    expect(reported).toEqual(['data', 'data']);
  });

  it('FR-DATA-4: the key of an issue list leaves the message out', () => {
    const found = {
      code: 'misaligned',
      severity: 'warning',
      message: 'tasks[0].start: one text',
      path: 'tasks[0].start',
      taskId: 'a',
      value: '2026-03-02T10:30',
      suggested: '2026-03-02T10:00',
    } as const;
    const key = keyOfIssues([found]);
    expect(keyOfIssues([{ ...found, message: 'tasks[0].start: misaligned' }])).toBe(key);
    const changes: readonly Readonly<Record<string, unknown>>[] = [
      { code: 'too-long' },
      { severity: 'error' },
      { path: 'tasks[1].start' },
      { taskId: 'b' },
      { linkId: 'l' },
      { value: '2026-03-02T11:30' },
      { suggested: '2026-03-02T11:00' },
      { taskIds: ['a'] },
    ];
    for (const change of changes) {
      expect(keyOfIssues([{ ...found, ...change }])).not.toBe(key);
    }
  });

  it('FR-EVT-1: a throwing listener reaches the error channel, or the caller without one', () => {
    const gantt = chart();
    const errors: unknown[] = [];
    const off = gantt.on('error', ({ error }) => errors.push(error));
    gantt.on('selectionChange', () => {
      throw new Error('boom');
    });
    gantt.select(['design']);
    expect(errors).toEqual([new Error('boom')]);
    off();
    expect(() => gantt.select(['build'])).toThrow('boom');
    expect(gantt.getSnapshot().selection.tasks).toEqual(['build']);
  });
});

describe('createGanttCore: edits through send', () => {
  it('FR-TX-2: an async before-hook vetoes a drag; the chart is busy meanwhile', async () => {
    const answer = deferred<boolean>();
    const gantt = chart({ onBeforeTaskChange: () => answer.promise });
    const events = log(gantt, ['tasksChange']);
    drag(gantt, 'design', DAY_PX);
    expect(gantt.getSnapshot().busy).toBe(true);
    // The change awaiting the answer is shown as the draft; a new gesture is refused.
    expect(gantt.getSnapshot().state.draft?.changeSet.changes[0]?.id).toBe('design');
    const refused = log(gantt, ['editRefused']);
    drag(gantt, 'build', DAY_PX);
    expect(refused[0]?.[1]).toMatchObject({ reason: 'busy', at: 'start' });
    answer.resolve(false);
    await settle();
    expect(gantt.getSnapshot().busy).toBe(false);
    expect(gantt.getSnapshot().state.draft).toBeUndefined();
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-02'));
    expect(events).toEqual([]);
  });

  it('FR-EDIT-7, FR-TX-3: controlled data refuses a gesture until the owner applied the last commit', () => {
    const gantt = chart({ dataMode: 'controlled' });
    const events = log(gantt, ['tasksChange', 'editRefused']);
    drag(gantt, 'design', DAY_PX);
    const { draft } = gantt.getSnapshot().state;
    expect(draft?.committed).toBe(true);
    expect(gantt.getSnapshot().busy).toBe(true);
    // A second drag would start from the owner's old data while the bar shows the commit: the
    // owner would get a change set that undoes the first one.
    drag(gantt, 'design', DAY_PX);
    expect(events).toEqual([
      ['tasksChange', draft?.changeSet],
      [
        'editRefused',
        { gesture: 'move', id: 'design', target: undefined, reason: 'busy', at: 'start' },
      ],
    ]);
    expect(gantt.getSnapshot().state.draft).toBe(draft);
    // The owner answers (here it rejects the change by passing its tasks back as they were).
    gantt.setTasks(TASKS);
    expect(gantt.getSnapshot().busy).toBe(false);
    drag(gantt, 'design', DAY_PX);
    expect(events.map(([name]) => name)).toEqual(['tasksChange', 'editRefused', 'tasksChange']);
  });

  it('FR-EDIT-6, FR-TL-5: a bar dragged past the range of the infinite timeline grows it', () => {
    const gantt = chart({ timeline: { infinite: { threshold: 0, extendBy: '1w' } } });
    const events = log(gantt, ['rangeChange']);
    const before = gantt.getSnapshot().timeline;
    const from = point(gantt, 'design');
    gantt.send(pointer('down', from));
    // 80 days back: past the room the initial scroll left before the data start.
    gantt.send(pointer('move', { x: from.x - 80 * DAY_PX, y: from.y }));
    const after = gantt.getSnapshot().timeline;
    expect(after.range.start).toBeLessThan(before.range.start);
    expect(events).toEqual([['rangeChange', expect.objectContaining({ reason: 'drag' })]]);
    // The picture stays: the date at the left edge is the same.
    expect(after.scale.xToDate(after.scrollLeft)).toBe(before.scale.xToDate(before.scrollLeft));
    expect(gantt.getSnapshot().scrollRequest).toMatchObject({
      reason: 'drag',
      left: after.scrollLeft,
      behavior: 'instant',
    });
    gantt.send(pointer('up', { x: from.x - 80 * DAY_PX, y: from.y }));
    expect(gantt.getTask('design')?.start?.getTime()).toBeLessThan(date('2026-01-01').getTime());
  });

  it('FR-LINK-4: a link drawn by drag is created through the hooks', async () => {
    const gantt = chart({ onBeforeLinkCreate: ({ id }) => id !== 'phase:FS:design' });
    const events = log(gantt, ['linkCreate', 'tasksChange']);
    const from = point(gantt, 'build', 'link-end');
    const to = point(gantt, 'phase');
    gantt.send(pointer('down', from));
    const effects = gantt.send(pointer('move', to));
    expect(effects.map((effect) => effect.type)).toContain('link-preview');
    expect(gantt.getSnapshot().feedback.link?.link).toEqual({
      source: 'build',
      target: 'phase',
      type: 'FS',
    });
    gantt.send(pointer('up', to));
    await settle();
    expect(events).toEqual([
      ['linkCreate', { source: 'build', target: 'phase', type: 'FS' }, 'build:FS:phase'],
    ]);
    expect(gantt.getLink('build:FS:phase')).toBeDefined();
  });

  describe('FR-SCH-7: the working-day scenarios by drag, with a before-hook prompt', () => {
    it.each(workingDayScenarios.map((s) => [s.id, s] as const))('%s', async (_id, scenario) => {
      const { task, calendar, options } = scenario.given;
      const { kind, to, onConflict } = scenario.action;
      const gantt: GanttCore = createGanttCore({
        tasks: [task],
        calendar,
        scheduling: {
          durationMode: options?.scheduling?.durationMode,
          skipNonWorkingDays: options?.scheduling?.skipNonWorkingDays,
        },
        scroll: { initial: 'start', autoScroll: false },
        timeline: { range: { start: '2026-04-01', end: '2026-05-01' } },
        // "The bar lands on a non-working day: move it to the next working day, or keep it?"
        onBeforeTaskChange: ({ changeSet, conflicts }) => {
          if (onConflict === undefined || conflicts.length === 0) return true;
          if (onConflict === 'ignore') return true;
          const { derived } = gantt.getSnapshot().state;
          const after = changeSet.changes[0]!.after;
          return propagate(
            { kind: 'resize-start', id: task.id, start: after.start },
            { ...derived, options: { skipNonWorkingDays: { resize: true } } },
          );
        },
      });
      gantt.setViewport({ width: 2000, height: 400 });
      const record = gantt.getTask(task.id)!;
      const target = date(to).getTime() + (kind === 'resize-end' ? 86_400_000 : 0);
      const edge = kind === 'resize-end' ? record.endExclusive! : record.start!;
      const days = Math.round((target - edge.getTime()) / 86_400_000);
      drag(gantt, task.id, days * DAY_PX, kind === 'move' ? 'body' : kind);
      await settle();
      const after = gantt.getTask(task.id)!;
      expect(after.start).toEqual(date(scenario.expected.start));
      expect(after.end).toEqual(date(scenario.expected.end));
      expect(after.duration?.workingDays).toBe(scenario.expected.workingDays);
      expect(after.duration?.calendarDays).toBe(scenario.expected.calendarDays);
    });
  });
});

describe('createGanttCore: a before-hook that fails during a gesture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** What the core hands to the host's unhandled-rejection channel, kept from the test runner. */
  function captureReports(): unknown[] {
    const reports: unknown[] = [];
    vi.spyOn(Promise, 'reject').mockImplementation((reason) => {
      reports.push(reason);
      return new Promise<never>(() => undefined);
    });
    return reports;
  }

  const veto = new Error('veto');
  const throws = (): never => {
    throw veto;
  };

  it('FR-TX-2, FR-EVT-1: a hook that throws cancels a drag and, with no error listener, is reported to the unhandled-rejection channel', async () => {
    const reports = captureReports();
    const gantt = chart({ onBeforeTaskChange: throws });
    drag(gantt, 'design', DAY_PX);
    await settle();
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-02'));
    expect(gantt.getSnapshot().busy).toBe(false);
    expect(reports).toEqual([veto]);
  });

  it('FR-TX-2, FR-EVT-1: a hook that rejects is reported the same way', async () => {
    const reports = captureReports();
    const gantt = chart({
      onBeforeTaskChange: async () => {
        await Promise.resolve();
        throw veto;
      },
    });
    drag(gantt, 'design', DAY_PX);
    await settle();
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-02'));
    expect(reports).toEqual([veto]);
  });

  it('FR-TX-2, FR-EVT-1: an answer that is not valid is reported too, as the TypeError it is', async () => {
    const reports = captureReports();
    const gantt = chart({ onBeforeTaskChange: (() => 'nope') as never });
    drag(gantt, 'design', DAY_PX);
    await settle();
    expect(reports).toEqual([expect.any(TypeError)]);
  });

  it('FR-EVT-1: an error listener hears it, from on() or from onError, and then nothing is reported', async () => {
    const reports = captureReports();
    const gantt = chart({ onBeforeTaskChange: throws });
    const heard: unknown[] = [];
    gantt.on('error', (payload) => heard.push(payload));
    const handled = vi.fn();
    gantt.setOptions({ onError: handled });
    drag(gantt, 'design', DAY_PX);
    await settle();
    const payload = { error: veto, source: 'hook', name: 'beforeTaskChange' };
    expect(heard).toEqual([payload]);
    expect(handled).toHaveBeenCalledWith(payload);
    expect(reports).toEqual([]);

    const optionOnly = chart({ onBeforeTaskChange: throws, onError: handled });
    drag(optionOnly, 'design', DAY_PX);
    await settle();
    expect(handled).toHaveBeenCalledTimes(2);
    expect(reports).toEqual([]);
  });

  it('FR-LINK-6, FR-EVT-1: a hook that throws on a drawn link is reported when nobody listens to error', async () => {
    const reports = captureReports();
    const gantt = chart({ onBeforeLinkCreate: throws });
    const from = point(gantt, 'build', 'link-end');
    const to = point(gantt, 'phase');
    gantt.send(pointer('down', from));
    gantt.send(pointer('move', to));
    gantt.send(pointer('up', to));
    await settle();
    expect(gantt.getLink('build:FS:phase')).toBeUndefined();
    expect(gantt.getSnapshot().busy).toBe(false);
    expect(reports).toEqual([veto]);
  });

  it('FR-TX-2, FR-LINK-6: updateTask and addLink return the error and report nothing', async () => {
    const reports = captureReports();
    const gantt = chart({ onBeforeTaskChange: throws, onBeforeLinkCreate: throws });
    expect(await gantt.updateTask('design', { start: '2026-03-03' })).toMatchObject({
      status: 'cancelled',
      reason: 'error',
      error: veto,
    });
    expect(await gantt.addLink({ source: 'build', target: 'phase' })).toMatchObject({
      status: 'cancelled',
      reason: 'error',
      error: veto,
    });
    await settle();
    expect(reports).toEqual([]);
  });
});

describe('createGanttCore: updateTask, links, sessions and history', () => {
  it('FR-TX-1: updateTask moves, resizes or reschedules with propagation and reason api', async () => {
    const reasons: unknown[] = [];
    const gantt = chart({
      onBeforeTaskChange: ({ reason }) => {
        reasons.push(reason);
      },
    });
    const events = log(gantt, ['tasksChange']);
    expect(await gantt.updateTask('design', { start: '2026-03-03' })).toMatchObject({
      status: 'committed',
    });
    expect(gantt.getTask('design')).toMatchObject({
      start: date('2026-03-03'),
      end: date('2026-03-07'),
    });
    expect(gantt.getTask('build')?.start).toEqual(date('2026-03-10'));
    await gantt.updateTask('design', { end: '2026-03-10' });
    expect(gantt.getTask('design')).toMatchObject({
      start: date('2026-03-03'),
      end: date('2026-03-10'),
    });
    await gantt.updateTask('design', { start: '2026-03-02', end: '2026-03-04', progress: 25 });
    expect(gantt.getTask('design')).toMatchObject({
      start: date('2026-03-02'),
      end: date('2026-03-04'),
      progress: 25,
    });
    await gantt.updateTask('build', { progress: 10 });
    expect(gantt.getTask('build')?.progress).toBe(10);
    expect(reasons).toEqual(['api', 'api', 'api', 'api']);
    expect(events.map(([, changeSet]) => (changeSet as { reason: string }).reason)).toEqual([
      'api',
      'api',
      'api',
      'api',
    ]);
  });

  it('FR-SNAP-13: updateTask aligns misaligned values with an issue, or rejects them', async () => {
    const gantt = chart();
    const issues = log(gantt, ['issues']);
    const result = await gantt.updateTask('design', { start: '2026-03-03T10:00' });
    expect(result).toMatchObject({
      status: 'committed',
      issues: [
        expect.objectContaining({ code: 'misaligned', path: 'start', suggested: '2026-03-03' }),
      ],
    });
    expect(issues).toEqual([['issues', expect.objectContaining({ source: 'change-set' })]]);
    expect(await gantt.updateTask('ghost', { start: '2026-03-03' })).toEqual({
      status: 'rejected',
      reason: 'unknown-task',
      issues: [],
    });
    expect(await gantt.updateTask('design', { start: 'soon', progress: Number.NaN })).toMatchObject(
      {
        status: 'rejected',
        reason: 'invalid-value',
        issues: [
          expect.objectContaining({ path: 'start' }),
          expect.objectContaining({ code: 'invalid-change', path: 'progress' }),
        ],
      },
    );
    gantt.setOptions({ scheduling: { alignInput: 'reject' } });
    expect(await gantt.updateTask('design', { end: '2026-03-09T10:00' })).toMatchObject({
      status: 'rejected',
      issues: [expect.objectContaining({ code: 'misaligned', severity: 'error' })],
    });
  });

  it('FR-TIME-8: updateTask reads a date-only end like the input, also on a task with a time', async () => {
    const gantt = createGanttCore({
      tasks: [
        { id: 'mixed', name: 'Mixed', start: '2026-03-02T10:00', end: '2026-03-05' },
        {
          id: 'exact',
          name: 'Exact',
          start: '2026-03-02T10:00',
          end: '2026-03-05',
          precision: 'time',
        },
      ],
      scheduling: { granularity: '1h' },
    });
    // A date-only end is the inclusive last day, though the start has a time.
    expect(gantt.getTask('mixed')).toMatchObject({
      precision: 'time',
      endExclusive: date('2026-03-06'),
    });
    expect(await gantt.updateTask('mixed', { end: '2026-03-05' })).toMatchObject({
      status: 'unchanged',
    });
    expect(gantt.getTask('mixed')?.endExclusive).toEqual(date('2026-03-06'));
    await gantt.updateTask('mixed', { end: '2026-03-06' });
    expect(gantt.getTask('mixed')?.endExclusive).toEqual(date('2026-03-07'));
    // `precision: 'time'` makes every value a moment: a date-only end is its midnight.
    expect(gantt.getTask('exact')?.endExclusive).toEqual(date('2026-03-05'));
    await gantt.updateTask('exact', { end: '2026-03-06' });
    expect(gantt.getTask('exact')?.endExclusive).toEqual(date('2026-03-06'));
  });

  it('FR-TX-1, FR-DATA-4: updateTask rejects an end that is not after the start', async () => {
    const gantt = chart();
    const events = log(gantt, ['issues', 'tasksChange']);
    const design = gantt.getTask('design');
    const backwards = (taskId: string, value: string): unknown =>
      expect.objectContaining({
        code: 'end-before-start',
        severity: 'error',
        path: 'end',
        taskId,
        value,
      });
    expect(await gantt.updateTask('design', { start: '2026-03-10', end: '2026-03-05' })).toEqual({
      status: 'rejected',
      reason: 'invalid-value',
      issues: [backwards('design', '2026-03-05')],
    });
    // `end` alone is compared with the current start, 2026-03-02.
    expect(await gantt.updateTask('design', { end: '2026-03-01' })).toEqual({
      status: 'rejected',
      reason: 'invalid-value',
      issues: [backwards('design', '2026-03-01')],
    });
    expect(gantt.getTask('design')).toBe(design);
    expect(events.map(([name, payload]) => [name, (payload as { source: string }).source])).toEqual(
      [
        ['issues', 'change-set'],
        ['issues', 'change-set'],
      ],
    );
    // The last day of a one-day task is its first day.
    expect(await gantt.updateTask('design', { end: '2026-03-02' })).toMatchObject({
      status: 'committed',
    });
    expect(gantt.getTask('design')).toMatchObject({
      start: date('2026-03-02'),
      end: date('2026-03-02'),
    });
    // A moment: the end has to come after the start, except for a milestone.
    const timed = createGanttCore({
      tasks: [
        { id: 'call', name: 'Call', start: '2026-03-02T10:00', end: '2026-03-02T11:00' },
        { id: 'gate', name: 'Gate', type: 'milestone', start: '2026-03-02T10:00' },
      ],
      scheduling: { granularity: '1h' },
    });
    expect(
      await timed.updateTask('call', { start: '2026-03-02T12:00', end: '2026-03-02T12:00' }),
    ).toMatchObject({ status: 'rejected', issues: [backwards('call', '2026-03-02T12:00')] });
    expect(
      await timed.updateTask('gate', { start: '2026-03-02T12:00', end: '2026-03-02T12:00' }),
    ).toMatchObject({ status: 'committed' });
  });

  it('FR-TX-1: updateTask reports a locked task alike for dates and progress', async () => {
    const gantt = createGanttCore({
      tasks: [{ id: 'fixed', name: 'Fixed', start: '2026-03-02', end: '2026-03-06', locked: true }],
    });
    const events = log(gantt, ['issues', 'tasksChange']);
    const locked: unknown = expect.objectContaining({
      code: 'locked-task',
      severity: 'error',
      taskId: 'fixed',
    });
    for (const update of [
      { start: '2026-03-03' },
      { end: '2026-03-09' },
      { start: '2026-03-03', end: '2026-03-09' },
      { progress: 40 },
    ]) {
      expect(await gantt.updateTask('fixed', update)).toEqual({
        status: 'unchanged',
        issues: [locked],
      });
    }
    expect(events.map(([name]) => name)).toEqual(['issues', 'issues', 'issues', 'issues']);
  });

  it('FR-TX-1: a busy chart refuses updateTask without reporting its corrections', async () => {
    const answer = deferred<boolean>();
    const gantt = chart({ onBeforeTaskChange: () => answer.promise });
    const events = log(gantt, ['issues', 'tasksChange']);
    drag(gantt, 'design', DAY_PX);
    expect(await gantt.updateTask('build', { start: '2026-03-10T10:00' })).toEqual({
      status: 'busy',
    });
    expect(events).toEqual([]);
    answer.resolve(false);
    await settle();
    // Controlled data: busy until the owner applied the last commit.
    const owned = chart({ dataMode: 'controlled' });
    const reported = log(owned, ['issues']);
    expect(await owned.updateTask('design', { start: '2026-03-03' })).toMatchObject({
      status: 'committed',
    });
    expect(await owned.updateTask('build', { start: '2026-03-10T10:00' })).toEqual({
      status: 'busy',
    });
    expect(reported).toEqual([]);
  });

  it('FR-TX-4, FR-TX-5: sessions and history; undo and rollback cancel a gesture in progress', () => {
    const gantt = chart({ history: true });
    const events = log(gantt, ['historyChange', 'dirtyChange', 'editRollback']);
    expect(gantt.edit.begin()).toEqual({ status: 'begun' });
    expect(gantt.edit.isOpen).toBe(true);
    drag(gantt, 'design', DAY_PX);
    expect(gantt.edit.isDirty).toBe(true);
    expect(gantt.canUndo).toBe(true);
    // A gesture in progress is cancelled before undoing.
    const from = point(gantt, 'build');
    gantt.send(pointer('down', from));
    gantt.send(pointer('move', { x: from.x + DAY_PX, y: from.y }));
    expect(gantt.getSnapshot().feedback.phase).toBe('dragging');
    expect(gantt.undo()).toMatchObject({ status: 'undone' });
    expect(gantt.getSnapshot().feedback.phase).toBe('idle');
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-02'));
    expect(gantt.canRedo).toBe(true);
    expect(gantt.redo()).toMatchObject({ status: 'redone' });
    expect(gantt.edit.getChanges()?.changes.map((change) => change.id)).toEqual([
      'design',
      'build',
    ]);
    gantt.send(pointer('down', from));
    gantt.send(pointer('move', { x: from.x + DAY_PX, y: from.y }));
    expect(gantt.edit.rollback()).toMatchObject({ status: 'rolled-back' });
    expect(gantt.getSnapshot().feedback.phase).toBe('idle');
    expect(gantt.getSnapshot().state.tasks).toBe(TASKS);
    expect(gantt.edit.isOpen).toBe(false);
    // Each action: the history first, then the session (both observe the controller).
    expect(events.map(([name]) => name)).toEqual([
      ...['historyChange', 'dirtyChange'], // the drag
      ...['historyChange', 'dirtyChange'], // undo
      ...['historyChange', 'dirtyChange'], // redo
      ...['historyChange', 'dirtyChange', 'editRollback'], // rollback to the checkpoint
    ]);
    expect(gantt.edit.begin()).toEqual({ status: 'begun' });
    expect(gantt.edit.commit()).toMatchObject({ status: 'committed' });
  });

  it('FR-TX-5: the history follows the history option', () => {
    const gantt = chart();
    drag(gantt, 'design', DAY_PX);
    expect(gantt.canUndo).toBe(false);
    gantt.setOptions({ history: { limit: 1 } });
    drag(gantt, 'design', DAY_PX);
    drag(gantt, 'design', DAY_PX);
    expect(gantt.undo()).toMatchObject({ status: 'undone' });
    expect(gantt.undo()).toEqual({ status: 'empty' });
    gantt.setOptions({ history: false });
    expect(gantt.canRedo).toBe(false);
  });
});

describe('createGanttCore: lifecycle', () => {
  it('FR-API-4: two instances share nothing', () => {
    const a = chart();
    const b = chart({ viewMode: 'week' });
    const calls: string[] = [];
    a.on('tasksChange', () => calls.push('a'));
    b.on('tasksChange', () => calls.push('b'));
    drag(a, 'design', DAY_PX);
    expect(calls).toEqual(['a']);
    expect(b.getTask('design')?.start).toEqual(date('2026-03-02'));
    expect(a.getSnapshot().viewMode.id).toBe('day');
    expect(b.getSnapshot().viewMode.id).toBe('week');
    expect(a.getSnapshot().header.adapter).not.toBe(b.getSnapshot().header.adapter);
  });

  it('FR-API-4: destroy() leaves nothing subscribed and ignores a late hook answer', async () => {
    const answer = deferred<boolean>();
    const handler = vi.fn();
    const listener = vi.fn();
    const subscriber = vi.fn();
    const gantt = chart({ onTasksChange: handler, onBeforeTaskChange: () => answer.promise });
    gantt.on('tasksChange', listener);
    gantt.on('dirtyChange', listener);
    gantt.subscribe(subscriber);
    drag(gantt, 'design', DAY_PX);
    subscriber.mockClear();
    const last = gantt.getSnapshot();
    gantt.destroy();
    gantt.destroy();
    answer.resolve(true);
    await settle();
    gantt.setTasks([]);
    gantt.select(['design']);
    gantt.scroll({ left: 50, top: 0 });
    expect(gantt.send(pointer('down', { x: 0, y: 0 }))).toEqual([]);
    expect(gantt.setViewport({ width: 10, height: 10 })).toBeUndefined();
    expect(await gantt.updateTask('design', { start: '2026-03-03' })).toMatchObject({
      status: 'cancelled',
      reason: 'disposed',
    });
    expect(await gantt.addLink({ source: 'build', target: 'phase' })).toMatchObject({
      status: 'cancelled',
    });
    expect(gantt.undo()).toMatchObject({ status: 'cancelled' });
    gantt.on('tasksChange', listener)();
    gantt.subscribe(subscriber)();
    expect(handler).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
    expect(gantt.getSnapshot()).toBe(last);
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-02'));
  });

  it('is useSyncExternalStore-compatible: a new snapshot only when something changed', () => {
    const gantt = chart();
    const notified = vi.fn();
    gantt.subscribe(notified);
    const first = gantt.getSnapshot();
    expect(gantt.getSnapshot()).toBe(first);
    gantt.scroll({ left: 0, top: 0 });
    gantt.select([]);
    gantt.setOptions({ onTasksChange: () => undefined });
    expect(notified).not.toHaveBeenCalled();
    expect(gantt.getSnapshot()).toBe(first);
    gantt.scroll({ left: 80, top: 0 });
    const second = gantt.getSnapshot();
    expect(notified).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect(second.layout).toBe(first.layout);
    expect(second.state).toBe(first.state);
    expect(second.window).not.toBe(first.window);
  });
});

describe('createGanttCore: edge-case fixtures', () => {
  it.each(edgeCases.map((fixture) => [fixture.name, fixture] as const))(
    'FR-DATA-4: %s loads, mounts, draws and is edited without throwing',
    (_name, fixture) => {
      const reported: string[] = [];
      const scheduling = fixture.options?.scheduling;
      const gantt = createGanttCore({
        tasks: fixture.tasks,
        links: fixture.links,
        calendar: fixture.calendar,
        dates: fixture.options?.dates,
        scheduling: {
          granularity: scheduling?.granularity,
          alignInput: scheduling?.alignInput,
          durationMode: scheduling?.durationMode,
          defaultLinkType: scheduling?.defaultLinkType,
        },
        now: () => '2026-03-02',
        onIssues: ({ source, issues }) =>
          reported.push(...issues.map((i) => `${source}:${i.code}`)),
      });
      expect(gantt.setViewport({ width: 1200, height: 500 })).toBeDefined();
      const { state, layout } = gantt.getSnapshot();
      // Every issue of the data is reported once, at creation.
      expect(reported.filter((entry) => entry.startsWith('data:'))).toEqual(
        gantt.getIssues().data.map((found) => `data:${found.code}`),
      );
      for (const row of state.derived.rows) {
        const record = gantt.getTask(row.id)!;
        expect(record.rowIndex).toBe(row.index);
        expect(record.start === undefined).toBe(layout.getBarRect(row.id) === undefined);
      }
      const dated = state.derived.model.tasks.find(
        (task) => task.span !== undefined && task.type === 'task' && task.task.locked !== true,
      );
      if (dated !== undefined) {
        drag(gantt, dated.id, DAY_PX);
        expect(gantt.getSnapshot().state.draft).toBeUndefined();
      }
      gantt.destroy();
    },
  );
});

describe('createGanttCore: edge cases', () => {
  it('FR-DATA-4: a now() that throws or returns garbage is an option issue; the clock is used', () => {
    let calls = 0;
    const gantt = createGanttCore({
      tasks: TASKS,
      now: () => {
        calls++;
        if (calls === 1) throw new Error('no clock');
        return 'later';
      },
    });
    expect(gantt.getIssues().options).toEqual([
      expect.objectContaining({ path: 'now', value: new Error('no clock') }),
    ]);
    gantt.setViewport({ width: 800, height: 400 });
    expect(gantt.scrollToToday()).toBeDefined();
    expect(gantt.getIssues().options).toEqual([
      expect.objectContaining({ path: 'now', value: 'later' }),
    ]);
    gantt.setOptions({ now: () => '2026-03-04' });
    expect(gantt.scrollToToday({ behavior: 'smooth', align: 0.5 })).toMatchObject({
      behavior: 'smooth',
    });
    expect(gantt.getIssues().options).toEqual([]);
  });

  it('ignores unusable calls instead of throwing', async () => {
    const gantt = chart();
    expect(gantt.setViewport({ width: Number.NaN, height: 10 })).toBeUndefined();
    expect(gantt.setViewport(null as never)).toBeUndefined();
    expect(gantt.scroll(null as never)).toBeUndefined();
    expect(gantt.scroll({ left: Number.NaN, top: Number.NaN })).toBeUndefined();
    expect(gantt.send(null as never)).toEqual([]);
    expect(gantt.setViewMode(5 as never)).toBeUndefined();
    // Not an object: the shape check of the model says why, like for any malformed link.
    for (const link of [null, undefined, 'build', 5]) {
      expect(await gantt.addLink(link as never)).toEqual({
        status: 'rejected',
        reason: 'invalid',
        issues: [
          expect.objectContaining({ code: 'invalid-shape', path: 'link', severity: 'error' }),
        ],
      });
    }
    expect(await gantt.addLink(['build', 'phase'] as never)).toMatchObject({
      status: 'rejected',
      reason: 'invalid',
      issues: [{ code: 'invalid-shape' }, { code: 'invalid-shape' }],
    });
    expect(gantt.getSnapshot().busy).toBe(false);
    expect(await gantt.updateTask('design', null as never)).toMatchObject({
      status: 'rejected',
      reason: 'invalid-value',
    });
    gantt.select('design' as never);
    expect(gantt.getSnapshot().selection.tasks).toEqual([]);
    expect(gantt.on('tasksChange', 'nope' as never)).toBeTypeOf('function');
    expect(gantt.setOptions({ history: 5 as never, locale: (() => 'en') as never })).toEqual([
      expect.objectContaining({ path: 'history' }),
      expect.objectContaining({
        path: 'locale',
        message: 'locale: a function is not a BCP 47 locale',
      }),
    ]);
  });

  it('FR-SEL-1: a double click on a link and a click on an unknown link select nothing new', () => {
    const gantt = chart();
    const events = log(gantt, ['linkClick', 'selectionChange']);
    const on = (id: string, type: PointerInput['type']): PointerInput => ({
      ...pointer(type, { x: 5, y: 5 }),
      target: { kind: 'link', id },
    });
    gantt.send(on('design-build', 'down'));
    gantt.send(on('design-build', 'up'));
    gantt.send(on('design-build', 'down'));
    gantt.send(on('design-build', 'up'));
    gantt.send(on('ghost', 'down'));
    gantt.send(on('ghost', 'up'));
    expect(events.map(([name]) => name)).toEqual(['selectionChange', 'linkClick', 'linkClick']);
    expect(gantt.getSnapshot().selection.link).toBe('design-build');
  });

  it('draws the other bars from the model while one is dragged', () => {
    const gantt = chart();
    const build = gantt.getBarRect('build');
    const phase = gantt.getBarRect('phase')!;
    const from = point(gantt, 'phase');
    gantt.send(pointer('down', from));
    gantt.send(pointer('move', { x: from.x + DAY_PX, y: from.y }));
    expect(gantt.getBarRect('build')).toEqual(build);
    expect(gantt.getBarRect('phase')?.x).toBe(phase.x + DAY_PX);
    gantt.send({ type: 'cancel' });
    expect(gantt.getSnapshot().state.draft).toBeUndefined();
  });

  it('FR-SNAP-13: alignInput nearest rounds an update to the nearest day', async () => {
    // A timed end is an exact moment: 11:00 rounds to midnight, so the last day is the 5th.
    const gantt = chart({ scheduling: { alignInput: 'nearest' } });
    await gantt.updateTask('design', { start: '2026-03-03T13:00', end: '2026-03-06T11:00' });
    expect(gantt.getTask('design')).toMatchObject({
      start: date('2026-03-04'),
      end: date('2026-03-05'),
    });
  });

  it('FR-EVT-1: errors of listeners are never swallowed', async () => {
    const gantt = chart({ history: true });
    drag(gantt, 'design', DAY_PX);
    gantt.on('tasksChange', () => {
      throw new Error('listener');
    });
    // Inside an operation (undo applies the change, then its listener throws).
    expect(() => gantt.undo()).toThrow('listener');
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-02'));
    // A promise-returning call rejects.
    await expect(gantt.updateTask('design', { start: '2026-03-05' })).rejects.toThrow('listener');
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-05'));
    // Snapshot subscribers: all are called, then their errors are thrown together.
    const second = vi.fn();
    gantt.subscribe(() => {
      throw new Error('one');
    });
    gantt.subscribe(() => {
      throw new Error('two');
    });
    gantt.subscribe(second);
    expect(() => gantt.select(['design'])).toThrow('2 listeners threw');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a subscriber removed by another one during a notification is not called', () => {
    const gantt = chart();
    const late = vi.fn();
    let off = (): void => undefined;
    gantt.subscribe(() => off());
    off = gantt.subscribe(late);
    gantt.select(['design']);
    expect(late).not.toHaveBeenCalled();
  });

  it('FR-API-4: destroy() from a listener stops the remaining events', () => {
    const gantt = chart();
    const later = vi.fn();
    gantt.on('selectionChange', () => gantt.destroy());
    gantt.on('expandedChange', later);
    gantt.on('selectionChange', later);
    gantt.select(['design']);
    gantt.collapse('phase');
    expect(later).not.toHaveBeenCalled();
  });

  it('FR-TL-2: the infinite range keeps its extension when the data stays inside it', () => {
    const gantt = chart({ timeline: { infinite: true } });
    gantt.scroll({ left: 0, top: 0 });
    const { range } = gantt.getSnapshot().timeline;
    drag(gantt, 'design', DAY_PX);
    expect(gantt.getSnapshot().timeline.range).toBe(range);
    gantt.setOptions({ hierarchy: undefined, timeline: { infinite: false } });
    expect(gantt.getSnapshot().timeline.range.start).toBeGreaterThan(range.start);
  });
});

describe('createGanttCore: cross-module contracts', () => {
  it('FR-LINK-4, FR-EDIT-6: a vertical scroll under a still pointer moves the link preview target', () => {
    const gantt = chart();
    const from = point(gantt, 'build', 'link-end');
    // Over the phase bar, at an x where the child bar lies in the row below.
    const to = { x: point(gantt, 'child').x, y: point(gantt, 'phase').y };
    gantt.send(pointer('down', from));
    gantt.send(pointer('move', to));
    expect(gantt.getSnapshot().feedback.link?.target).toBe('phase');
    const row = gantt.getRowMetrics('phase')!;
    const left = gantt.getSnapshot().timeline.scrollLeft;
    gantt.scroll({ left, top: row.height });
    // The pointer stays at its viewport y: the row below is under it now.
    expect(gantt.getSnapshot().feedback.link?.target).toBe('child');
    expect(gantt.getSnapshot().feedback.link?.to.y).toBe(to.y + row.height);
    gantt.scroll({ left, top: 0 });
    expect(gantt.getSnapshot().feedback.link?.target).toBe('phase');
  });

  it('FR-LINK-4, FR-LINK-6: a link drawn where its default id is taken is created with a free id', async () => {
    const taken: Link = { id: 'build:FS:phase', source: 'design', target: 'phase', type: 'SS' };
    const gantt = chart({ links: [...LINKS, taken] });
    const events = log(gantt, ['linkCreate']);
    const to = point(gantt, 'phase');
    gantt.send(pointer('down', point(gantt, 'build', 'link-end')));
    gantt.send(pointer('move', to));
    gantt.send(pointer('up', to));
    await settle();
    const written = { source: 'build', target: 'phase', type: 'FS', id: 'build:FS:phase#2' };
    expect(events).toEqual([['linkCreate', written, 'build:FS:phase#2']]);
    expect(gantt.getLink('build:FS:phase#2')).toMatchObject({ source: 'build', target: 'phase' });
    expect(gantt.getLink('build:FS:phase')).toMatchObject({ source: 'design', type: 'SS' });
    expect(await gantt.addLink({ source: 'build', target: 'phase' })).toEqual({
      status: 'rejected',
      reason: 'duplicate',
    });
  });

  it('FR-SNAP-7, FR-TIME-8: onTaskDatesChange reads the end in the precision the change gives the task', async () => {
    const dates: unknown[] = [];
    const timed = (iso: string): DateTimeMs => parseDay(iso);
    const gantt = chart({
      dataMode: 'controlled',
      scheduling: { granularity: '1h' },
      // Turns the day task into a timed one, as a drag with `keepDayPrecision: false` does.
      onBeforeTaskChange: ({ changeSet }) => ({
        ...changeSet,
        changes: changeSet.changes.slice(0, 1).map((change) => ({
          ...change,
          before: { ...change.before, precision: 'day' as const },
          after: {
            ...change.after,
            endExclusive: timed('2026-03-07T12:00'),
            precision: 'time' as const,
          },
        })),
      }),
      onTaskDatesChange: (record, value) => dates.push([record.id, record.precision, value]),
    });
    await gantt.updateTask('design', { start: '2026-03-03' });
    // The owner has not applied it: the record is still the day task, the change is timed.
    // (Its `end` is the exclusive end of a timed task, not the inclusive last day.)
    expect(dates).toEqual([
      [
        'design',
        'day',
        {
          start: date('2026-03-03'),
          end: date('2026-03-07T12:00'),
          endExclusive: date('2026-03-07T12:00'),
        },
      ],
    ]);
  });

  it('FR-DATA-4: option issues of the model, the tree and the store carry their whole option path', () => {
    const gantt = createGanttCore({
      tasks: TASKS,
      viewMode: 'fortnight',
      scheduling: { granularity: '5h' },
      hierarchy: { childAnchor: 'XX' as never },
    });
    const { data, options } = gantt.getIssues();
    const paths = (list: readonly { code: string; path?: string }[]): unknown[] =>
      list.map((found) => [found.code, found.path]);
    // They stay in the list of their module, with the paths of `GanttOptions`.
    expect(paths(data)).toEqual([
      ['invalid-granularity', 'scheduling.granularity'],
      ['invalid-parent-anchor', 'hierarchy.childAnchor'],
    ]);
    expect(paths(options)).toEqual([['unknown-view-mode', 'viewMode']]);
    for (const found of [...data, ...options])
      expect(found.message).toMatch(`${found.path ?? ''}: `);
    // The store's issue is qualified at the source: the facade passes it on as it is.
    const { issues } = gantt.getSnapshot().state.derived;
    expect(options[0]).toBe(issues[0]);
  });

  it('FR-API-2, FR-DATA-7: setOptions with data and data options builds the model once', () => {
    const gantt = chart({ history: true });
    drag(gantt, 'design', DAY_PX);
    const events = log(gantt, ['historyChange', 'issues']);
    const { version } = gantt.getSnapshot().state.lastDataChange;
    const tasks = TASKS.map((task) => (task.id === 'build' ? { ...task, name: 'Build 2' } : task));
    gantt.setOptions({
      calendar: { weekends: [0] },
      scheduling: { granularity: '1h' },
      tasks,
      links: [],
    });
    const { state } = gantt.getSnapshot();
    expect(state.lastDataChange).toMatchObject({
      version: version + 1,
      links: { removed: ['design-build'] },
    });
    expect(state.lastDataChange.updated).toContain('build');
    expect(state.tasks).toBe(tasks);
    expect(state.settings.granularity.ms).toBe(3_600_000);
    expect(gantt.getTask('build')?.name).toBe('Build 2');
    // One owner change: the uncontrolled history is cleared once.
    expect(events).toEqual([['historyChange', { canUndo: false, canRedo: false }]]);
    gantt.setTasks(TASKS);
    expect(gantt.getSnapshot().state.lastDataChange.version).toBe(version + 2);
  });

  it('FR-SNAP-7, FR-SNAP-11: updateTask turns a day task timed only without keepDayPrecision', async () => {
    const free = chart({ scheduling: { granularity: '1h', keepDayPrecision: false } });
    expect(await free.updateTask('child', { start: '2026-03-16T10:00' })).toMatchObject({
      status: 'committed',
      issues: [],
      changeSet: {
        changes: [{ id: 'child', before: { precision: 'day' }, after: { precision: 'time' } }],
      },
    });
    expect(free.getTask('child')).toMatchObject({
      precision: 'time',
      start: date('2026-03-16T10:00'),
      end: date('2026-03-19T10:00'),
      endExclusive: date('2026-03-19T10:00'),
    });
    // Programmatic values are not snapped, but aligned to the granularity, with the suggestion
    // in the precision the task gets.
    expect(await free.updateTask('build', { start: '2026-03-10T10:30' })).toMatchObject({
      status: 'committed',
      issues: [
        expect.objectContaining({
          code: 'misaligned',
          path: 'start',
          suggested: '2026-03-10T10:00',
        }),
      ],
    });
    expect(free.getTask('build')).toMatchObject({
      precision: 'time',
      start: date('2026-03-10T10:00'),
    });

    // With `keepDayPrecision` (the default) a day task stays on whole days.
    const kept = chart({ scheduling: { granularity: '1h' } });
    expect(await kept.updateTask('child', { start: '2026-03-17T10:00' })).toMatchObject({
      status: 'committed',
      issues: [expect.objectContaining({ code: 'misaligned', suggested: '2026-03-17' })],
    });
    expect(kept.getTask('child')).toMatchObject({ precision: 'day', start: date('2026-03-17') });
  });
});

function parseDay(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(iso);
  return parsed.value.value;
}
