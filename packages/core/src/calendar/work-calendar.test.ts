import { describe, expect, it, vi } from 'vitest';

import { asDateTimeMs, asDayKey, type DateTimeMs, DAY, type DayKey, HOUR, MINUTE } from '../time';
import { MAX_DAY_KEY, MIN_DAY_KEY } from './day-index';
import type { CalendarDay, WorkCalendarOptions } from './options';
import { createWorkCalendar, type WorkCalendar } from './work-calendar';

/** `'YYYY-MM-DD'` as a day key. */
function day(iso: string): DayKey {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`bad test date ${iso}`);
  return asDayKey(t / DAY);
}

/** `'YYYY-MM-DDTHH:mm'` as floating time. */
function at(iso: string): DateTimeMs {
  const t = Date.parse(`${iso}Z`);
  if (Number.isNaN(t)) throw new Error(`bad test date ${iso}`);
  return asDateTimeMs(t);
}

/** A day key as `'YYYY-MM-DD'` (or `undefined`). */
function showDay(key: number | undefined): string | undefined {
  return key === undefined ? undefined : new Date(key * DAY).toISOString().slice(0, 10);
}

/** Floating time as `'YYYY-MM-DDTHH:mm'` (or `undefined`). */
function showTime(t: number | undefined): string | undefined {
  return t === undefined ? undefined : new Date(t).toISOString().slice(0, 16);
}

function calendarOf(options?: WorkCalendarOptions): WorkCalendar {
  const { calendar, issues } = createWorkCalendar(options);
  expect(issues).toEqual([]);
  return calendar;
}

// The reference week: Monday 2026-03-02 … Sunday 2026-03-08 (the US DST change).
const MON = '2026-03-02';
const TUE = '2026-03-03';
const WED = '2026-03-04';
const THU = '2026-03-05';
const FRI = '2026-03-06';
const SAT = '2026-03-07';
const SUN = '2026-03-08';
const NEXT_MON = '2026-03-09';

