import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Task } from '../model';
import { parseDateInput, toDate } from '../time';
import { createGanttCore, type GanttCore, type GanttCoreOptions } from './index';
import type { OPTION_INVALIDATION } from './options';
import {
  checkOptions,
  eventOfHandler,
  mergeOptions,
  type OptionKey,
  qualifyIssues,
  targetsOf,
} from './options';

const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13', parentId: 'design' },
]);

function chart(options: Partial<GanttCoreOptions> = {}): GanttCore {
  const gantt = createGanttCore({
    tasks: TASKS,
    links: [{ source: 'design', target: 'build' }],
    now: () => '2026-03-04',
    ...options,
  });
  gantt.setViewport({ width: 800, height: 400 });
  return gantt;
}

/** What `setOptions` rebuilt: the parts of the snapshot that are new objects. */
function rebuilt(gantt: GanttCore, patch: Partial<GanttCoreOptions>): readonly string[] {
  const before = gantt.getSnapshot();
  gantt.setOptions(patch);
  const after = gantt.getSnapshot();
  const parts = {
    snapshot: [before, after],
    model: [before.state.derived.model, after.state.derived.model],
    hierarchy: [before.state.derived.hierarchy, after.state.derived.hierarchy],
    rows: [before.state.derived.rows, after.state.derived.rows],
    snap: [before.state.derived.snap, after.state.derived.snap],
    settings: [before.state.settings, after.state.settings],
    rowLayout: [before.layout.rows, after.layout.rows],
    layout: [before.layout, after.layout],
    timeline: [before.timeline, after.timeline],
    header: [before.header, after.header],
    editing: [before.editing, after.editing],
    handles: [before.handles, after.handles],
    now: [before.now, after.now],
  } as const;
  return Object.entries(parts)
    .filter(([, [a, b]]) => a !== b)
    .map(([name]) => name);
}

