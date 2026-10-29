import { Rolldown } from 'tsdown';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEVELOPMENT_DEFINE, PRODUCTION_DEFINE } from '../define.config';
import * as source from './index';

type Core = typeof source;
type AnyIssue = source.Issue & { readonly taskIds?: unknown; readonly linkIds?: unknown };

/**
 * The entry bundled the way `tsdown.config.ts` builds it (its `define`), with the dependencies
 * inlined, as an IIFE that `new Function` can run without a module loader.
 */
async function bundle(define: Readonly<Record<string, string>>): Promise<string> {
  const build = await Rolldown.rolldown({
    input: 'packages/core/src/index.ts',
    cwd: rootDir(),
    platform: 'neutral',
    treeshake: true,
    transform: { define: { ...define } },
  });
  const { output } = await build.generate({ format: 'iife', name: 'ganttlaneCore' });
  await build.close();
  const chunk = output[0];
  return chunk.code;
}

/** The repository root, from the path of this test file. */
function rootDir(): string {
  const path = expect.getState().testPath ?? '';
  return path.slice(0, path.lastIndexOf('/packages/core/src/'));
}

function load(code: string): Core {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the bundle under test
  const run = new Function(`${code}\nreturn ganttlaneCore;`) as () => Core;
  return run();
}

const DAY_TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-04' },
  { id: 'b', name: 'B', start: '2026-03-05', end: '2026-03-06', parentId: 'c' },
  { id: 'c', name: 'C', start: '2026-03-02', end: '2026-03-09', parentId: 'b' },
  { id: 'lost', name: 'Lost', start: '2026-03-02', end: '2026-03-03', parentId: 'nobody' },
  { id: 'anchor', name: 'Anchor', start: '2026-03-02', duration: 2, parentAnchor: ['SS', 'FS'] },
  { id: 'empty', name: 'Empty' },
  { id: 'half', name: 'Half', start: '2026-03-02' },
  { id: 'back', name: 'Back', start: '2026-03-05', end: '2026-03-01' },
  { id: 'long', name: 'Long', start: '2026-03-02', end: '2099-03-02' },
  { id: 'over', name: 'Over', start: '2026-03-02', end: '2026-03-03', progress: 140 },
  { id: 'bad', name: 'Bad', start: '2026-02-30', end: 'soon' },
  { id: 'zoned', name: 'Zoned', start: '2026-03-02T10:00Z', end: '2026-03-03' },
  { id: 'shape', name: 42, start: '2026-03-02', end: '2026-03-03' },
  { id: 'a', name: 'Again', start: '2026-03-02', end: '2026-03-03' },
  { name: 'No id' },
  { id: 'odd', name: 'Odd', start: '2026-03-02T10:30', end: '2026-03-02T11:15', precision: 'time' },
  { id: 'span', name: 'Span', start: '2026-03-02', duration: '1d 5m' },
  {
    id: 'lag',
    name: 'Lag',
    start: '2026-03-02',
    end: '2026-03-03',
    dependencies: [{ id: 'a', lag: '1mo' }],
  },
  { id: 'x', name: 'X', start: '2026-03-02', end: '2026-03-03' },
  { id: 'y', name: 'Y', start: '2026-03-04', end: '2026-03-05' },
];
const LINKS = [
  { source: 'a', target: 'a' },
  { source: 'a', target: 'ghost' },
  { source: 'a', target: 'empty' },
  { id: 'l1', source: 'x', target: 'y' },
  { id: 'l2', source: 'x', target: 'y' },
  { id: 'l1', source: 'y', target: 'x', type: 'SS' },
  { id: 'xy', source: 'y', target: 'x' },
  { id: 'loop', source: 'x', target: 'y', type: 'FF' },
  { source: 'a', target: 'b', lag: -1.5, type: 'SF' },
  { source: 7 },
];

