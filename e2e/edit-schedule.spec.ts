import { expect, test } from '@playwright/test';

// Specs run in Node; the root package does not depend on @ganttlane/fixtures, so import its source.
import { workingDayScenarios } from '../internal/fixtures/src/index';
import {
  boxOf,
  centre,
  changeOf,
  type ChangeSetRecord,
  changesOf,
  committed,
  DAY,
  drag,
  handle,
  HOUR,
  MINUTE,
  openEdit,
  pxPerDay,
  settled,
  track,
  trackErrors,
  utc,
} from './edit-harness';

/**
 * E2E of plan step 4.7 (FR-SCH-7, FR-SNAP-*, FR-SNAP-12): what a drag does to the dates, with the
 * real mouse in Chromium, Firefox and WebKit: the working-day scenarios of a project plan,
 * snapping in the hour modes, day-precision tasks among timed ones, and the invariant that every
 * date a drag reports is a multiple of `scheduling.granularity`.
 */

// The hour modes draw 960 px a day: room for a chart of 1500 px.
test.use({ viewport: { width: 1700, height: 900 } });

test.describe('FR-SCH-7: the working-day scenarios by drag', () => {
  for (const scenario of workingDayScenarios) {
    const { task, calendar, options } = scenario.given;
    const { kind, to, onConflict } = scenario.action;
    // "auto": the edge lands where the rules put it; "manual": a before-hook is asked what to do
    // with an edge that lands on a non-working day, and answers `accept` or `ignore`.
    const mode = onConflict === undefined ? 'auto' : `manual (${onConflict})`;

    test(`FR-SCH-7: ${mode}: ${scenario.title}`, async ({ page }) => {
      const errors = trackErrors(page);
      await openEdit(page, {
        tasks: [task],
        calendar,
        ...options,
        viewMode: 'day',
        timeline: { range: { start: '2026-04-01', end: '2026-05-01' } },
        scroll: { initial: 'start' },
        today: '2026-04-14',
        width: 1000,
        ...(onConflict && { answer: onConflict }),
      });
      const px = await pxPerDay(page);
      const grab =
        kind === 'move'
          ? centre(await boxOf(track(page, 'task')))
          : centre(await boxOf(handle(page, 'task', kind)));
      // The edge in hand now, and where the scenario wants it ("end" is the last day: inclusive).
      const edge = kind === 'resize-end' ? utc(String(task.end)) + DAY : utc(String(task.start));
      const wanted = kind === 'resize-end' ? utc(to) + DAY : utc(to);
      const dx = Math.round(((wanted - edge) / DAY) * px);

      await drag(page, grab, { x: grab.x + dx, y: grab.y }, 12);

      const changeSet = await committed(page);
      expect(changeSet.reason).toBe(kind);
      // The change set's values are the core's floating time; the record's `Date`s are local.
      const change = changeOf(changeSet, 'task');
      const durations = await page.evaluate(() => {
        const hook = (window as unknown as { __ganttEdit: { core: unknown } }).__ganttEdit;
        const core = hook.core as {
          getTask(
            id: string,
          ): { duration: { workingDays: number; calendarDays: number } } | undefined;
        };
        const found = core.getTask('task');
        if (found === undefined) throw new Error('the task is gone');
        return {
          workingDays: found.duration.workingDays,
          calendarDays: found.duration.calendarDays,
        };
      });
      const { expected } = scenario;
      expect({
        start: change.after.start,
        endExclusive: change.after.endExclusive,
        ...durations,
      }).toEqual({
        start: utc(expected.start),
        // `expected.end` is the last day, inclusive.
        endExclusive: utc(expected.end) + DAY,
        workingDays: expected.workingDays,
        calendarDays: expected.calendarDays,
      });
      expect(errors).toEqual([]);
    });
  }
});

/** Every date of a change set is a multiple of `step` ms. */
function misaligned(changeSets: readonly ChangeSetRecord[], step: number): number[] {
  return changeSets.flatMap(({ changes }) =>
    changes.flatMap(({ before, after }) =>
      [before.start, before.endExclusive, after.start, after.endExclusive].filter(
        (value) => value % step !== 0,
      ),
    ),
  );
}

