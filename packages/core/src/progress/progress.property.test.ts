import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar, type WorkCalendar } from '../calendar';
import {
  alignFloor,
  asDateTimeMs,
  type Granularity,
  isAligned,
  MINUTE,
  parseGranularity,
  toDayKey,
} from '../time';
import {
  dateToProgress,
  type ProgressAnchor,
  type ProgressBounds,
  progressFromDate,
  type ProgressSpan,
  progressToDate,
  rebaseProgress,
} from './index';

function step(input: string): Granularity {
  const parsed = parseGranularity(input);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

const GRANULARITIES: readonly Granularity[] = ['1min', '15min', '1h', '6h', '1d'].map(step);
const CALENDARS: readonly WorkCalendar[] = [
  createWorkCalendar({ weekends: [0, 6], holidays: ['2026-01-14', '2026-02-02'] }).calendar,
  createWorkCalendar({ weekends: [] }).calendar,
  createWorkCalendar({ weekends: [0, 5, 6] }).calendar,
];
// Monday 2026-01-05.
const BASE = Date.UTC(2026, 0, 5);

interface Case {
  readonly span: ProgressSpan;
  readonly granularity: Granularity;
}

/** A span aligned to its granularity, often zero-length, spread over a few weeks. */
const caseArb: fc.Arbitrary<Case> = fc
  .record({
    granularity: fc.constantFrom(...GRANULARITIES),
    calendar: fc.constantFrom(...CALENDARS),
    mode: fc.constantFrom('calendar' as const, 'working' as const),
    startMinutes: fc.integer({ min: 0, max: 60 * 24 * 40 }),
    lengthMinutes: fc.oneof(
      fc.constant(0),
      fc.integer({ min: 1, max: 60 * 24 * 3 }),
      fc.integer({ min: 1, max: 60 * 24 * 30 }),
    ),
  })
  .map(({ granularity, calendar, mode, startMinutes, lengthMinutes }) => {
    const g = granularity.ms;
    const start = asDateTimeMs(Math.floor((BASE + startMinutes * MINUTE) / g) * g);
    const length = Math.floor((lengthMinutes * MINUTE) / g) * g;
    return {
      span: { start, endExclusive: asDateTimeMs(start + length), mode, calendar },
      granularity,
    };
  });

const progressArb = fc.oneof(
  fc.double({ min: -20, max: 120, noNaN: true }),
  fc.constantFrom(0, 100, 100 / 3, 200 / 3, 50),
);
const directionArb = fc.constantFrom(-1 as const, 0 as const, 1 as const);

/** What progress measures along the span: working time, or calendar time as the fallback. */
function measure(span: ProgressSpan): number {
  const length = span.endExclusive - span.start;
  if (span.mode !== 'working') return length;
  const working = span.calendar.countWorkingTime(span.start, span.endExclusive);
  return working > 0 ? working : length;
}

const clampProgress = (p: number): number => (p > 0 ? Math.min(p, 100) : 0);

/** Whether `t` lies strictly inside a non-working stretch (neither of its edges). */
function insideNonWorking(t: number, calendar: WorkCalendar): boolean {
  const day = toDayKey(asDateTimeMs(t));
  const before = toDayKey(asDateTimeMs(t - 1));
  return !calendar.isWorkingDay(day) && !calendar.isWorkingDay(before);
}

describe('progress: properties', () => {
  it('FR-PROG-1, FR-SNAP-15: progressToDate → dateToProgress loses less than one granularity step', () => {
    fc.assert(
      fc.property(caseArb, progressArb, ({ span, granularity }, progress) => {
        const date = progressToDate({ ...span, progress, granularity });
        expect(isAligned(date, granularity)).toBe(true);
        expect(date).toBeGreaterThanOrEqual(span.start);
        expect(date).toBeLessThanOrEqual(span.endExclusive);
        if (span.endExclusive === span.start) return;
        const p = clampProgress(progress);
        const total = measure(span);
        const back = dateToProgress({ ...span, date });
        expect(p - back).toBeLessThan((granularity.ms / total) * 100 + 1e-9);
        expect(back).toBeLessThanOrEqual(p + (0.5 / total) * 100 + 1e-9);
      }),
    );
  });

  it('FR-PROG-3, FR-SNAP-15: the handle stays within 0 … 100 and the span, aligned and consistent', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.integer({ min: -60 * 24 * 3, max: 60 * 24 * 40 }),
        directionArb,
        fc.boolean(),
        ({ span, granularity }, offsetMinutes, direction, skipNonWorking) => {
          const t = asDateTimeMs(span.start + offsetMinutes * MINUTE);
          const input = { ...span, t, granularity, direction, skipNonWorking };
          const { progress, progressDate } = progressFromDate(input);
          expect(progress).toBeGreaterThanOrEqual(0);
          expect(progress).toBeLessThanOrEqual(100);
          expect(progressDate).toBeGreaterThanOrEqual(span.start);
          expect(progressDate).toBeLessThanOrEqual(span.endExclusive);
          expect(isAligned(progressDate, granularity)).toBe(true);
          // What a record with this progress shows.
          expect(progressToDate({ ...span, progress, granularity })).toBe(progressDate);
          if (span.endExclusive === span.start) {
            expect(progress).toBe(t < span.start ? 0 : 100);
            return;
          }
          expect(dateToProgress({ ...span, date: progressDate })).toBe(progress);
          if (t <= span.start) expect([progress, progressDate]).toEqual([0, span.start]);
          if (t >= span.endExclusive)
            expect([progress, progressDate]).toEqual([100, span.endExclusive]);
          const inside = t > span.start && t < span.endExclusive;
          if (span.mode === 'calendar' && inside) {
            const aligned = Math.max(alignFloor(t, granularity), span.start);
            if (!skipNonWorking) expect(progressDate).toBe(aligned);
            else if (progressDate !== span.start && progressDate !== span.endExclusive) {
              expect(insideNonWorking(progressDate, span.calendar)).toBe(false);
              // The jump goes in the drag direction.
              if (direction >= 0) expect(progressDate).toBeGreaterThanOrEqual(aligned);
              else expect(progressDate).toBeLessThanOrEqual(aligned);
            }
          }
        },
      ),
    );
  });

  it('FR-PROG-3: the handle is monotonic in the dragged date', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.integer({ min: -60 * 24, max: 60 * 24 * 31 }),
        fc.integer({ min: 0, max: 60 * 24 * 5 }),
        directionArb,
        fc.boolean(),
        ({ span, granularity }, offsetMinutes, deltaMinutes, direction, skipNonWorking) => {
          const t1 = asDateTimeMs(span.start + offsetMinutes * MINUTE);
          const t2 = asDateTimeMs(t1 + deltaMinutes * MINUTE);
          const base = { ...span, granularity, direction, skipNonWorking };
          const first = progressFromDate({ ...base, t: t1 });
          const second = progressFromDate({ ...base, t: t2 });
          expect(first.progress).toBeLessThanOrEqual(second.progress);
          expect(first.progressDate).toBeLessThanOrEqual(second.progressDate);
        },
      ),
    );
  });

  it('FR-PROG-2: rebasing onto an identical span is the identity', () => {
    fc.assert(
      fc.property(
        caseArb,
        progressArb,
        fc.constantFrom<ProgressAnchor>('start', 'end'),
        ({ span, granularity }, progress, anchor) => {
          const result = rebaseProgress({
            ...span,
            progress,
            from: span,
            to: span,
            anchor,
            granularity,
          });
          expect(result.progress).toBe(clampProgress(progress));
          expect(result.progressDate).toBe(progressToDate({ ...span, progress, granularity }));
        },
      ),
    );
  });

  it('FR-PROG-2, FR-SNAP-15: rebased progress keeps its anchor, stays within 0 … 100 and does not drift', () => {
    fc.assert(
      fc.property(
        caseArb,
        caseArb,
        progressArb,
        fc.constantFrom<ProgressAnchor>('start', 'end'),
        ({ span, granularity }, other, progress, anchor) => {
          // The second span on the first one's grid and calendar.
          const g = granularity.ms;
          const start = Math.floor(other.span.start / g) * g;
          const length = Math.floor((other.span.endExclusive - other.span.start) / g) * g;
          const to: ProgressBounds = {
            start: asDateTimeMs(start),
            endExclusive: asDateTimeMs(start + length),
          };
          const toSpan: ProgressSpan = { ...span, ...to };
          const input = { ...span, progress, from: span, to, anchor, granularity };
          const result = rebaseProgress(input);
          expect(result.progress).toBeGreaterThanOrEqual(0);
          expect(result.progress).toBeLessThanOrEqual(100);
          expect(result.progressDate).toBeGreaterThanOrEqual(to.start);
          expect(result.progressDate).toBeLessThanOrEqual(to.endExclusive);
          expect(isAligned(result.progressDate, granularity)).toBe(true);
          expect(progressToDate({ ...toSpan, progress: result.progress, granularity })).toBe(
            result.progressDate,
          );

          if (span.endExclusive === span.start || to.endExclusive === to.start) return;
          // Both spans in one unit: working time only when both have some.
          const working = (s: ProgressSpan): number =>
            s.mode === 'working' ? s.calendar.countWorkingTime(s.start, s.endExclusive) : 0;
          const inWorking = working(span) > 0 && working(toSpan) > 0;
          const before = inWorking ? working(span) : span.endExclusive - span.start;
          const after = inWorking ? working(toSpan) : to.endExclusive - to.start;
          const p = clampProgress(progress);
          const tolerance = 1e-9 * Math.max(before, after);
          if (anchor === 'start' && result.progress < 100) {
            expect(Math.abs((result.progress * after) / 100 - (p * before) / 100)).toBeLessThan(
              tolerance,
            );
          }
          if (anchor === 'end' && result.progress > 0) {
            const remainder = ((100 - result.progress) * after) / 100;
            expect(Math.abs(remainder - ((100 - p) * before) / 100)).toBeLessThan(tolerance);
          }
          // Undoing the change restores the percentage unless it was clamped.
          if (result.progress > 0 && result.progress < 100) {
            const back = rebaseProgress({
              ...input,
              progress: result.progress,
              from: to,
              to: span,
            });
            expect(back.progress).toBeCloseTo(p, 9);
          }
        },
      ),
    );
  });
});