/** Every issue the core can report, gathered through its public API in a fixed order. */
async function collectIssues(core: Core): Promise<AnyIssue[]> {
  const found: AnyIssue[] = [];
  const add = (list: readonly source.Issue[]): void => {
    found.push(...list);
  };
  const failed = (result: source.Result<unknown>): void => {
    if (!result.ok) found.push(result.issue);
  };

  for (const value of [
    '5m',
    '',
    '1d  4h',
    '1s',
    '-1d',
    '1.5d',
    '1d 1d',
    '1x',
    'PT1S',
    'PT1.5H',
    'P',
    3,
  ]) {
    failed(core.parseDuration(value as source.DurationInput, { path: 'duration' }));
  }
  failed(core.parseDuration({ hours: -1 }));
  failed(core.parseDuration({ weeks: 1, fortnights: 1 } as source.DurationInput));
  failed(core.parseDuration({}));
  failed(core.parseDuration({ days: Number.MAX_SAFE_INTEGER }));
  for (const value of [
    '2026-13-01',
    '2026-02-30T10:00',
    '2026-03-02T25:00',
    'tomorrow',
    '2026-03-02Z',
  ]) {
    failed(core.parseDateInput(value, { path: 'start' }));
  }
  failed(core.parseDateInput(new Date(Number.NaN)));
  failed(core.parseDateInput(Number.POSITIVE_INFINITY));
  failed(core.parseDateInput(9e15));
  failed(core.parseDateInput(true as unknown as source.DateInput));
  failed(core.parseGranularity('5h', { path: 'scheduling.granularity' }));

  add(
    core.createWorkCalendar({
      weekends: [0, 6, 9],
      holidays: [
        '2026-03-09',
        { date: 'never' },
        { name: 'No date' },
        { date: '2026-03-10', name: 5 },
      ],
      workingDays: ['2026-03-07T10:00', 'x'],
      isWorkingDay: 'yes',
    } as unknown as source.WorkCalendarOptions).issues,
  );
  add(core.createWorkCalendar({ weekends: 'Sat' } as unknown as source.WorkCalendarOptions).issues);
  add(core.createWorkCalendar({ holidays: 'x' } as unknown as source.WorkCalendarOptions).issues);
  add(core.createWorkCalendar({ weekends: [0, 1, 2, 3, 4, 5, 6] }).issues);

  add(
    core.resolveViewModes({
      day: { pxPerDay: -1, step: 0.5, label: 3, column_width: 30, snap: { mode: 'x', every: 1 } },
      week: { id: 'w', headers: [] },
      month: {
        headers: [
          { unit: 'decade', format: 'x' },
          'row',
          { unit: 'year', format: { month: 'bogus' } },
        ],
        majorLine: { unit: 'x', extra: 1 },
        minorLine: '1mo 1d',
        padding: ['1d'],
      },
      year: 'no' as never,
      custom: { unit: 'fortnight', snap: true },
    } as unknown as source.ViewModesInput).issues,
  );
  add(
    core.resolveViewModes([{ id: 'a' }, { id: 'a' }, 'x'] as unknown as source.ViewModesInput)
      .issues,
  );
  add(core.resolveViewModes(5 as unknown as source.ViewModesInput).issues);
  add(
    core.resolveViewModes({ day: { majorLine: 'x', padding: '0d', minorLine: '0d' } } as never)
      .issues,
  );

  const hour = core.VIEW_MODE_PRESETS.find((mode) => mode.id === 'hour')!;
  const hourly = core.parseGranularity('1h');
  add(
    core.resolveSnap({
      viewMode: hour,
      option: { move: '1mo 1d', resize: '10min', progress: '90min' },
      granularity: hourly.ok ? hourly.value : undefined,
    }).issues,
  );

  add(
    core.resolveLayoutOptions(
      { rowHeight: 20, barHeight: 30, barRadius: -1, headerRowHeight: ['x'] } as never,
      2,
    ).issues,
  );
  add(core.resolveLayoutOptions({ rowHeight: 'tall', headerRowHeight: -3 } as never, 2).issues);
  add(
    core.resolveTimelineOptions({
      range: { start: '2026-03-05', end: '2026-03-01' },
      padding: ['1d'],
      includeToday: 'yes',
      infinite: {
        threshold: -1,
        extendBy: '0d',
        maxSpan: 'x',
        bounds: { min: '2026-03-05', max: '2026-03-01' },
      },
    } as never).issues,
  );
  add(core.resolveTimelineOptions({ range: 'all', infinite: 3, padding: 'x' } as never).issues);
  add(core.resolveTimelineOptions({ infinite: { bounds: 2 } } as never).issues);
  add(core.resolveTimelineOptions('x' as never).issues);
  add(
    core.resolveScrollOptions({
      initial: 'later',
      behavior: 'fast',
      align: 2,
      autoScroll: { edge: -1, maxSpeed: 'x' },
    } as never).issues,
  );
  add(core.resolveScrollOptions({ autoScroll: 'on' } as never).issues);

  const { calendar } = core.createWorkCalendar();
  for (const alignInput of ['expand', 'reject'] as const) {
    const model = core.normalizeModel(
      { tasks: DAY_TASKS as never, links: LINKS as never },
      { calendar, granularity: '1h', alignInput, maxSpan: '10y' },
    );
    add(model.issues);
    add(core.buildHierarchy(model, { childAnchor: 'XX' as never }).issues);
    add(core.buildLinkGraph(model).issues);
  }
  add(
    core.normalizeModel(
      { tasks: 'x' as never, links: 'y' as never },
      { calendar, granularity: '7h' },
    ).issues,
  );
  const closed = core.createWorkCalendar({ weekends: [0, 1, 2, 3, 4, 5, 6] }).calendar;
  add(
    core.normalizeModel(
      { tasks: [{ id: 'w', name: 'W', start: '2026-03-02', duration: '2d' }] },
      { calendar: closed, durationMode: 'working' },
    ).issues,
  );

  const model = core.normalizeModel(
    {
      tasks: [
        {
          id: 'm',
          name: 'M',
          start: '2026-03-02T09:00',
          end: '2026-03-02T12:00',
          precision: 'time',
        },
        {
          id: 'z',
          name: 'Z',
          start: '2026-03-04T10:00',
          end: '2026-03-04T11:00',
          precision: 'time',
        },
        { id: 'f', name: 'F', start: '2026-03-02', end: '2026-03-03', locked: true },
        { id: 's', name: 'S', type: 'placeholder' },
      ],
    },
    { calendar, granularity: '1h' },
  );
  const context = {
    model,
    hierarchy: core.buildHierarchy(model),
    graph: core.buildLinkGraph(model),
  };
  const hourMs = 3_600_000;
  const m = model.taskById.get('m')!.span!;
  const z = model.taskById.get('z')!.span!;
  const change = (id: string, after: Record<string, unknown>): unknown => ({
    id,
    before: { start: 0, endExclusive: 0, progress: 0 },
    after,
    cause: 'direct',
  });
  for (const alignInput of ['expand', 'reject'] as const) {
    const aligned = { ...context, model: { ...model, options: { ...model.options, alignInput } } };
    add(
      core.revalidateChangeSet(
        {
          reason: 'api',
          conflicts: [],
          changes: [
            'junk',
            change('ghost', { start: 0, endExclusive: 0, progress: 0 }),
            change('s', { start: 0, endExclusive: 0, progress: 0 }),
            change('f', { start: 0, endExclusive: 0, progress: 0 }),
            change('m', { start: 'x', endExclusive: 0, progress: 0 }),
            change('m', { start: m.start, endExclusive: m.start - hourMs, progress: 0 }),
            change('z', {
              start: z.start + 60_000,
              endExclusive: z.start + 120_000,
              progress: 150,
            }),
          ],
        } as never,
        aligned,
      ).issues,
    );
    add(
      core.revalidateChangeSet(
        {
          reason: 'api',
          conflicts: [],
          changes: [change('z', { start: z.start, endExclusive: z.start, progress: 0 })],
        } as never,
        aligned,
      ).issues,
    );
  }

  const gantt = core.createGanttCore({
    tasks: DAY_TASKS as never,
    links: LINKS as never,
    viewMode: 'fortnight',
    dataMode: 'sometimes',
    locale: 'not a locale!',
    direction: 'up',
    editing: 3,
    viewModes: 4,
    layout: { rowHeight: -1 },
    timeline: { padding: 'soon' },
    scroll: 'x',
    calendar: 'x',
    hierarchy: { expandedKeys: 'some' },
    history: { enabled: 'yes', limit: -2 },
    interaction: { dragThreshold: Number.NaN, handles: 'big' },
    scheduling: { propagation: 'push-forward', skipNonWorkingDays: { move: 'yes' } },
    now: () => 'never',
    onTaskClick: 'x',
  } as never);
  gantt.setOptions({ interaction: { handles: { resize: -1 } }, history: 'x' } as never);
  add(gantt.getIssues().data);
  add(gantt.getIssues().options);
  for (const update of [
    'x',
    { start: 'never' },
    { progress: 'half' },
    { start: '2026-03-02T10:30' },
    { end: '2026-03-03T10:30' },
    { end: '2026-03-01' },
  ]) {
    const result = await gantt.updateTask('a', update as never);
    if ('issues' in result) add(result.issues);
  }
  gantt.setOptions({ scheduling: { alignInput: 'reject' } });
  const rejected = await gantt.updateTask('odd', { start: '2026-03-02T10:30' });
  if ('issues' in rejected) add(rejected.issues);
  gantt.destroy();
  add(core.createGanttCore('x' as never).getIssues().options);
  add(core.createGanttCore({} as never).getIssues().options);
  return found;
}