/** A timed two-hour task and a whole-day task, for the hour modes. */
const MIXED_TASKS = [
  { id: 't', name: 'Timed', start: '2026-03-02T09:00', end: '2026-03-02T11:00' },
  { id: 'd', name: 'Day', start: '2026-03-02', end: '2026-03-02' },
] as const;

/** Five days of range, scrolled to four hours before the day task: every bar and handle shows. */
const hourChart = (scheduling: Record<string, unknown>, viewMode = 'hour') => ({
  tasks: MIXED_TASKS,
  viewMode,
  calendar: { weekends: [] },
  scheduling,
  timeline: { range: { start: '2026-03-01', end: '2026-03-06' } },
  scroll: { initial: '2026-03-01T20:00' },
  today: '2026-03-02',
  width: 1500,
});

test.describe('snap in the hour modes (FR-SNAP-1 … FR-SNAP-6, FR-SNAP-12, FR-SNAP-14)', () => {
  test('FR-SNAP-5: the hour mode snaps to 15 minutes, with a granularity of 15 minutes', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '15min' }));
    expect(await pxPerDay(page)).toBe(960);
    const from = centre(await boxOf(track(page, 't')));

    // 17 px are 25.5 minutes: the nearest quarter of an hour is 30 minutes.
    await drag(page, from, { x: from.x + 17, y: from.y });
    const first = await committed(page);
    expect(first.reason).toBe('move');
    const change = changeOf(first, 't');
    expect(change.after.start - change.before.start).toBe(30 * MINUTE);
    expect(change.after.endExclusive - change.before.endExclusive).toBe(30 * MINUTE);
    expect(change.after.precision).toBeUndefined();

    // 10 px are exactly 15 minutes, backwards; 4 px are 6 minutes: not even one step.
    const moved = centre(await boxOf(track(page, 't')));
    await drag(page, moved, { x: moved.x - 10, y: moved.y });
    await expect.poll(async () => (await changesOf(page)).length).toBe(2);
    const second = changeOf((await changesOf(page))[1]!, 't');
    expect(second.before.start - second.after.start).toBe(15 * MINUTE);
    const again = centre(await boxOf(track(page, 't')));
    await drag(page, again, { x: again.x + 4, y: again.y });
    await settled(page);
    expect(await changesOf(page)).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test('FR-SNAP-6: a resize snaps its edge, and never makes the task shorter than one step', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '15min' }));
    const end = centre(await boxOf(handle(page, 't', 'resize-end')));

    await drag(page, end, { x: end.x + 17, y: end.y });
    const grown = changeOf(await committed(page), 't');
    expect(grown.after.endExclusive - grown.before.endExclusive).toBe(30 * MINUTE);
    expect(grown.after.start).toBe(grown.before.start);

    // Dragging the end far past the start leaves one step, not zero or less.
    const shrink = centre(await boxOf(handle(page, 't', 'resize-end')));
    await drag(page, shrink, { x: shrink.x - 400, y: shrink.y });
    await expect.poll(async () => (await changesOf(page)).length).toBe(2);
    const shrunk = changeOf((await changesOf(page))[1]!, 't');
    expect(shrunk.after.endExclusive - shrunk.after.start).toBe(15 * MINUTE);
    expect(errors).toEqual([]);
  });

  test('FR-SNAP-14: a granularity of one hour raises the 15-minute step of the hour mode to an hour', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '1h' }));
    const from = centre(await boxOf(track(page, 't')));

    // 17 px are 25.5 minutes: below half a step. 33 px are 49.5 minutes: one hour.
    await drag(page, from, { x: from.x + 17, y: from.y });
    await settled(page);
    expect(await changesOf(page)).toEqual([]);
    await drag(page, from, { x: from.x + 33, y: from.y });

    const change = changeOf(await committed(page), 't');
    expect(change.after.start - change.before.start).toBe(HOUR);
    expect(misaligned(await changesOf(page), HOUR)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-SNAP-1: an explicit snap of one hour in the hour mode, with a granularity of 15 minutes', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '15min', snap: '1h' }));
    const from = centre(await boxOf(track(page, 't')));

    // 33 px are 49.5 minutes: the grid has an hour step now.
    await drag(page, from, { x: from.x + 33, y: from.y });

    const change = changeOf(await committed(page), 't');
    expect(change.after.start).toBe(utc('2026-03-02T10:00'));
    expect(errors).toEqual([]);
  });

  test('FR-SNAP-5: the quarter-day mode snaps to an hour with a granularity of an hour', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '1h' }, 'quarter-day'));
    expect(await pxPerDay(page)).toBe(160);
    const from = centre(await boxOf(track(page, 't')));

    // An hour is 6.7 px: 27 px are 4.05 hours.
    await drag(page, from, { x: from.x + 27, y: from.y });

    const change = changeOf(await committed(page), 't');
    expect(change.after.start - change.before.start).toBe(4 * HOUR);
    expect(errors).toEqual([]);
  });
});

