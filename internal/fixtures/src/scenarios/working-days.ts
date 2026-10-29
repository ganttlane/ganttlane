/**
 * FR-SCH-7: the working-day scenarios of a project plan, as data plus the expected outcome. Plan
 * step 2.4 turns each one into a golden test of the propagation commands.
 *
 * Setup shared by all scenarios: a task of five working days, Monday 2026-04-20 → Friday
 * 2026-04-24, `durationMode: 'working'`, Saturdays and Sundays off, no holidays. Moves skip
 * non-working days and resizes do not (`skipNonWorkingDays`).
 *
 * The Saturday scenarios use Saturday 2026-04-11, a week before the task, so that "accept"
 * (move the start to the next working day, Monday 2026-04-13) is distinguishable from leaving
 * the task untouched.
 */

import { deepFreeze } from '../freeze';
import type { FixtureCalendar, FixtureOptions, FixtureTask } from '../types';

/** A strict date-only string, `'YYYY-MM-DD'`. */
export type IsoDate = `${number}-${number}-${number}`;

/** A user action on the task bar. */
export interface WorkingDayAction {
  /** `move` drags the whole bar; `resize-start` / `resize-end` drag one edge. */
  kind: 'move' | 'resize-start' | 'resize-end';
  /** New start (`move`, `resize-start`) or new inclusive end (`resize-end`). */
  to: IsoDate;
  /**
   * Answer to the "lands on a non-working day" prompt (`onBeforeTaskChange` in the new API):
   * `accept` moves the edge to the next working day, `ignore` keeps it.
   */
  onConflict?: 'accept' | 'ignore';
}

/** One FR-SCH-7 scenario. */
export interface WorkingDayScenario {
  /** Stable kebab-case id, usable in test names. */
  id: string;
  title: string;
  given: {
    task: FixtureTask;
    calendar: FixtureCalendar;
    options?: FixtureOptions;
  };
  action: WorkingDayAction;
  expected: {
    start: IsoDate;
    /** Inclusive last day. */
    end: IsoDate;
    workingDays: number;
    calendarDays: number;
  };
}

/** Mon 2026-04-20 → Fri 2026-04-24: five working days. */
const task: FixtureTask = {
  id: 'task',
  name: 'Five working days (Mon–Fri)',
  start: '2026-04-20',
  end: '2026-04-24',
  durationMode: 'working',
};

const given: WorkingDayScenario['given'] = {
  task,
  calendar: { weekends: [0, 6] },
  options: {
    scheduling: {
      durationMode: 'working',
      skipNonWorkingDays: { move: true, resize: false },
    },
  },
};

/** FR-SCH-7 scenarios (a)–(e), in the order of the requirement. Deep-frozen. */
export const workingDayScenarios: readonly WorkingDayScenario[] = deepFreeze([
  {
    id: 'move-to-previous-friday',
    title: 'Drag the whole task to the previous Friday: the end becomes Thursday',
    given,
    action: { kind: 'move', to: '2026-04-17' },
    expected: { start: '2026-04-17', end: '2026-04-23', workingDays: 5, calendarDays: 7 },
  },
  {
    id: 'resize-start-to-previous-friday',
    title: 'Drag the start to the previous Friday: the end stays Friday, 6 working days',
    given,
    action: { kind: 'resize-start', to: '2026-04-17' },
    expected: { start: '2026-04-17', end: '2026-04-24', workingDays: 6, calendarDays: 8 },
  },
  {
    id: 'resize-end-to-thursday',
    title: 'Drag the end to Thursday: the start stays Monday, 4 working days',
    given,
    action: { kind: 'resize-end', to: '2026-04-23' },
    expected: { start: '2026-04-20', end: '2026-04-23', workingDays: 4, calendarDays: 4 },
  },
  {
    id: 'resize-start-to-saturday-accept',
    title: 'Drag the start to a Saturday and accept: the start moves to Monday',
    given,
    action: { kind: 'resize-start', to: '2026-04-11', onConflict: 'accept' },
    expected: { start: '2026-04-13', end: '2026-04-24', workingDays: 10, calendarDays: 12 },
  },
  {
    id: 'resize-start-to-saturday-ignore',
    title: 'Drag the start to a Saturday and ignore: the start stays on Saturday',
    given,
    action: { kind: 'resize-start', to: '2026-04-11', onConflict: 'ignore' },
    expected: { start: '2026-04-11', end: '2026-04-24', workingDays: 10, calendarDays: 14 },
  },
]);