describe('setOptions: the invalidation matrix (FR-API-2)', () => {
  it('FR-API-2, FR-EVT-2: a handler or the history limit rebuilds nothing', () => {
    const gantt = chart({ history: true });
    expect(rebuilt(gantt, { onTasksChange: () => undefined })).toEqual([]);
    expect(
      rebuilt(gantt, { onTasksChange: () => undefined, onBeforeTaskChange: () => true }),
    ).toEqual([]);
    expect(rebuilt(gantt, { history: { limit: 3 } })).toEqual([]);
    expect(rebuilt(gantt, { scroll: { behavior: 'instant' } })).toEqual([]);
  });

  it('FR-API-2, FR-EDIT-7: `editing` and the handle sizes rebuild their own snapshot part only', () => {
    const gantt = chart();
    expect(rebuilt(gantt, { editing: false })).toEqual(['snapshot', 'editing']);
    expect(rebuilt(gantt, { editing: false })).toEqual([]);
    expect(rebuilt(gantt, { editing: { resize: false } })).toEqual(['snapshot', 'editing']);
    expect(rebuilt(gantt, { interaction: { handles: { linkOffset: 14 } } })).toEqual([
      'snapshot',
      'handles',
    ]);
    // No size changed: the machine is recreated, which touches neither part.
    expect(rebuilt(gantt, { interaction: { handles: { linkOffset: 14 } } })).toEqual([]);
  });

  it('FR-API-2, FR-UI-1: `now` rebuilds the minute and what depends on the clock', () => {
    const gantt = chart();
    const parts = rebuilt(gantt, { now: () => '2026-03-10' });
    expect(parts).toContain('now');
    expect(parts).not.toContain('layout');
    expect(parts).not.toContain('model');
    expect(parts).not.toContain('editing');
  });

  it('FR-API-2: the row height rebuilds the row metrics and bars, not the model', () => {
    const gantt = chart();
    expect(rebuilt(gantt, { layout: { rowHeight: 40 } })).toEqual([
      'snapshot',
      'rowLayout',
      'layout',
    ]);
    // The bar height leaves the row metrics alone.
    expect(rebuilt(gantt, { layout: { barHeight: 20 } })).toEqual(['snapshot', 'layout']);
    expect(gantt.getSnapshot().layoutOptions).toMatchObject({ rowHeight: 40, barHeight: 20 });
  });

  it('FR-API-2: the calendar rebuilds the model and what depends on it', () => {
    const gantt = chart();
    // The tree is the same (same ids, parents and anchors), so it is kept.
    expect(rebuilt(gantt, { calendar: { weekends: [0] } })).toEqual([
      'snapshot',
      'model',
      'settings',
      'layout',
    ]);
    expect(rebuilt(gantt, { hierarchy: { childAnchor: 'FS' } })).toEqual([
      'snapshot',
      'hierarchy',
      'rows',
      'settings',
      'rowLayout',
      'layout',
    ]);
  });

  it('FR-API-2: snap and propagation options change settings only', () => {
    const gantt = chart();
    expect(rebuilt(gantt, { scheduling: { snap: '1w' } })).toEqual([
      'snapshot',
      'snap',
      'settings',
    ]);
    expect(rebuilt(gantt, { scheduling: { propagation: 'none' } })).toEqual([
      'snapshot',
      'settings',
    ]);
    expect(gantt.getSnapshot().state.settings.propagation.propagation).toBe('none');
    // Field by field: the snap set before is kept.
    expect(gantt.getSnapshot().state.options.scheduling).toEqual({
      snap: '1w',
      propagation: 'none',
    });
  });

  it('FR-API-2: the expanded keys rebuild the rows only; the locale the header only', () => {
    const gantt = chart();
    expect(rebuilt(gantt, { hierarchy: { expandedKeys: [] } })).toEqual([
      'snapshot',
      'rows',
      'rowLayout',
      'layout',
    ]);
    expect(rebuilt(gantt, { locale: 'uk' })).toEqual(['snapshot', 'header']);
  });

  it('FR-API-2: the view mode rebuilds the snap, the scale and the layout, not the model', () => {
    const gantt = chart();
    expect(rebuilt(gantt, { viewMode: 'week' })).toEqual([
      'snapshot',
      'snap',
      'layout',
      'timeline',
      'header',
    ]);
  });

  it('FR-API-2: the interaction options recreate the machine and cancel a gesture', () => {
    const gantt = chart({ scroll: { initial: 'start', autoScroll: false } });
    const bar = gantt.getBarRect('design')!;
    const y = bar.y + bar.height / 2;
    gantt.send({ type: 'down', pointerId: 1, x: bar.x + 50, y, time: 0 });
    gantt.send({ type: 'move', pointerId: 1, x: bar.x + 90, y, time: 1 });
    expect(gantt.getSnapshot().state.draft).toBeDefined();
    gantt.setOptions({ interaction: { dragThreshold: 10 } });
    expect(gantt.getSnapshot().state.draft).toBeUndefined();
    expect(gantt.getSnapshot().feedback.phase).toBe('idle');
    // The new threshold: 8 px is still a click.
    const clicks: unknown[] = [];
    gantt.on('taskClick', (record) => clicks.push(record.id));
    gantt.send({ type: 'down', pointerId: 2, x: bar.x + 50, y, time: 10 });
    gantt.send({ type: 'move', pointerId: 2, x: bar.x + 58, y, time: 11 });
    gantt.send({ type: 'up', pointerId: 2, x: bar.x + 58, y, time: 12 });
    expect(clicks).toEqual(['design']);
  });

  it('keeps unknown options (renderer options) out, without issues', () => {
    const gantt = chart();
    const patch = {
      display: { today: true },
      tooltip: {},
      onTooltip: 5,
    } as Partial<GanttCoreOptions>;
    expect(rebuilt(gantt, patch)).toEqual([]);
    expect(gantt.getIssues().options).toEqual([]);
  });

  it('routes every option key; handlers go to the handlers only', () => {
    expectTypeOf<keyof typeof OPTION_INVALIDATION>().toEqualTypeOf<OptionKey>();
    expect(targetsOf(['onTaskClick', 'onBeforeTaskChange'])).toEqual(new Set(['handlers']));
    expect(targetsOf(['hierarchy', 'layout', 'onSomethingElse'])).toEqual(
      new Set(['store', 'rows', 'layout']),
    );
    expect(targetsOf(['editing'])).toEqual(new Set(['editing']));
    expect(targetsOf(['interaction'])).toEqual(new Set(['interaction', 'handles']));
    expect(targetsOf(['now'])).toEqual(new Set(['timeline', 'now']));
    expect(eventOfHandler('onTasksChange')).toBe('tasksChange');
    expect(eventOfHandler('onBeforeTaskChange')).toBeUndefined();
    expect(eventOfHandler('on')).toBeUndefined();
  });
});