test.describe('day precision in the hour modes (FR-SNAP-7, FR-TIME-6)', () => {
  test('FR-SNAP-7: a whole-day task stays on whole days, however fine the snap is', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '15min' }));
    const from = centre(await boxOf(track(page, 'd')));

    // Half a day (480 px minus a little): the step of a day-precision task is a day, so a drag
    // that is not past half of it does nothing, one that is moves it a whole day.
    await drag(page, from, { x: from.x + 400, y: from.y });
    await settled(page);
    expect(await changesOf(page)).toEqual([]);

    await drag(page, from, { x: from.x + 500, y: from.y });
    const change = changeOf(await committed(page), 'd');
    expect(change.after.start - change.before.start).toBe(DAY);
    expect(change.after.start % DAY).toBe(0);
    expect(change.after.endExclusive % DAY).toBe(0);
    expect(change.after.precision).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('FR-SNAP-7: resizing a whole-day task also moves its end by whole days', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '15min' }));
    const end = centre(await boxOf(handle(page, 'd', 'resize-end')));

    await drag(page, end, { x: end.x + 500, y: end.y });

    const change = changeOf(await committed(page), 'd');
    expect(change.after.endExclusive - change.before.endExclusive).toBe(DAY);
    expect(change.after.start).toBe(change.before.start);
    expect(change.after.endExclusive % DAY).toBe(0);
    expect(errors).toEqual([]);
  });

  test('FR-SNAP-7: with keepDayPrecision false a drag makes the task a timed one', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, hourChart({ granularity: '15min', keepDayPrecision: false }));
    const from = centre(await boxOf(track(page, 'd')));

    // 300 px are 7.5 hours: the 15-minute step applies.
    await drag(page, from, { x: from.x + 300, y: from.y });

    const change = changeOf(await committed(page), 'd');
    expect(change.after.start - change.before.start).toBe(7.5 * HOUR);
    expect(change.after.start % DAY).not.toBe(0);
    expect(change.before.precision).toBe('day');
    expect(change.after.precision).toBe('time');
    const precision = await page.evaluate(() => {
      const hook = (window as unknown as { __ganttEdit: { core: unknown } }).__ganttEdit;
      const core = hook.core as { getTask(id: string): { precision: string } | undefined };
      return core.getTask('d')?.precision;
    });
    expect(precision).toBe('time');
    expect(errors).toEqual([]);
  });
});

test.describe('granularity (FR-SNAP-12, FR-SNAP-13)', () => {
  for (const granularity of ['15min', '1h'] as const) {
    const step = granularity === '1h' ? HOUR : 15 * MINUTE;

    test(`FR-SNAP-12: after any drag every date reported is a multiple of ${granularity}`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openEdit(page, hourChart({ granularity }));
      // Odd distances on purpose: none of them is a multiple of anything.
      const gestures = [
        { part: 'body', dx: 13 },
        { part: 'resize-end', dx: 101 },
        { part: 'resize-start', dx: -39 },
        { part: 'body', dx: -7 },
        { part: 'resize-end', dx: -58 },
        { part: 'resize-start', dx: 23 },
        { part: 'body', dx: 71 },
        { part: 'progress', dx: 29 },
      ] as const;

      for (const task of ['t', 'd']) {
        for (const { part, dx } of gestures) {
          const from =
            part === 'body'
              ? centre(await boxOf(track(page, task)))
              : centre(await boxOf(handle(page, task, part)));
          await drag(page, from, { x: from.x + dx, y: from.y }, 6);
          await settled(page);
        }
      }

      const changeSets = await changesOf(page);
      // Some of the drags are below the step and change nothing, but enough are not.
      expect(changeSets.length).toBeGreaterThanOrEqual(6);
      expect(misaligned(changeSets, step)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
