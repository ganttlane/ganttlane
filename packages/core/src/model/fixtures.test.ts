import {
  edgeCase,
  edgeCases,
  type Fixture,
  generateFixture,
  type GeneratorGranularity,
  sampleProject,
  workingDayScenarios,
} from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { type DateTimeMs, DAY, HOUR, parseGranularity, toISODateTime } from '../time';
import {
  type ModelIssue,
  type NormalizedModel,
  normalizeModel,
  type NormalizeModelOptions,
  type TaskId,
  type TaskModel,
} from './index';

/** Normalizes a fixture with its calendar and data options. */
function normalizeFixture<TData>(
  fixture: Fixture<TData>,
  overrides: Partial<NormalizeModelOptions> = {},
): NormalizedModel<TData> {
  const { calendar, issues } = createWorkCalendar(fixture.calendar);
  expect(issues).toEqual([]);
  const scheduling = fixture.options?.scheduling;
  return normalizeModel(fixture, {
    calendar,
    granularity: scheduling?.granularity,
    alignInput: scheduling?.alignInput,
    durationMode: scheduling?.durationMode,
    defaultLinkType: scheduling?.defaultLinkType,
    endInclusive: fixture.options?.dates?.endInclusive,
    ...overrides,
  });
}

function codes(issues: readonly ModelIssue[]): string[] {
  return issues.map(
    (issue) => `${issue.code}${issue.severity === 'warning' ? '?' : ''}@${issue.path ?? ''}`,
  );
}

function task<TData>(model: NormalizedModel<TData>, id: TaskId): TaskModel<TData> {
  const found = model.taskById.get(id);
  if (!found) throw new Error(`No task ${String(id)}`);
  return found;
}

/** Inclusive start and end as `YYYY-MM-DD[THH:mm]`, trimming midnight. */
function range(record: TaskModel): [string, string] | undefined {
  const span = record.span;
  if (!span) return undefined;
  const text = (t: DateTimeMs): string => toISODateTime(t).replace(/T00:00$/, '');
  return [text(span.start), text(span.end)];
}

/**
 * Issues each edge case produces in the model. Codes that belong to later steps (unknown parent
 * and parent cycles: hierarchy, step 2.2; unknown link ends and link cycles: graph, step 2.3;
 * non-working-day conflicts: step 2.5) are not raised here.
 */
const EXPECTED_ISSUES: Record<string, string[]> = {
  'no-dates': [
    'no-dates?@tasks[0]',
    'incomplete-dates@tasks[1]',
    'incomplete-dates@tasks[2]',
    'incomplete-dates@tasks[3]',
  ],
  'end-before-start': [
    'end-before-start@tasks[0].end',
    'end-before-start@tasks[1].end',
    'end-before-start@tasks[2].end',
  ],
  'invalid-dates': [
    'invalid-date@tasks[0].start',
    'invalid-date@tasks[1].start',
    'invalid-date@tasks[2].start',
    'invalid-date@tasks[3].start',
    'invalid-date@tasks[4].start',
    'invalid-duration@tasks[5].duration',
  ],
  'unknown-parent': [],
  'parent-cycle': [],
  'unknown-link-target': [],
  'link-cycle': [],
  'duplicate-ids': ['duplicate-id@tasks[1].id', 'duplicate-id@links[1]'],
  'numeric-ids': [],
  'progress-bounds': [
    'progress-out-of-range?@tasks[3].progress',
    'progress-out-of-range?@tasks[4].progress',
  ],
  'one-day': [],
  // The fixture has no granularity, so the over-midnight task is expanded to whole days.
  'across-new-year': ['misaligned?@tasks[3].start', 'misaligned?@tasks[3].end'],
  'leap-day': [],
  'dst-crossing': [],
  'misaligned-1h': [
    'misaligned?@tasks[1].start',
    'misaligned?@tasks[1].end',
    'misaligned?@tasks[2].duration',
    'misaligned?@links[0].lag',
  ],
  'very-long': [
    'too-long@tasks[0].end',
    'too-long@tasks[1].duration',
    'too-long@tasks[2].duration',
  ],
  'deep-hierarchy': [],
  'parent-without-children': [],
  'link-types': [],
};