/** The production message: `'<path>: <code>'`, or the code alone without a path. */
function shortForm(issue: source.Issue): string {
  return issue.path === undefined || issue.path === ''
    ? issue.code
    : `${issue.path}: ${issue.code}`;
}

function withoutMessage(issue: AnyIssue): Omit<AnyIssue, 'message'> {
  const { message: _message, ...rest } = issue;
  return rest;
}

describe('NFR-SIZE-1, ADR-019: production and development builds', () => {
  let production: string;
  let development: string;
  beforeAll(async () => {
    [production, development] = await Promise.all([
      bundle(PRODUCTION_DEFINE),
      bundle(DEVELOPMENT_DEFINE),
    ]);
  });

  it('the production build reports the same issues with short messages', async () => {
    const full = await collectIssues(source);
    const short = await collectIssues(load(production));
    expect(short.map(withoutMessage)).toEqual(full.map(withoutMessage));
    expect(short.map((issue) => issue.message)).toEqual(short.map(shortForm));
    // The sources run as the development build: every message explains more than the code.
    for (const [i, issue] of full.entries()) {
      expect(issue.message.length, issue.message).toBeGreaterThan(shortForm(issue).length);
      expect(issue.message).not.toBe(short[i]!.message);
    }
    // The battery reaches every module that reports issues.
    expect(new Set(full.map((issue) => issue.code))).toEqual(
      new Set([
        'invalid-duration',
        'invalid-date',
        'unsupported-offset',
        'invalid-granularity',
        'invalid-weekend',
        'invalid-holiday',
        'invalid-working-day',
        'invalid-rule',
        'time-ignored',
        'no-working-days',
        'invalid-view-mode',
        'invalid-snap',
        'snap-below-granularity',
        'snap-not-multiple',
        'invalid-layout-option',
        'invalid-timeline-option',
        'invalid-scroll-option',
        'invalid-shape',
        'duplicate-id',
        'misaligned',
        'no-dates',
        'incomplete-dates',
        'end-before-start',
        'too-long',
        'no-working-time',
        'progress-out-of-range',
        'unknown-parent',
        'parent-cycle',
        'invalid-parent-anchor',
        'unknown-link-task',
        'self-link',
        'duplicate-link',
        'inactive-link',
        'cycle',
        'invalid-change',
        'unknown-task',
        'duplicate-change',
        'locked-task',
        'too-short',
        'unknown-view-mode',
        'invalid-option',
        'unsupported-option',
      ]),
    );
  });

  it('the production build carries no explanatory text, the development build does', () => {
    const texts = [
      'use y, q, mo, w, d, h or min',
      'is not a preset, so its view mode must be complete',
      'column_width',
      'the calendar has no working days to place it',
      'is not a boolean or { enabled, limit }',
    ];
    for (const text of texts) {
      expect(production).not.toContain(text);
      expect(development).toContain(text);
    }
    expect(production).not.toContain('__GANTTLANE_DEV__');
    expect(development).not.toContain('__GANTTLANE_DEV__');
    expect(production.length).toBeLessThan(development.length);
  });
});
