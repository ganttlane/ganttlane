import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar, type WorkCalendar } from '../calendar';
import {
  alignNearest,
  asDateTimeMs,
  createFloatingAdapter,
  type DateAdapter,
  type DateTimeMs,
  DAY,
  type Granularity,
  isAligned,
  MINUTE,
  parseDuration,
  parseGranularity,
  toDayKey,
  type Weekday,
} from '../time';
import { effectiveSnapRule, resolveSnap, type SnapContext, type SnapRule, snapTime } from './snap';
import { VIEW_MODE_PRESETS } from './view-modes';

const WEEK = 7 * DAY;
const MONTHS = { month: 1, quarter: 3, year: 12 } as const;
const DAY_MODE = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;

function granularity(input: string): Granularity {
  const parsed = parseGranularity(input);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

const ONE_DAY = granularity('1d');
const timeOfDay = (t: number): number => ((t % DAY) + DAY) % DAY;

const ADAPTERS: readonly DateAdapter[] = [0, 1, 2, 3, 4, 5, 6].map((day) =>
  createFloatingAdapter({ weekStartsOn: day as Weekday }),
);
const CALENDARS: readonly WorkCalendar[] = [
  createWorkCalendar().calendar,
  createWorkCalendar({ weekends: [5] }).calendar,
  createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-09', '2026-03-10'] }).calendar,
];

/** Allowed granularities: every divisor of a day in minutes. */
const anyGranularity = fc
  .constantFrom(
    ...Array.from({ length: 1440 }, (_, i) => i + 1).filter((minutes) => 1440 % minutes === 0),
  )
  .map((minutes) => granularity(`${minutes}min`));
/** Any snap step a caller may write. */
const anyStep = fc.oneof(
  fc.integer({ min: 1, max: 3000 }).map((minutes) => `${minutes}min`),
  fc.integer({ min: 1, max: 10 }).map((days) => `${days}d`),
  fc.integer({ min: 1, max: 3 }).map((weeks) => `${weeks}w`),
  fc.constantFrom('1mo', '2mo', '5mo', '1q', '6mo', '1y', '2y'),
);
/** Floating times between 1900 and 2100: whole minutes or fractional milliseconds. */
const MIN_T = Date.UTC(1900, 0, 1);
const MAX_T = Date.UTC(2100, 0, 1);
const anyTime = fc
  .oneof(
    fc.integer({ min: MIN_T / MINUTE, max: MAX_T / MINUTE }).map((minutes) => minutes * MINUTE),
    fc.double({ min: MIN_T, max: MAX_T, noNaN: true }),
  )
  .map(asDateTimeMs);
const anyDirection = fc.constantFrom<-1 | 0 | 1>(-1, 0, 1);

/** A resolved rule with its granularity, adapter and task precision. */
const anySetup = fc
  .record({
    g: anyGranularity,
    step: anyStep,
    adapter: fc.constantFrom(...ADAPTERS),
    precision: fc.constantFrom<'day' | 'time'>('day', 'time'),
    keepDayPrecision: fc.boolean(),
    off: fc.boolean(),
  })
  .map(({ g, step, adapter, precision, keepDayPrecision, off }) => {
    const rule: SnapRule = off
      ? false
      : resolveSnap({ viewMode: DAY_MODE, option: step, granularity: g }).snap.move;
    return { rule, granularity: g, adapter, precision, keepDayPrecision };
  });

type Setup = Pick<
  SnapContext,
  'rule' | 'granularity' | 'adapter' | 'precision' | 'keepDayPrecision'
>;

/** A grid boundary next to `boundary` (one effective step before or after it). */
function neighbour(boundary: DateTimeMs, setup: Setup, sign: 1 | -1): number {
  const rule = effectiveSnapRule(setup.rule, setup);
  if (rule.kind === 'fixed') return boundary + sign * rule.ms;
  return setup.adapter.add(boundary, sign * rule.count, rule.unit);
}

describe('scale/snap properties', () => {
  it('FR-SNAP-14: resolved steps are multiples of the granularity that fit the day grid', () => {
    fc.assert(
      fc.property(anyGranularity, anyStep, (g, step) => {
        const { snap, issues } = resolveSnap({ viewMode: DAY_MODE, option: step, granularity: g });
        const rule = snap.move;
        if (rule === false) throw new Error('unexpected false');
        const requested = parseDuration(step);
        if (!requested.ok) throw new Error(requested.issue.message);
        if (rule.kind === 'fixed') {
          expect(rule.ms % g.ms).toBe(0);
          expect(rule.ms < DAY ? DAY % rule.ms : rule.ms % DAY).toBe(0);
          expect(rule.ms % WEEK).not.toBe(0);
          expect(rule.ms).toBeGreaterThanOrEqual(requested.value.ms);
          expect(issues.length).toBe(rule.ms === requested.value.ms ? 0 : 1);
        } else {
          expect(issues).toEqual([]);
          if (rule.unit === 'week') expect(rule.count * WEEK).toBe(requested.value.ms);
        }
        for (const issue of issues) {
          expect(issue.code).toBe(
            requested.value.ms < g.ms ? 'snap-below-granularity' : 'snap-not-multiple',
          );
        }
      }),
    );
  });

  it('FR-SNAP-6, FR-SNAP-14: grid snap is idempotent, nearest and aligned to the granularity', () => {
    fc.assert(
      fc.property(anySetup, anyTime, anyDirection, (setup, t, direction) => {
        const snapped = snapTime(t, { ...setup, direction });
        expect(snapTime(snapped, { ...setup, direction })).toBe(snapped);
        expect(isAligned(snapped, setup.granularity)).toBe(true);
        if (setup.precision === 'day' && setup.keepDayPrecision) {
          expect(isAligned(snapped, ONE_DAY)).toBe(true);
        }
        // |t' - t| <= step / 2: the other boundary around t is not closer.
        if (snapped <= t) {
          const next = neighbour(snapped, setup, 1);
          expect(next).toBeGreaterThan(t);
          expect(t - snapped).toBeLessThanOrEqual(next - t);
        } else {
          const previous = neighbour(snapped, setup, -1);
          expect(previous).toBeLessThanOrEqual(t);
          expect(snapped - t).toBeLessThanOrEqual(t - previous);
        }
      }),
    );
  });

  it('FR-SNAP-2: grid snap is monotonic in t', () => {
    fc.assert(
      fc.property(anySetup, anyTime, anyTime, anyDirection, (setup, a, b, direction) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const context = { ...setup, direction };
        expect(snapTime(low, context)).toBeLessThanOrEqual(snapTime(high, context));
      }),
    );
  });

  it('FR-SNAP-3: relative snap moves by whole steps from the origin', () => {
    fc.assert(
      fc.property(anySetup, anyTime, anyTime, anyDirection, (setup, t, rawOrigin, direction) => {
        const origin = alignNearest(rawOrigin, setup.granularity);
        const context = { ...setup, direction, mode: 'relative', origin } as const;
        const snapped = snapTime(t, context);
        expect(snapTime(snapped, context)).toBe(snapped);
        expect(isAligned(snapped, setup.granularity)).toBe(true);
        expect(snapTime(origin, context)).toBe(origin);
        const rule = effectiveSnapRule(setup.rule, setup);
        if (rule.kind === 'fixed' || rule.unit === 'week') {
          const step = rule.kind === 'fixed' ? rule.ms : rule.count * WEEK;
          expect(Math.abs(snapped - origin) % step).toBe(0);
          // `t - origin` is rounded to the precision of the larger operand, so a fractional `t`
          // just below a tie may land on it and round up: allow that rounding error.
          const slack = 2 * Number.EPSILON * Math.max(Math.abs(t), Math.abs(origin));
          expect(Math.abs(snapped - t)).toBeLessThanOrEqual(step / 2 + slack);
        } else {
          expect(timeOfDay(snapped)).toBe(timeOfDay(origin));
          const months = rule.count * MONTHS[rule.unit];
          expect(Math.abs(snapped - t)).toBeLessThanOrEqual((months * 31 * DAY) / 2);
        }
        const later = snapTime(asDateTimeMs(t + DAY), context);
        expect(later).toBeGreaterThanOrEqual(snapped);
      }),
    );
  });

  it('FR-SNAP-8: skipping lands on a working day, keeps the time of day and stays aligned', () => {
    fc.assert(
      fc.property(
        anySetup,
        anyTime,
        anyDirection,
        fc.constantFrom(...CALENDARS),
        (setup, t, direction, calendar) => {
          const plain = snapTime(t, { ...setup, direction });
          const context = { ...setup, direction, calendar, skipNonWorking: true };
          const skipped = snapTime(t, context);
          expect(calendar.isWorkingDay(toDayKey(skipped))).toBe(true);
          expect(skipped - plain).toBe((toDayKey(skipped) - toDayKey(plain)) * DAY);
          expect(Math.sign(skipped - plain)).not.toBe(direction < 0 ? 1 : -1);
          expect(isAligned(skipped, setup.granularity)).toBe(true);
          const rule = effectiveSnapRule(setup.rule, setup);
          if (rule.kind === 'fixed' && DAY % rule.ms === 0) {
            expect(snapTime(skipped, context)).toBe(skipped);
          }
        },
      ),
    );
  });
});