describe('checkOptions and mergeOptions', () => {
  it('FR-DATA-4: replaces values of the wrong type with their defaults and reports them', () => {
    const { values, issues } = checkOptions(
      {
        tasks: 'none',
        links: {},
        dataMode: 'owned',
        viewMode: 3,
        viewModes: null,
        locale: '',
        direction: 'up',
        now: 'today',
        editing: 'yes',
        history: { enabled: 'no', limit: 1.5 },
        calendar: [],
        hierarchy: { expandedKeys: 'some', childAnchor: 'FS' },
        interaction: { dragThreshold: -1, touchDragThreshold: 4, handles: { resize: 'wide' } },
        onTaskClick: 'click',
      },
      true,
    );
    expect(values).toEqual({
      tasks: [],
      links: undefined,
      dataMode: undefined,
      viewMode: undefined,
      viewModes: undefined,
      locale: undefined,
      direction: undefined,
      now: undefined,
      editing: undefined,
      history: {},
      calendar: undefined,
      hierarchy: { childAnchor: 'FS' },
      interaction: { touchDragThreshold: 4, handles: {} },
      onTaskClick: undefined,
    });
    expect([...issues.values()].flat().map((found) => found.path)).toEqual([
      'tasks',
      'links',
      'dataMode',
      'viewMode',
      'viewModes',
      'locale',
      'direction',
      'now',
      'editing',
      'history.enabled',
      'history.limit',
      'calendar',
      'hierarchy.expandedKeys',
      'interaction.dragThreshold',
      'interaction.handles.resize',
      'onTaskClick',
    ]);
    expect(checkOptions({}, true).values).toEqual({ tasks: [] });
    expect(checkOptions({ interaction: { handles: 3 } }, false).values).toEqual({
      interaction: { handles: undefined },
    });
    expect(checkOptions(undefined, false)).toEqual({ values: {}, issues: new Map() });
  });

  it('FR-DATA-4: an unusable enum or flag field returns to its default with an issue', () => {
    const { values, issues } = checkOptions(
      {
        dates: { endInclusive: 'yes' },
        scheduling: {
          durationMode: 'work',
          propagation: 'bogus',
          defaultLinkType: 'XX',
          alignInput: 'round',
          keepDayPrecision: 1,
          skipNonWorkingDays: { move: 'yes', resize: true },
          snap: '1d',
        },
        hierarchy: { moveChildren: 'bogus', childAnchor: 'FS' },
        editing: { move: 'no', resize: false },
        interaction: { dragThreshold: -1 },
      },
      false,
    );
    expect([...issues.values()].flat().map((found) => [found.path, found.suggested])).toEqual([
      ['dates.endInclusive', true],
      ['scheduling.durationMode', 'calendar'],
      ['scheduling.propagation', 'preserve-lag'],
      ['scheduling.defaultLinkType', 'FS'],
      ['scheduling.alignInput', 'expand'],
      ['scheduling.keepDayPrecision', true],
      ['scheduling.skipNonWorkingDays.move', true],
      ['hierarchy.moveChildren', 'all'],
      ['editing.move', true],
      ['interaction.dragThreshold', undefined],
    ]);
    expect(values).toEqual({
      dates: {},
      scheduling: { skipNonWorkingDays: { resize: true }, snap: '1d' },
      hierarchy: { childAnchor: 'FS' },
      editing: { resize: false },
      interaction: {},
    });
    // A group field is set to `undefined`, so that `setOptions` resets it instead of keeping
    // the value it had.
    const fields = (key: string): readonly string[] => Object.keys(values[key] as object);
    expect(fields('scheduling')).toEqual([
      'durationMode',
      'propagation',
      'defaultLinkType',
      'alignInput',
      'keepDayPrecision',
      'skipNonWorkingDays',
      'snap',
    ]);
    expect(fields('interaction')).toEqual(['dragThreshold']);
    expect(checkOptions({ scheduling: { skipNonWorkingDays: true } }, false)).toEqual({
      values: { scheduling: { skipNonWorkingDays: undefined } },
      issues: new Map([
        [
          'scheduling',
          [expect.objectContaining({ path: 'scheduling.skipNonWorkingDays', value: true })],
        ],
      ]),
    });
    // Valid groups keep their identity.
    const scheduling = { propagation: 'none', skipNonWorkingDays: { move: false } };
    expect(checkOptions({ scheduling }, false).values.scheduling).toBe(scheduling);
  });

  it('FR-DATA-4, FR-SCH-1: a value planned for a later release is unsupported, the default is used', async () => {
    const gantt = createGanttCore({
      tasks: [
        { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
        { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
      ],
      links: [{ source: 'a', target: 'b' }],
      scheduling: { propagation: 'none' },
    });
    expect(gantt.setOptions({ scheduling: { propagation: 'push-forward' as never } })).toEqual([
      expect.objectContaining({
        code: 'unsupported-option',
        severity: 'error',
        path: 'scheduling.propagation',
        value: 'push-forward',
        suggested: 'preserve-lag',
      }),
    ]);
    // `'preserve-lag'`, not the `'none'` given before: `b` follows `a` by a day.
    await gantt.updateTask('a', { start: '2026-03-03' });
    const moved = parseDateInput('2026-03-10');
    expect(gantt.getTask('b')?.start).toEqual(moved.ok ? toDate(moved.value.value) : undefined);
  });

  it('FR-DATA-4: an unknown alignInput is reported instead of throwing', () => {
    const gantt = createGanttCore({
      tasks: [{ id: 'a', name: 'A', start: '2026-03-02T10:30', end: '2026-03-03' }],
      scheduling: { alignInput: 'round' as never },
    });
    expect(gantt.getIssues().options).toEqual([
      expect.objectContaining({ path: 'scheduling.alignInput', value: 'round' }),
    ]);
    expect(gantt.getIssues().data).toEqual([
      expect.objectContaining({ code: 'misaligned', severity: 'warning' }),
    ]);
  });

  it('FR-EDIT-7, FR-ROW-2: unusable editing flags and expanded keys fall back to their defaults', () => {
    const gantt = chart({ hierarchy: { expandedKeys: [] } });
    expect(gantt.getRowMetrics('build')).toBeUndefined();
    const issues = gantt.setOptions({
      editing: { move: 'no' as never, resize: false },
      hierarchy: { expandedKeys: 'some' as never },
    });
    expect(issues.map((found) => [found.path, found.value, found.suggested])).toEqual([
      ['editing.move', 'no', true],
      ['hierarchy.expandedKeys', 'some', 'all'],
    ]);
    // `'all'`, not the empty list given before.
    expect(gantt.getRowMetrics('build')).toBeDefined();
  });

  it('FR-DATA-4: qualifying issue paths is idempotent; a path qualified at the source is kept', () => {
    const issues = [
      {
        code: 'invalid-layout-option',
        severity: 'error',
        message: 'rowHeight: -1 is bad',
        path: 'rowHeight',
      },
      { code: 'invalid-layout-option', severity: 'error', message: 'bad', path: '[0]' },
      { code: 'invalid-layout-option', severity: 'error', message: 'whole group' },
    ] as const;
    const once = qualifyIssues('layout', issues);
    expect(once.map((found) => found.path)).toEqual(['layout.rowHeight', 'layout[0]', 'layout']);
    const twice = qualifyIssues('layout', once);
    expect(twice).toEqual(once);
    once.forEach((found, i) => expect(twice[i]).toBe(found));
    const atSource = {
      code: 'unknown-view-mode',
      severity: 'warning',
      message: 'viewMode: unknown view mode',
      path: 'viewMode',
    } as const;
    expect(qualifyIssues('viewMode', [atSource])[0]).toBe(atSource);
  });

  it('merges groups field by field and keeps identities when nothing changes', () => {
    const base = Object.freeze({ layout: Object.freeze({ rowHeight: 40 }), locale: 'en' });
    const merged = mergeOptions(base, { layout: { barHeight: 20 } });
    expect(merged).toEqual({ layout: { rowHeight: 40, barHeight: 20 }, locale: 'en' });
    expect(Object.isFrozen(merged.layout)).toBe(true);
    expect(mergeOptions(base, { layout: { rowHeight: 40 }, locale: 'en' })).toBe(base);
    expect(mergeOptions(base, { layout: undefined })).toEqual({ layout: undefined, locale: 'en' });
    expect(mergeOptions(base, { editing: { move: false } })).toEqual({
      ...base,
      editing: { move: false },
    });
  });
});