describe('model: edge-case fixtures (FR-DATA-1, FR-DATA-4)', () => {
  it('FR-DATA-4: every edge case produces exactly its documented model issues', () => {
    expect(Object.keys(EXPECTED_ISSUES).sort()).toEqual(
      edgeCases.map((fixture) => fixture.name).sort(),
    );
    for (const fixture of edgeCases) {
      expect(Object.isFrozen(fixture.tasks[0])).toBe(true);
      const model = normalizeFixture(fixture);
      expect([fixture.name, codes(model.issues)]).toEqual([
        fixture.name,
        EXPECTED_ISSUES[fixture.name],
      ]);
      const own = model.tasks.flatMap((record) => record.issues);
      expect(model.issues).toEqual(expect.arrayContaining([...own]));
    }
  });

  it('FR-DATA-3: no-dates keeps every row; only the dated one has a bar', () => {
    const model = normalizeFixture(edgeCase('no-dates'));
    expect(model.tasks.map((record) => [record.id, record.type, record.valid])).toEqual([
      ['no-dates', 'placeholder', true],
      ['duration-only', 'task', false],
      ['start-only', 'task', false],
      ['end-only', 'task', false],
      ['placeholder', 'placeholder', true],
      ['dated', 'task', true],
    ]);
    expect(model.tasks.filter((record) => record.span).map((record) => record.id)).toEqual([
      'dated',
    ]);
  });

  it('FR-DATA-4: end-before-start rejects all three, including the same month (bug D3)', () => {
    const model = normalizeFixture(edgeCase('end-before-start'));
    expect(model.tasks.map((record) => record.valid)).toEqual([false, false, false, true]);
  });

  it('FR-TIME-1: invalid-dates never throws and keeps the control task', () => {
    const model = normalizeFixture(edgeCase('invalid-dates'));
    expect(model.tasks.map((record) => record.valid)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('FR-ROW-1: parent ids are kept as given for the hierarchy (plan step 2.2)', () => {
    const model = normalizeFixture(edgeCase('unknown-parent'));
    expect(model.tasks.map((record) => record.parentId)).toEqual([
      'ghost',
      404,
      undefined,
      'parent',
    ]);
    const cycle = normalizeFixture(edgeCase('parent-cycle'));
    expect(cycle.tasks.map((record) => record.parentId)).toEqual(['b', 'a', 'self', undefined]);
  });

  it('FR-LINK-7, FR-LINK-8: links to missing tasks and cycles are kept for the graph (plan step 2.3)', () => {
    expect(normalizeFixture(edgeCase('unknown-link-target')).links.map((link) => link.id)).toEqual([
      'a:FS:ghost',
      'ghost-source:FS:b',
      'a:FS:b',
    ]);
    expect(normalizeFixture(edgeCase('link-cycle')).links.map((link) => link.id)).toEqual([
      'A:FS:B',
      'B:FS:C',
      'C:FS:A',
      'D:FS:D',
      'E:FS:F',
    ]);
  });

  it('FR-DATA-4: duplicate-ids keeps the first task and the first link', () => {
    const model = normalizeFixture(edgeCase('duplicate-ids'));
    expect(model.tasks.map((record) => record.task.name)).toEqual([
      'First "dup"',
      'Links to "dup"',
    ]);
    expect(model.links.map((link) => [link.id, link.source, link.target])).toEqual([
      ['same-link', 'dup', 'other'],
    ]);
  });

  it('FR-DATA-1: numeric ids stay numbers, 0 included (bug D14)', () => {
    const model = normalizeFixture(edgeCase('numeric-ids'));
    expect(model.tasks.map((record) => record.id)).toEqual([0, 1, 2, 10]);
    expect(task(model, 0).task.name).toBe('Id zero');
    expect(model.taskById.has('0')).toBe(false);
    expect(model.tasks.map((record) => record.parentId)).toEqual([undefined, 0, 0, undefined]);
    expect(model.links.map((link) => [link.id, link.source, link.target])).toEqual([
      ['1:FS:2', 1, 2],
      ['0:FS:10', 0, 10],
    ]);
  });

  it('FR-PROG-1, FR-SNAP-15: progress-bounds clamps and places the progress date (bugs D4, D5)', () => {
    const model = normalizeFixture(edgeCase('progress-bounds'));
    expect(
      model.tasks.map((record) => [
        record.id,
        record.progress,
        toISODateTime(record.span!.progressDate),
      ]),
    ).toEqual([
      ['p0', 0, '2026-03-02T00:00'],
      ['p100', 100, '2026-03-07T00:00'],
      // 12.5 % of 5 days is 15 h, aligned down to the day.
      ['p12.5', 12.5, '2026-03-02T00:00'],
      ['p-10', 0, '2026-03-02T00:00'],
      ['p150', 100, '2026-03-07T00:00'],
      ['p100-end', 100, '2026-03-07T00:00'],
      ['none', 0, '2026-03-02T00:00'],
    ]);
    const hourly = normalizeFixture(edgeCase('progress-bounds'), { granularity: '1h' });
    expect(toISODateTime(task(hourly, 'p12.5').span!.progressDate)).toBe('2026-03-02T15:00');
  });

  it('FR-TIME-3: one-day tasks in every input form are one day long', () => {
    const model = normalizeFixture(edgeCase('one-day'));
    expect(
      model.tasks.map((record) => [
        range(record),
        record.span?.duration.calendarDays,
        record.span?.duration.workingDays,
      ]),
    ).toEqual([
      [['2026-03-04', '2026-03-04'], 1, 1],
      [['2026-03-04', '2026-03-04'], 1, 1],
      [['2026-03-04', '2026-03-04'], 1, 1],
      // Saturday in working mode: zero working days, still valid (a conflict for step 2.5).
      [['2026-03-07', '2026-03-07'], 1, 0],
    ]);
  });

  it('FR-CAL-2: across-new-year counts the holiday and the weekend', () => {
    const model = normalizeFixture(edgeCase('across-new-year'));
    expect(range(task(model, 'range'))).toEqual(['2026-12-28', '2027-01-05']);
    expect(task(model, 'range').span?.duration).toMatchObject({ calendarDays: 9, workingDays: 6 });
    expect(range(task(model, 'duration'))).toEqual(['2026-12-31', '2027-01-01']);
    expect(range(task(model, 'working'))).toEqual(['2026-12-30', '2027-01-04']);
    expect(task(model, 'working').span?.duration).toMatchObject({
      calendarDays: 6,
      workingDays: 3,
      nonWorkingDays: 3,
    });
    const hourly = normalizeFixture(edgeCase('across-new-year'), { granularity: '1h' });
    expect(hourly.issues).toEqual([]);
    expect(range(task(hourly, 'time'))).toEqual(['2026-12-31T22:00', '2027-01-01T02:00']);
    expect(task(hourly, 'time').span?.duration).toMatchObject({
      ms: 4 * HOUR,
      workingMs: 2 * HOUR,
    });
  });

  it('FR-TIME-4: leap-day durations clamp to the end of the shorter month', () => {
    const model = normalizeFixture(edgeCase('leap-day'));
    expect(
      model.tasks.map((record) => [range(record), record.span?.duration.calendarDays]),
    ).toEqual([
      [['2028-02-29', '2028-02-29'], 1],
      [['2028-02-28', '2028-03-01'], 3],
      // Jan 31 + 1 month = Feb 29 (clamped), the exclusive end.
      [['2028-01-31', '2028-02-28'], 29],
      // Feb 29 + 1 year = Feb 28, 2029 (clamped).
      [['2028-02-29', '2029-02-27'], 365],
      [['2027-02-28', '2027-03-01'], 2],
    ]);
  });

  it('FR-TIME-2: dst-crossing durations are wall-clock in every host time zone', () => {
    const model = normalizeFixture(edgeCase('dst-crossing'));
    expect(
      model.tasks.map((record) => [record.precision, record.span!.duration.ms / HOUR]),
    ).toEqual([
      ['time', 6],
      ['time', 1],
      ['time', 3],
      ['time', 8],
      ['time', 1],
      ['time', 2],
      ['day', 96],
    ]);
  });

  it('FR-SNAP-13: misaligned-1h matches docs/api.md §4', () => {
    const model = normalizeFixture(edgeCase('misaligned-1h'));
    expect(model.tasks.map((record) => range(record))).toEqual([
      ['2026-01-05T10:00', '2026-01-05T12:00'],
      ['2026-01-05T10:00', '2026-01-05T12:00'],
      ['2026-01-05', '2026-01-05T02:00'],
      ['2026-01-06', '2026-01-07'],
    ]);
    expect(model.issues.map((issue) => [issue.value, issue.suggested])).toEqual([
      ['2026-01-05T10:30', '2026-01-05T10:00'],
      ['2026-01-05T11:30', '2026-01-05T12:00'],
      ['90min', '2h'],
      ['30min', '1h'],
    ]);
    expect(model.links[0]?.lag).toBe(HOUR);
    expect(task(model, 4).precision).toBe('day');
    const rejected = normalizeFixture(edgeCase('misaligned-1h'), { alignInput: 'reject' });
    expect(rejected.tasks.map((record) => record.valid)).toEqual([true, false, false, true]);
    expect(rejected.links).toEqual([]);
  });

  it('FR-DATA-4: very-long tasks are invalid, the short one stays', () => {
    const model = normalizeFixture(edgeCase('very-long'));
    expect(model.tasks.map((record) => record.valid)).toEqual([false, false, false, true]);
  });

  it('FR-LINK-1, FR-LINK-2: link-types keeps every type, the FS + FF pair, lags and the default', () => {
    const model = normalizeFixture(edgeCase('link-types'));
    expect(model.links.map((link) => [link.id, link.lag])).toEqual([
      ['a:SS:ss', undefined],
      ['a:FF:ff', undefined],
      ['a:SF:sf', undefined],
      ['a:FS:fs-ff', undefined],
      ['a:FF:fs-ff', undefined],
      ['a:FS:lead', -DAY],
      ['a:FS:lag', 2 * DAY],
      ['a:FS:default', undefined],
    ]);
  });
});

describe('model: sample-project and FR-SCH-7 scenarios', () => {
  it('FR-DATA-8: sample-project normalizes without any issue', () => {
    const model = normalizeFixture(sampleProject);
    expect(model.issues).toEqual([]);
    expect(model.tasks).toHaveLength(sampleProject.tasks.length);
    expect(model.links).toHaveLength(sampleProject.links.length);
    const placeholder = task(model, 'placeholder-3');
    expect([placeholder.type, placeholder.valid, placeholder.span]).toEqual([
      'placeholder',
      true,
      undefined,
    ]);
    expect(task(model, 'group-1').task.data?.kind).toBe('group');
  });

  it('FR-DATA-2, FR-CAL-2: start + working duration skips the Spring Holiday', () => {
    const model = normalizeFixture(sampleProject);
    // group-3: 15 working days from Monday 2026-03-30 with Friday 04-03 off.
    expect(range(task(model, 'group-3'))).toEqual(['2026-03-30', '2026-04-20']);
    expect(task(model, 'group-3').span?.duration).toMatchObject({
      calendarDays: 22,
      workingDays: 15,
      nonWorkingDays: 7,
    });
    // Given with start, end and duration (end wins); all three agree.
    for (const id of ['task-5', 'block-1', 'group-6']) {
      const record = task(model, id);
      expect([id, record.span?.duration.workingDays]).toEqual([id, record.task.duration]);
    }
  });

  it('FR-SCH-7: the scenario task and every expected outcome count their days correctly', () => {
    for (const scenario of workingDayScenarios) {
      const { task: given, calendar } = scenario.given;
      const fixture: Fixture = { name: scenario.id, description: '', tasks: [given], links: [] };
      const before = normalizeFixture({ ...fixture, calendar });
      expect(before.tasks[0]?.span?.duration).toMatchObject({ calendarDays: 5, workingDays: 5 });
      const { start, end, workingDays, calendarDays } = scenario.expected;
      const after = normalizeFixture({ ...fixture, calendar, tasks: [{ ...given, start, end }] });
      expect([scenario.id, after.tasks[0]?.span?.duration]).toEqual([
        scenario.id,
        expect.objectContaining({ workingDays, calendarDays }),
      ]);
    }
  });
});

describe('model: generated fixtures (FR-SNAP-12)', () => {
  const cases: [GeneratorGranularity, 'day' | 'time' | 'mixed'][] = [
    ['1d', 'day'],
    ['1h', 'time'],
    ['15min', 'mixed'],
    ['20min', 'time'],
  ];

  it.each(cases)(
    'FR-SNAP-12: granularity %s, %s precision: no issues and every date aligned',
    (granularity, precision) => {
      const fixture = generateFixture({ count: 1000, seed: 11, granularity, precision });
      const model = normalizeFixture(fixture);
      expect(model.issues).toEqual([]);
      const step = parseGranularity(granularity);
      if (!step.ok) throw new Error(step.issue.message);
      for (const record of model.tasks) {
        const span = record.span;
        if (!span) {
          expect(record.type).toBe('placeholder');
          continue;
        }
        for (const value of [span.start, span.endExclusive, span.progressDate]) {
          expect(value % step.value.ms).toBe(0);
        }
        expect(span.duration.ms).toBe(span.endExclusive - span.start);
      }
      for (const link of model.links) {
        if (link.lag !== undefined) expect(link.lag % step.value.ms).toBe(0);
      }
    },
  );
});