describe('calendar/WorkCalendar', () => {
  describe('FR-CAL-1: weekends', () => {
    it.each([
      ['default [0, 6]', undefined, [MON, TUE, WED, THU, FRI], [SAT, SUN]],
      ['Fri/Sat [5, 6]', [5, 6], [MON, TUE, WED, THU, SUN], [FRI, SAT]],
      ['none []', [], [MON, TUE, WED, THU, FRI, SAT, SUN], []],
      ['only Sunday [0]', [0], [MON, TUE, WED, THU, FRI, SAT], [SUN]],
      ['duplicates [6, 6, 0]', [6, 6, 0], [MON, TUE, WED, THU, FRI], [SAT, SUN]],
    ])('%s', (_name, weekends, working, off) => {
      const calendar = calendarOf(weekends === undefined ? {} : { weekends });
      for (const iso of working) {
        expect(calendar.isWorkingDay(day(iso)), iso).toBe(true);
        expect(calendar.explain(day(iso))).toEqual({ working: true, reason: 'working' });
      }
      for (const iso of off) {
        expect(calendar.isWorkingDay(day(iso)), iso).toBe(false);
        expect(calendar.explain(day(iso))).toEqual({ working: false, reason: 'weekend' });
      }
      expect(calendar.countDays(day(MON), day(NEXT_MON))).toEqual({
        calendar: 7,
        working: working.length,
        nonWorking: off.length,
      });
    });

    it('works without options', () => {
      const { calendar, issues } = createWorkCalendar();
      expect(issues).toEqual([]);
      expect(calendar.isWorkingDay(day(SAT))).toBe(false);
    });
  });

  describe('FR-CAL-2: holidays', () => {
    it.each<[string, WorkCalendarOptions['holidays']]>([
      ['an ISO date string', [WED]],
      ['an ISO date-time string at midnight', [`${WED}T00:00`]],
      ['a local-midnight Date', [new Date(2026, 2, 4)]],
      ['local-midnight epoch milliseconds', [new Date(2026, 2, 4).getTime()]],
      ['{ date } without a name', [{ date: WED }]],
      ['{ date } with an empty name', [{ date: WED, name: '' }]],
      ['{ date, name: undefined }', [{ date: new Date(2026, 2, 4), name: undefined }]],
    ])('accepts %s', (_name, holidays) => {
      const calendar = calendarOf({ holidays });
      expect(calendar.explain(day(WED))).toEqual({ working: false, reason: 'holiday' });
      expect(calendar.isWorkingDay(day(TUE))).toBe(true);
      expect(calendar.countDays(day(MON), day(NEXT_MON)).working).toBe(4);
    });

    it('returns the holiday name as the label', () => {
      const calendar = calendarOf({
        holidays: [
          { date: WED, name: 'Founders Day' },
          { date: new Date(2026, 2, 7), name: 'Sat' },
        ],
      });
      expect(calendar.explain(day(WED))).toEqual({
        working: false,
        reason: 'holiday',
        label: 'Founders Day',
      });
      // A holiday on a weekend is reported as the holiday (holiday > weekends).
      expect(calendar.explain(day(SAT))).toEqual({
        working: false,
        reason: 'holiday',
        label: 'Sat',
      });
    });

    it('keeps the first name of a day listed twice', () => {
      const calendar = calendarOf({
        holidays: [WED, { date: WED, name: 'First' }, { date: WED, name: 'Second' }],
      });
      expect(calendar.explain(day(WED)).label).toBe('First');
    });

    it('returns shared immutable explanations', () => {
      const calendar = calendarOf({ holidays: [{ date: WED, name: 'X' }] });
      expect(calendar.explain(day(WED))).toBe(calendar.explain(day(WED)));
      expect(calendar.explain(day(MON))).toBe(calendar.explain(day(TUE)));
      expect(Object.isFrozen(calendar.explain(day(WED)))).toBe(true);
    });
  });

  describe('FR-CAL-3: priority exception > holiday > custom rule > weekends', () => {
    // Rule: Tuesdays off, Saturdays on, Wednesdays no opinion, Thursdays a non-boolean.
    const rule = (d: CalendarDay): boolean | undefined => {
      if (d.weekday === 2) return false;
      if (d.weekday === 6) return true;
      if (d.weekday === 4) return 1 as unknown as boolean;
      return undefined;
    };

    it.each([
      // [case, options, day, working, reason]
      ['exception on a weekend', { workingDays: [SUN] }, SUN, true, 'exception'],
      ['exception on a holiday', { holidays: [WED], workingDays: [WED] }, WED, true, 'exception'],
      [
        'exception on a day the rule turns off',
        { workingDays: [TUE], isWorkingDay: rule },
        TUE,
        true,
        'exception',
      ],
      [
        'holiday on a day the rule turns on',
        { holidays: [SAT], isWorkingDay: rule },
        SAT,
        false,
        'holiday',
      ],
      ['holiday on a weekend', { holidays: [SUN] }, SUN, false, 'holiday'],
      ['rule false on a weekday', { isWorkingDay: rule }, TUE, false, 'custom'],
      ['rule true on a weekend', { isWorkingDay: rule }, SAT, true, 'custom'],
      ['rule undefined on a weekday', { isWorkingDay: rule }, WED, true, 'working'],
      ['rule undefined on a weekend', { isWorkingDay: rule }, SUN, false, 'weekend'],
      ['a non-boolean verdict is no opinion', { isWorkingDay: rule }, THU, true, 'working'],
      [
        'a non-boolean verdict on a weekend',
        { weekends: [4], isWorkingDay: rule },
        THU,
        false,
        'weekend',
      ],
    ] as const)('%s', (_name, options, iso, working, reason) => {
      const calendar = calendarOf(options);
      expect(calendar.explain(day(iso))).toEqual({ working, reason });
      expect(calendar.isWorkingDay(day(iso))).toBe(working);
    });

    it('asks the rule only for days no stronger rule decides, with the day details', () => {
      const seen: CalendarDay[] = [];
      const calendar = calendarOf({
        holidays: [WED],
        workingDays: [SAT],
        isWorkingDay: (d) => {
          seen.push(d);
          return undefined;
        },
      });
      calendar.countDays(day(MON), day(NEXT_MON));
      const asked = seen.filter((d) => d.dayKey >= day(MON) && d.dayKey < day(NEXT_MON));
      expect(asked.map((d) => showDay(d.dayKey))).toEqual([MON, TUE, THU, FRI, SUN]);
      expect(asked[0]).toEqual({
        dayKey: day(MON),
        date: at(`${MON}T00:00`),
        weekday: 1,
        year: 2026,
        month: 3,
        day: 2,
      });
      expect(asked[4]?.weekday).toBe(0);
    });

    it('caches the rule: at most one call per day for the life of the calendar', () => {
      const rule = vi.fn(() => undefined);
      const calendar = calendarOf({ isWorkingDay: rule });
      const start = day('2026-01-01');
      const end = day('2027-01-01');
      calendar.countDays(start, end);
      const calls = rule.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(365);
      for (let d = start; d < end; d++) calendar.explain(asDayKey(d));
      calendar.countDays(start, end);
      calendar.addWorkingDays(start, 100);
      expect(rule).toHaveBeenCalledTimes(calls);
    });

    it('lets an exception thrown by the rule propagate, then keeps working', () => {
      let fail = true;
      const calendar = calendarOf({
        isWorkingDay: () => {
          if (fail) throw new Error('rule failed');
          return undefined;
        },
      });
      expect(() => calendar.isWorkingDay(day(MON))).toThrow('rule failed');
      fail = false;
      expect(calendar.isWorkingDay(day(MON))).toBe(true);
    });
  });

  describe('FR-CAL-4: countDays over [start, endExclusive)', () => {
    const calendar = calendarOf({ holidays: [WED] });

    it.each([
      [MON, NEXT_MON, 7, 4, 3],
      [MON, SAT, 5, 4, 1],
      [SAT, NEXT_MON, 2, 0, 2],
      [MON, MON, 0, 0, 0],
      [MON, TUE, 1, 1, 0],
      [WED, THU, 1, 0, 1],
      ['2026-01-01', '2027-01-01', 365, 260, 105],
      // Signed: a reversed range is negated.
      [NEXT_MON, MON, -7, -4, -3],
      [THU, WED, -1, 0, -1],
    ])('[%s, %s) → %i calendar, %i working, %i non-working', (a, b, all, working, off) => {
      expect(calendar.countDays(day(a), day(b))).toEqual({
        calendar: all,
        working,
        nonWorking: off,
      });
    });

    it('never yields negative zero', () => {
      const counts = calendar.countDays(day(SUN), day(SAT));
      expect(Object.is(counts.working, 0)).toBe(true);
      expect(Object.is(calendar.countWorkingTime(at(`${SUN}T10:00`), at(`${SAT}T10:00`)), 0)).toBe(
        true,
      );
    });

    it('floors fractional day keys', () => {
      expect(calendar.countDays(asDayKey(day(MON) + 0.5), asDayKey(day(NEXT_MON) + 0.9))).toEqual(
        calendar.countDays(day(MON), day(NEXT_MON)),
      );
      expect(calendar.isWorkingDay(asDayKey(day(SAT) - 0.5))).toBe(true);
    });
  });

  describe('FR-CAL-10: countWorkingTime with partial days', () => {
    const calendar = calendarOf({ holidays: [WED] });

    it.each([
      [`${FRI}T18:00`, `${NEXT_MON}T06:00`, 12 * HOUR],
      [`${MON}T10:00`, `${MON}T14:30`, 4 * HOUR + 30 * MINUTE],
      [`${SAT}T10:00`, `${SUN}T20:00`, 0],
      [`${WED}T00:00`, `${THU}T00:00`, 0],
      [`${TUE}T12:00`, `${THU}T12:00`, 24 * HOUR],
      [`${FRI}T00:00`, `${SAT}T00:00`, 24 * HOUR],
      [`${MON}T00:00`, `${NEXT_MON}T00:00`, 4 * DAY],
      [`${MON}T09:15`, `${MON}T09:15`, 0],
      [`${NEXT_MON}T06:00`, `${FRI}T18:00`, -12 * HOUR],
    ])('[%s, %s) → %i ms', (a, b, expected) => {
      expect(calendar.countWorkingTime(at(a), at(b))).toBe(expected);
    });
  });

  describe('FR-CAL-5: addWorkingDays', () => {
    const calendar = calendarOf({ holidays: ['2026-03-11'] });

    it.each([
      [MON, 1, TUE],
      [FRI, 1, NEXT_MON],
      [SAT, 1, NEXT_MON],
      [SUN, 1, NEXT_MON],
      [MON, -1, '2026-02-27'],
      [SAT, -1, FRI],
      [SUN, -1, FRI],
      [NEXT_MON, -1, FRI],
      [MON, 4, FRI],
      [FRI, 5, '2026-03-16'], // crosses the Wednesday 2026-03-11 holiday
      ['2026-03-16', -5, FRI],
      ['2026-03-10', 1, '2026-03-12'],
      ['2026-03-12', -1, '2026-03-10'],
      [MON, 0, MON],
      [SAT, 0, SAT], // zero leaves a non-working day unchanged
      [MON, 1.9, TUE], // truncated toward zero
      [MON, -1.9, '2026-02-27'],
      [MON, -0.5, MON],
      ['2026-01-01', 259, '2026-12-31'], // 2026 has 260 working days here
      ['2026-01-01', 260, '2027-01-01'],
      ['2026-12-31', -259, '2026-01-01'],
    ])('%s %+d → %s', (start, amount, expected) => {
      expect(showDay(calendar.addWorkingDays(day(start), amount))).toBe(expected);
    });
  });

  describe('FR-CAL-10: addWorkingTime keeps the time of day across non-working days', () => {
    const calendar = calendarOf({ holidays: ['2026-03-11'] });

    it.each([
      [`${FRI}T10:00`, DAY, `${NEXT_MON}T10:00`],
      [`${NEXT_MON}T10:00`, -DAY, `${FRI}T10:00`],
      [`${THU}T09:00`, 3 * DAY, '2026-03-10T09:00'],
      [`${FRI}T10:00`, 14 * HOUR, `${SAT}T00:00`], // reaches the end of Friday and stays there
      [`${FRI}T10:00`, 14 * HOUR + MINUTE, `${NEXT_MON}T00:01`],
      [`${FRI}T00:00`, DAY, `${SAT}T00:00`],
      [`${NEXT_MON}T10:00`, -10 * HOUR, `${NEXT_MON}T00:00`], // stays at the start of Monday
      [`${NEXT_MON}T10:00`, -10 * HOUR - MINUTE, `${FRI}T23:59`],
      [`${NEXT_MON}T00:00`, -DAY, `${FRI}T00:00`],
      [`${SAT}T10:00`, 2 * HOUR, `${NEXT_MON}T02:00`], // accrues from Monday 00:00
      [`${SAT}T10:00`, -2 * HOUR, `${FRI}T22:00`],
      [`${SAT}T00:00`, DAY, '2026-03-10T00:00'],
      [`${SUN}T10:00`, 0, `${SUN}T10:00`],
      [`${FRI}T23:00`, 90 * MINUTE, `${NEXT_MON}T00:30`],
      [`${NEXT_MON}T00:30`, -90 * MINUTE, `${FRI}T23:00`],
      ['2026-03-10T12:00', DAY, '2026-03-12T12:00'], // skips the Wednesday holiday
      [`${MON}T09:00`, 5 * DAY, `${NEXT_MON}T09:00`],
    ])('%s %+d ms → %s', (start, ms, expected) => {
      const result = calendar.addWorkingTime(at(start), ms);
      expect(showTime(result)).toBe(expected);
      expect(calendar.countWorkingTime(at(start), result!)).toBe(ms);
    });
  });

  describe('FR-CAL-5: nextWorkingDay / prevWorkingDay', () => {
    const calendar = calendarOf({ holidays: [MON] });

    it.each([
      ['next', FRI, false, NEXT_MON],
      ['next', FRI, true, FRI],
      ['next', SAT, true, NEXT_MON],
      ['next', SAT, false, NEXT_MON],
      ['next', '2026-03-01', true, TUE], // Sunday, then the Monday holiday
      ['prev', NEXT_MON, false, FRI],
      ['prev', NEXT_MON, true, NEXT_MON],
      ['prev', SUN, true, FRI],
      ['prev', TUE, false, '2026-02-27'], // skips the Monday holiday and the weekend
    ] as const)('%s from %s (inclusive: %s) → %s', (direction, start, inclusive, expected) => {
      const search = direction === 'next' ? calendar.nextWorkingDay : calendar.prevWorkingDay;
      expect(showDay(search(day(start), { inclusive }))).toBe(expected);
    });

    it('is exclusive by default', () => {
      expect(showDay(calendar.nextWorkingDay(day(TUE)))).toBe(WED);
      expect(showDay(calendar.prevWorkingDay(day(WED)))).toBe(TUE);
    });
  });

  describe('FR-SCH-4, FR-SNAP-8: rollToWorking (the shared skip-non-working-days rule)', () => {
    const calendar = calendarOf();
    const NEXT_TUE = '2026-03-10';

    it.each([
      // A start: the day of `t` decides.
      ['start', 1, true, `${SAT}T10:00`, `${NEXT_MON}T10:00`],
      ['start', -1, true, `${SAT}T10:00`, `${FRI}T10:00`],
      ['start', 1, false, `${SAT}T10:00`, `${NEXT_MON}T00:00`],
      ['start', -1, false, `${SUN}T10:00`, `${FRI}T00:00`],
      ['start', 1, false, `${SAT}T00:00`, `${NEXT_MON}T00:00`],
      ['start', 1, false, `${FRI}T10:00`, `${FRI}T10:00`],
      ['start', -1, true, `${NEXT_MON}T00:00`, `${NEXT_MON}T00:00`],
      // An exclusive end: the day of `t - 1 ms` decides.
      ['end', -1, false, `${SAT}T00:00`, `${SAT}T00:00`], // Friday's end
      ['end', -1, false, `${SUN}T10:00`, `${SAT}T00:00`],
      ['end', -1, false, `${NEXT_MON}T00:00`, `${SAT}T00:00`], // ends on Sunday
      ['end', 1, false, `${SUN}T10:00`, `${NEXT_TUE}T00:00`],
      ['end', -1, true, `${SUN}T00:00`, `${SAT}T00:00`],
      ['end', 1, true, `${SUN}T00:00`, `${NEXT_TUE}T00:00`],
      ['end', -1, true, `${SUN}T10:00`, `${FRI}T10:00`],
      // A boundary: only the inside of the stretch moves, to its edges.
      ['boundary', 1, false, `${SAT}T00:00`, `${SAT}T00:00`],
      ['boundary', -1, false, `${SAT}T00:00`, `${SAT}T00:00`],
      ['boundary', 1, false, `${NEXT_MON}T00:00`, `${NEXT_MON}T00:00`],
      ['boundary', -1, false, `${NEXT_MON}T00:00`, `${NEXT_MON}T00:00`],
      ['boundary', 1, false, `${SUN}T00:00`, `${NEXT_MON}T00:00`],
      ['boundary', -1, false, `${SUN}T00:00`, `${SAT}T00:00`],
      ['boundary', 1, false, `${SAT}T10:00`, `${NEXT_MON}T00:00`],
      ['boundary', -1, false, `${SUN}T10:00`, `${SAT}T00:00`],
    ] as const)('%s, direction %d, keepTimeOfDay %s: %s → %s', (edge, dir, keep, t, expected) => {
      const rolled = calendar.rollToWorking(at(t), dir, { edge, keepTimeOfDay: keep });
      expect(showTime(rolled)).toBe(expected);
    });

    it("defaults to a 'start' that lands on midnight", () => {
      expect(showTime(calendar.rollToWorking(at(`${SUN}T10:00`), 1))).toBe(`${NEXT_MON}T00:00`);
    });

    it('returns undefined without a working day in that direction or for bad input', () => {
      const { calendar: none } = createWorkCalendar({ weekends: [0, 1, 2, 3, 4, 5, 6] });
      expect(none.rollToWorking(at(`${MON}T10:00`), 1)).toBeUndefined();
      expect(none.rollToWorking(at(`${MON}T10:00`), -1, { edge: 'end' })).toBeUndefined();
      expect(calendar.rollToWorking(asDateTimeMs(NaN), 1)).toBeUndefined();
      expect(calendar.rollToWorking(asDateTimeMs(Infinity), -1)).toBeUndefined();
    });

    it('skips holidays as well as weekends', () => {
      const withHoliday = calendarOf({ holidays: [NEXT_MON] });
      const rolled = withHoliday.rollToWorking(at(`${SAT}T09:00`), 1, { keepTimeOfDay: true });
      expect(showTime(rolled)).toBe(`${NEXT_TUE}T09:00`);
    });
  });

  describe('legacy inclusive helpers (fork semantics for durationMode "working")', () => {
    const plain = calendarOf();
    const withHoliday = calendarOf({ holidays: [WED] });

    it.each([
      [plain, MON, SUN, 5],
      [plain, MON, FRI, 5],
      [plain, MON, MON, 1],
      [plain, SAT, SUN, 0],
      [plain, SAT, NEXT_MON, 1],
      [plain, TUE, MON, 0], // end before start
      [withHoliday, MON, FRI, 4],
      [withHoliday, WED, WED, 0],
    ])('countWorkingDaysInclusive #%#', (calendar, start, end, expected) => {
      expect(calendar.countWorkingDaysInclusive(day(start), day(end))).toBe(expected);
    });

    it.each([
      [plain, MON, 5, FRI],
      [plain, SAT, 1, NEXT_MON],
      [plain, SUN, 1, NEXT_MON],
      [plain, FRI, 2, NEXT_MON],
      [plain, FRI, 1, FRI],
      [plain, MON, 1, MON],
      [plain, MON, 6, NEXT_MON],
      [plain, MON, 0, MON],
      [plain, SAT, 0, SAT], // n <= 0 returns the start, even a non-working one
      [plain, MON, -3, MON],
      [plain, MON, 2.5, WED], // rounded up: the walk stops once 2.5 days are counted
      [withHoliday, MON, 5, NEXT_MON], // the Wednesday holiday shifts the end by one working day
      [withHoliday, WED, 1, THU],
    ])('workingSpanEnd #%#', (calendar, start, n, expected) => {
      const end = calendar.workingSpanEnd(day(start), n);
      expect(showDay(end)).toBe(expected);
      if (n >= 1) expect(calendar.countWorkingDaysInclusive(day(start), end!)).toBe(Math.ceil(n));
    });
  });

  describe('DST transition days are ordinary 24 h days (floating time)', () => {
    // US: 2026-03-08 (Sunday), EU: 2026-03-29 (Sunday).
    const everyDay = calendarOf({ weekends: [] });

    it.each(['2026-03-08', '2026-03-29', '2026-11-01', '2026-10-25'])('%s', (iso) => {
      const start = at(`${iso}T00:00`);
      expect(everyDay.countWorkingTime(start, asDateTimeMs(start + DAY))).toBe(DAY);
      expect(everyDay.countWorkingTime(at(`${iso}T01:30`), at(`${iso}T03:30`))).toBe(2 * HOUR);
      expect(showTime(everyDay.addWorkingTime(at(`${iso}T01:30`), HOUR))).toBe(`${iso}T02:30`);
      expect(showTime(everyDay.addWorkingTime(asDateTimeMs(start - 2 * HOUR), DAY))).toBe(
        showTime(start + DAY - 2 * HOUR),
      );
    });

    it('takes holidays given as local Dates on DST days at face value', () => {
      const calendar = calendarOf({
        weekends: [],
        holidays: [new Date(2026, 2, 8), new Date(2026, 2, 29)],
      });
      expect(calendar.isWorkingDay(day('2026-03-08'))).toBe(false);
      expect(calendar.isWorkingDay(day('2026-03-29'))).toBe(false);
      expect(calendar.countDays(day('2026-03-01'), day('2026-04-01')).working).toBe(29);
      expect(showDay(calendar.addWorkingDays(day('2026-03-07'), 1))).toBe('2026-03-09');
    });
  });

  describe('no working day to reach', () => {
    it('a full-week weekend without exceptions returns undefined', () => {
      const { calendar, issues } = createWorkCalendar({ weekends: [0, 1, 2, 3, 4, 5, 6] });
      expect(issues.map((issue) => issue.code)).toEqual(['no-working-days']);
      const mon = day(MON);
      expect(calendar.nextWorkingDay(mon)).toBeUndefined();
      expect(calendar.prevWorkingDay(mon, { inclusive: true })).toBeUndefined();
      expect(calendar.addWorkingDays(mon, 3)).toBeUndefined();
      expect(calendar.addWorkingDays(mon, -3)).toBeUndefined();
      expect(calendar.addWorkingTime(at(`${MON}T10:00`), HOUR)).toBeUndefined();
      expect(calendar.addWorkingTime(at(`${MON}T10:00`), -HOUR)).toBeUndefined();
      expect(calendar.workingSpanEnd(mon, 1)).toBeUndefined();
      expect(calendar.countDays(mon, day(NEXT_MON)).working).toBe(0);
      expect(calendar.countWorkingTime(at(`${MON}T10:00`), at(`${FRI}T10:00`))).toBe(0);
    });

    it('a custom rule that rejects every day returns undefined (and terminates)', () => {
      const calendar = calendarOf({ isWorkingDay: () => false });
      expect(calendar.nextWorkingDay(day(MON))).toBeUndefined();
      expect(calendar.addWorkingDays(day(MON), -1)).toBeUndefined();
    });

    it('finds the only working days of a full-week weekend, and nothing beyond them', () => {
      const calendar = calendarOf({
        weekends: [0, 1, 2, 3, 4, 5, 6],
        workingDays: ['2026-01-05', '2026-06-01'],
      });
      expect(showDay(calendar.nextWorkingDay(day('2025-12-01')))).toBe('2026-01-05');
      expect(showDay(calendar.addWorkingDays(day('2025-12-01'), 2))).toBe('2026-06-01');
      expect(calendar.addWorkingDays(day('2025-12-01'), 3)).toBeUndefined();
      expect(showDay(calendar.prevWorkingDay(day('2027-01-01')))).toBe('2026-06-01');
      expect(calendar.prevWorkingDay(day('2026-01-05'))).toBeUndefined();
      expect(showTime(calendar.addWorkingTime(at('2026-01-05T20:00'), 6 * HOUR))).toBe(
        '2026-06-01T02:00',
      );
    });

    it('crosses non-working runs shorter than 100 years', () => {
      const calendar = calendarOf({
        weekends: [0, 1, 2, 3, 4, 5, 6],
        workingDays: ['2026-01-05', '2120-01-06'],
      });
      expect(showDay(calendar.nextWorkingDay(day('2026-01-05')))).toBe('2120-01-06');
      expect(showDay(calendar.prevWorkingDay(day('2120-01-06')))).toBe('2026-01-05');
      expect(calendar.countDays(day('2026-01-01'), day('2121-01-01')).working).toBe(2);
    });
  });

  describe('outside the calendar', () => {
    const calendar = calendarOf();
    const outside = [NaN, Infinity, -Infinity, MAX_DAY_KEY + 2, MIN_DAY_KEY - 1].map(asDayKey);

    it.each(outside)('day key %d', (key) => {
      const mon = day(MON);
      expect(calendar.isWorkingDay(key)).toBe(false);
      expect(calendar.explain(key)).toEqual({ working: false, reason: 'custom' });
      expect(calendar.countDays(key, mon).working).toBeNaN();
      expect(calendar.countDays(mon, key).calendar).toBeNaN();
      expect(calendar.countWorkingDaysInclusive(key, mon)).toBeNaN();
      expect(calendar.addWorkingDays(key, 1)).toBeUndefined();
      expect(calendar.nextWorkingDay(key)).toBeUndefined();
      expect(calendar.prevWorkingDay(key)).toBeUndefined();
      expect(calendar.workingSpanEnd(key, 1)).toBeUndefined();
      expect(calendar.countWorkingTime(asDateTimeMs(key * DAY), at(`${MON}T00:00`))).toBeNaN();
      expect(calendar.addWorkingTime(asDateTimeMs(key * DAY), HOUR)).toBeUndefined();
    });

    it('rejects non-finite amounts', () => {
      const mon = day(MON);
      expect(calendar.addWorkingDays(mon, NaN)).toBeUndefined();
      expect(calendar.addWorkingDays(mon, Infinity)).toBeUndefined();
      expect(calendar.workingSpanEnd(mon, NaN)).toBeUndefined();
      expect(calendar.workingSpanEnd(mon, Infinity)).toBeUndefined();
      expect(calendar.addWorkingTime(at(`${MON}T00:00`), NaN)).toBeUndefined();
      expect(calendar.addWorkingTime(at(`${MON}T00:00`), -Infinity)).toBeUndefined();
    });

    it('stops at the ends of the Date range', () => {
      const max = asDayKey(MAX_DAY_KEY);
      const min = asDayKey(MIN_DAY_KEY);
      expect(calendar.nextWorkingDay(max)).toBeUndefined();
      expect(calendar.prevWorkingDay(min)).toBeUndefined();
      expect(calendar.addWorkingDays(day(MON), 1e12)).toBeUndefined();
      expect(calendar.addWorkingDays(day(MON), -1e12)).toBeUndefined();
      // The last days before the end are still found.
      const lastWorking = calendar.prevWorkingDay(max, { inclusive: true })!;
      expect(lastWorking).toBeGreaterThan(MAX_DAY_KEY - 3);
      expect(calendar.nextWorkingDay(asDayKey(lastWorking))).toBeUndefined();
      expect(
        calendar.countDays(asDayKey(MAX_DAY_KEY - 6), asDayKey(MAX_DAY_KEY + 1)).calendar,
      ).toBe(7);
    });
  });

  describe('FR-CAL-7: immutability', () => {
    it('copies its options and never mutates them', () => {
      const holidays = [WED];
      const weekends = [0, 6];
      const options = Object.freeze({
        weekends: Object.freeze(weekends),
        holidays: Object.freeze(holidays),
        workingDays: Object.freeze([SAT]),
      });
      const { calendar } = createWorkCalendar(options);
      expect(calendar.isWorkingDay(day(WED))).toBe(false);
      expect(Object.isFrozen(calendar)).toBe(true);
    });

    it('is unaffected by later changes to the option arrays', () => {
      const holidays: string[] = [WED];
      const weekends = [0, 6];
      const calendar = calendarOf({ holidays, weekends });
      holidays.push(THU);
      weekends.push(1);
      expect(calendar.isWorkingDay(day(THU))).toBe(true);
      expect(calendar.isWorkingDay(day(MON))).toBe(true);
    });

    it('a new calendar gives new answers; the old one keeps its own', () => {
      const before = calendarOf();
      const range = [day(MON), day(NEXT_MON)] as const;
      expect(before.countDays(...range).working).toBe(5);
      const after = calendarOf({ holidays: [WED, THU] });
      expect(after.countDays(...range).working).toBe(3);
      expect(before.countDays(...range).working).toBe(5);
    });

    it('methods work detached from the calendar', () => {
      const { isWorkingDay } = calendarOf();
      expect([day(FRI), day(SAT), day(SUN), day(NEXT_MON)].filter(isWorkingDay)).toEqual([
        day(FRI),
        day(NEXT_MON),
      ]);
    });
  });
});
