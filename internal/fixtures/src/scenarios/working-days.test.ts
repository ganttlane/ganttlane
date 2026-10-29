import { describe, expect, it } from 'vitest';

import { addDays, countCalendarDays, countWorkingDays, weekday } from '../dates';
import { workingDayScenarios } from './working-days';

const MONDAY = 1;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;

const byId = (id: string) => {
  const scenario = workingDayScenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`No scenario ${id}`);
  return scenario;
};

describe('FR-SCH-7 working-day scenarios', () => {
  it('FR-SCH-7: has the five scenarios (a)–(e) with unique ids', () => {
    expect(workingDayScenarios.map((scenario) => scenario.id)).toEqual([
      'move-to-previous-friday',
      'resize-start-to-previous-friday',
      'resize-end-to-thursday',
      'resize-start-to-saturday-accept',
      'resize-start-to-saturday-ignore',
    ]);
  });

  it('FR-SCH-7: starts from a Monday–Friday task of five working days', () => {
    for (const { given } of workingDayScenarios) {
      const { start, end, durationMode } = given.task;
      expect(durationMode).toBe('working');
      expect(weekday(String(start))).toBe(MONDAY);
      expect(weekday(String(end))).toBe(FRIDAY);
      expect(countWorkingDays(String(start), String(end), given.calendar)).toBe(5);
      expect(given.calendar.weekends).toEqual([0, 6]);
    }
  });

  it('FR-SCH-7 (a): the whole task moves to the previous Friday and ends on Thursday', () => {
    const { given, action, expected } = byId('move-to-previous-friday');
    expect(action).toEqual({ kind: 'move', to: addDays(String(given.task.start), -3) });
    expect(weekday(action.to)).toBe(FRIDAY);
    expect(weekday(expected.end)).toBe(THURSDAY);
  });

  it('FR-SCH-7 (b): the start moves to the previous Friday, the end stays Friday', () => {
    const { given, action, expected } = byId('resize-start-to-previous-friday');
    expect(action.kind).toBe('resize-start');
    expect(weekday(action.to)).toBe(FRIDAY);
    expect(action.to).toBe(addDays(String(given.task.start), -3));
    expect(expected.end).toBe(given.task.end);
    expect(expected.workingDays).toBe(6);
  });

  it('FR-SCH-7 (c): the end moves to Thursday, the start stays Monday', () => {
    const { given, action, expected } = byId('resize-end-to-thursday');
    expect(action.kind).toBe('resize-end');
    expect(weekday(action.to)).toBe(THURSDAY);
    expect(expected.start).toBe(given.task.start);
    expect(expected.workingDays).toBe(4);
  });

  it('FR-SCH-7 (d): a Saturday start, accepted, moves to the following Monday', () => {
    const { action, expected } = byId('resize-start-to-saturday-accept');
    expect(action).toMatchObject({ kind: 'resize-start', onConflict: 'accept' });
    expect(weekday(action.to)).toBe(SATURDAY);
    expect(expected.start).toBe(addDays(action.to, 2));
    expect(weekday(expected.start)).toBe(MONDAY);
  });

  it('FR-SCH-7 (e): a Saturday start, ignored, stays on Saturday', () => {
    const { action, expected } = byId('resize-start-to-saturday-ignore');
    expect(action).toMatchObject({ kind: 'resize-start', onConflict: 'ignore' });
    expect(weekday(action.to)).toBe(SATURDAY);
    expect(expected.start).toBe(action.to);
  });

  it('FR-SCH-7: expected day counts agree with the calendar', () => {
    for (const { id, given, expected } of workingDayScenarios) {
      expect([id, countWorkingDays(expected.start, expected.end, given.calendar)]).toEqual([
        id,
        expected.workingDays,
      ]);
      expect([id, countCalendarDays(expected.start, expected.end)]).toEqual([
        id,
        expected.calendarDays,
      ]);
    }
  });

  it('FR-DATA-1: is deep-frozen', () => {
    expect(Object.isFrozen(workingDayScenarios)).toBe(true);
    expect(Object.isFrozen(workingDayScenarios[0]?.given.task)).toBe(true);
  });
});
