import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  asDateTimeMs,
  createFloatingAdapter,
  type DateAdapter,
  type DateTimeMs,
  DAY,
  fromParts,
  type Weekday,
} from '../time';
import type { TimeRange } from './cell-grid';
import { type GridLine, type GridLineOptions, gridLines } from './grid-lines';
import { headerCells, type HeaderContext, type ScaleContext } from './header';
import { createTimeScale } from './time-scale';
import { VIEW_MODE_PRESETS, type ViewMode } from './view-modes';

const at = (iso: string): DateTimeMs =>
  asDateTimeMs(Date.parse(iso.includes('T') ? `${iso}Z` : iso));

/** `2026-03-08` for midnight, `2026-03-08T06:15` otherwise. */
function show(t: number): string {
  const text = new Date(t).toISOString().slice(0, 16);
  return text.endsWith('T00:00') ? text.slice(0, 10) : text;
}

function preset(id: string): ViewMode {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

interface ContextOptions {
  readonly origin?: string;
  readonly pxPerDay?: number;
  readonly weekStartsOn?: Weekday;
  readonly adapter?: DateAdapter;
}

function context({
  origin = '2026-01-01',
  pxPerDay = 40,
  weekStartsOn,
  adapter,
}: ContextOptions = {}): ScaleContext {
  return {
    scale: createTimeScale({ origin: at(origin), pxPerDay }),
    adapter: adapter ?? createFloatingAdapter(weekStartsOn === undefined ? {} : { weekStartsOn }),
  };
}

const range = (start: string, end: string): TimeRange => ({ start: at(start), end: at(end) });

type Mode = Pick<ViewMode, 'unit' | 'step' | 'majorLine' | 'minorLine'>;

function lines(
  mode: Mode,
  start: string,
  end: string,
  ctx: ScaleContext = context({ pxPerDay: 'pxPerDay' in mode ? (mode as ViewMode).pxPerDay : 40 }),
  options?: GridLineOptions,
): GridLine[] {
  return [...gridLines(mode, range(start, end), ctx, options)];
}

/** Lines as `"<date> <kind>"`. */
const describeLines = (all: readonly GridLine[]): string[] =>
  all.map((line) => `${show(line.t)} ${line.kind}`);

/** The default adapter with every call counted. */
function countingAdapter(): { adapter: DateAdapter; calls: () => number } {
  let count = 0;
  const adapter = new Proxy<DateAdapter>(
    { ...createFloatingAdapter() },
    {
      get(target, key, receiver): unknown {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          count++;
          return (value as (...params: unknown[]) => unknown)(...args);
        };
      },
    },
  );
  return { adapter, calls: () => count };
}

describe('scale/grid-lines', () => {
  describe('column and major lines', () => {
    it.each([
      [1, ['2026-03-02', '2026-03-09']],
      [0, ['2026-03-01', '2026-03-08']],
    ] as const)(
      'FR-SCALE-5: day mode draws a line per day and majors at week starts (weekStartsOn %i)',
      (weekStartsOn, majors) => {
        const all = lines(
          preset('day'),
          '2026-03-01',
          '2026-03-15',
          context({ weekStartsOn, pxPerDay: 40 }),
        );
        expect(all).toHaveLength(14);
        expect(all.filter((line) => line.kind === 'major').map((line) => show(line.t))).toEqual(
          majors,
        );
        expect(all.every((line) => line.kind !== 'minor')).toBe(true);
      },
    );

    it('FR-SCALE-5: week mode puts month majors at the real month starts, once where they meet a column', () => {
      // 2026-06-01 is a Monday; 2026-05-01 and 2026-07-01 fall inside weeks.
      const all = lines(preset('week'), '2026-05-01', '2026-07-14', context({ pxPerDay: 20 }));
      expect(describeLines(all)).toEqual([
        '2026-05-01 major',
        '2026-05-04 column',
        '2026-05-11 column',
        '2026-05-18 column',
        '2026-05-25 column',
        '2026-06-01 major',
        '2026-06-08 column',
        '2026-06-15 column',
        '2026-06-22 column',
        '2026-06-29 column',
        '2026-07-01 major',
        '2026-07-06 column',
        '2026-07-13 column',
      ]);
    });

    it('FR-SCALE-5: month mode draws majors at quarter starts, year mode none', () => {
      const months = lines(preset('month'), '2026-01-01', '2026-07-01', context({ pxPerDay: 4 }));
      expect(describeLines(months)).toEqual([
        '2026-01-01 major',
        '2026-02-01 column',
        '2026-03-01 column',
        '2026-04-01 major',
        '2026-05-01 column',
        '2026-06-01 column',
      ]);
      const years = lines(preset('year'), '2019-06-01', '2023-01-01', context({ pxPerDay: 1 }));
      expect(describeLines(years)).toEqual([
        '2020-01-01 column',
        '2021-01-01 column',
        '2022-01-01 column',
      ]);
    });

    it('FR-SCALE-5: hourly modes draw majors at midnight', () => {
      const quarter = lines(preset('quarter-day'), '2026-03-08T12:00', '2026-03-09T12:00');
      expect(describeLines(quarter).filter((line) => !line.endsWith('minor'))).toEqual([
        '2026-03-08T12:00 column',
        '2026-03-08T18:00 column',
        '2026-03-09 major',
        '2026-03-09T06:00 column',
      ]);
    });

    it('FR-SCALE-5: a predicate marks the column starts it returns true for', () => {
      const seen: string[] = [];
      const mode: Mode = {
        unit: 'day',
        majorLine: (date) => {
          seen.push(show(date));
          return new Date(date).getUTCDate() % 5 === 0;
        },
      };
      const all = lines(mode, '2026-03-03', '2026-03-12');
      expect(describeLines(all)).toEqual([
        '2026-03-03 column',
        '2026-03-04 column',
        '2026-03-05 major',
        '2026-03-06 column',
        '2026-03-07 column',
        '2026-03-08 column',
        '2026-03-09 column',
        '2026-03-10 major',
        '2026-03-11 column',
      ]);
      expect(seen).toEqual(all.map((line) => show(line.t)));
    });

    it('FR-SCALE-5: majorLine false or absent draws column lines only', () => {
      const { majorLine: _majorLine, ...withoutMajor } = preset('day');
      for (const mode of [{ ...preset('day'), majorLine: false } as const, withoutMajor]) {
        const all = lines(mode, '2026-03-01', '2026-03-15');
        expect(all.map((line) => line.kind)).toEqual(Array<string>(14).fill('column'));
      }
    });

    it('FR-SCALE-5: columns follow the view mode step', () => {
      const all = lines({ unit: 'hour', step: 6 }, '2026-03-08T07:00', '2026-03-09T07:00');
      expect(describeLines(all)).toEqual([
        '2026-03-08T12:00 column',
        '2026-03-08T18:00 column',
        '2026-03-09 column',
        '2026-03-09T06:00 column',
      ]);
    });

    it('FR-SCALE-5: lines lie in [start, end) and x is their scale position', () => {
      const ctx = context({ origin: '2026-03-01' });
      const all = lines(preset('day'), '2026-03-01', '2026-03-04', ctx);
      expect(describeLines(all)).toEqual([
        '2026-03-01 column',
        '2026-03-02 major',
        '2026-03-03 column',
      ]);
      expect(all.map((line) => line.x)).toEqual([0, 40, 80]);
      expect(lines(preset('day'), '2026-03-01T00:01', '2026-03-02', ctx)).toEqual([]);
      expect(lines(preset('day'), '2026-03-04', '2026-03-04', ctx)).toEqual([]);
      expect(lines(preset('day'), '2026-03-04', '2026-03-01', ctx)).toEqual([]);
    });
  });

  describe('minor lines', () => {
    it('FR-SNAP-9: the hour preset (960 px/day) shows 15-minute minor lines 10 px apart', () => {
      const hour = preset('hour');
      expect(hour.pxPerDay).toBe(960);
      const all = lines(hour, '2026-03-08T23:00', '2026-03-09T01:00');
      expect(describeLines(all)).toEqual([
        '2026-03-08T23:00 column',
        '2026-03-08T23:15 minor',
        '2026-03-08T23:30 minor',
        '2026-03-08T23:45 minor',
        '2026-03-09 major',
        '2026-03-09T00:15 minor',
        '2026-03-09T00:30 minor',
        '2026-03-09T00:45 minor',
      ]);
      const xs = all.map((line) => line.x - all[0]!.x);
      expect(xs).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    });

    it('FR-SNAP-9: hides the 15-minute lines at the old 240 px/day (2.5 px apart)', () => {
      const all = lines(
        preset('hour'),
        '2026-03-08T23:00',
        '2026-03-09T01:00',
        context({ pxPerDay: 240 }),
      );
      expect(describeLines(all)).toEqual(['2026-03-08T23:00 column', '2026-03-09 major']);
    });

    it('FR-SNAP-9: the threshold is inclusive and configurable', () => {
      const show15 = (minMinorSpacingPx: number): number =>
        lines(preset('hour'), '2026-03-08T23:00', '2026-03-09T00:00', undefined, {
          minMinorSpacingPx,
        }).length;
      expect(show15(10)).toBe(4);
      expect(show15(10.01)).toBe(1);
      expect(show15(0)).toBe(4);
      expect(show15(Number.POSITIVE_INFINITY)).toBe(1);
      const dense = lines(
        preset('hour'),
        '2026-03-08T23:00',
        '2026-03-09T00:00',
        context({ pxPerDay: 240 }),
        { minMinorSpacingPx: 2.5 },
      );
      expect(dense.filter((line) => line.kind === 'minor')).toHaveLength(3);
    });

    it.each([
      ['quarter-day', 160, 5 * 4],
      ['half-day', 80, 0],
    ])(
      'FR-SNAP-9: %s at %i px/day shows hourly minor lines only when 6 px apart or more',
      (id, pxPerDay, minors) => {
        const mode = preset(id);
        expect(mode.pxPerDay).toBe(pxPerDay);
        const all = lines(mode, '2026-03-08', '2026-03-09');
        expect(all.filter((line) => line.kind === 'minor')).toHaveLength(minors);
      },
    );

    it('FR-SNAP-9: never puts a minor line where a column or major line is', () => {
      const mode: Mode = { unit: 'day', majorLine: { unit: 'week' }, minorLine: '12h' };
      const all = lines(mode, '2026-03-01', '2026-03-03');
      expect(describeLines(all)).toEqual([
        '2026-03-01 column',
        '2026-03-01T12:00 minor',
        '2026-03-02 major',
        '2026-03-02T12:00 minor',
      ]);
    });

    it.each([
      // Weeks from the week start: Mondays.
      [
        '1w',
        'month',
        4,
        '2026-03-01',
        '2026-03-24',
        ['03-01 c', '03-02', '03-09', '03-16', '03-23'],
      ],
      // Day pairs from 1970-01-01: 2026-03-02 is day 20 514, an even one.
      ['2d', 'week', 20, '2026-03-01', '2026-03-09', ['03-02 c', '03-04', '03-06', '03-08']],
      ['1mo', 'year', 1, '2025-12-15', '2026-03-02', ['01-01 c', '02-01', '03-01']],
      ['1q', 'year', 1, '2026-01-01', '2027-01-01', ['01-01 c', '04-01', '07-01', '10-01']],
      ['1d 12h', 'week', 20, '2026-03-02', '2026-03-05', ['03-02 c', '03-03', '03-04']],
    ] as const)(
      'FR-SNAP-9: a %s minor line over %s columns aligns like a header row of that step',
      (minorLine, unit, pxPerDay, start, end, expected) => {
        const all = lines({ unit, minorLine }, start, end, context({ pxPerDay }));
        const found = all.map(
          (line) => `${show(line.t).slice(5)}${line.kind === 'minor' ? '' : ' c'}`,
        );
        expect(found).toEqual(expected);
      },
    );

    it('FR-SNAP-9: a yearly minor line counts from year 0 under decade columns', () => {
      const all = lines(
        { unit: 'year', step: 10, minorLine: '1y' },
        '2019-01-01',
        '2022-01-01',
        context({ pxPerDay: 0.2 }),
      );
      expect(describeLines(all)).toEqual([
        '2019-01-01 minor',
        '2020-01-01 column',
        '2021-01-01 minor',
      ]);
    });

    it('FR-SNAP-9: calendar minor steps count months as 28 days for the spacing', () => {
      const mode: Mode = { unit: 'year', minorLine: '1mo' };
      const count = (pxPerDay: number): number =>
        lines(mode, '2026-01-01', '2027-01-01', context({ pxPerDay })).filter(
          (line) => line.kind === 'minor',
        ).length;
      expect(count(0.25)).toBe(11); // 7 px
      expect(count(0.2)).toBe(0); // 5.6 px
    });
  });

  describe('order and laziness', () => {
    it('FR-SCALE-5: every preset yields strictly increasing positions, one line each', () => {
      for (const mode of VIEW_MODE_PRESETS) {
        const all = lines(
          mode,
          '2025-11-17T05:00',
          '2026-03-03',
          context({ pxPerDay: mode.pxPerDay }),
        );
        expect(all.length).toBeGreaterThan(0);
        for (let index = 1; index < all.length; index++) {
          expect(all[index]!.t).toBeGreaterThan(all[index - 1]!.t);
          expect(all[index]!.x).toBeGreaterThan(all[index - 1]!.x);
        }
      }
    });

    it('is lazy: taking 5 lines of a 1000-year hour range is quick and costs little', () => {
      const { adapter, calls } = countingAdapter();
      const ctx = context({ adapter, pxPerDay: 960 });
      const generator = gridLines(preset('hour'), range('2000-01-01', '3000-01-01'), ctx);
      const before = calls();
      const started = Date.now();
      const first: GridLine[] = [];
      for (const line of generator) {
        first.push(line);
        if (first.length === 5) break;
      }
      expect(Date.now() - started).toBeLessThan(50);
      expect(describeLines(first)).toEqual([
        '2000-01-01 major',
        '2000-01-01T00:15 minor',
        '2000-01-01T00:30 minor',
        '2000-01-01T00:45 minor',
        '2000-01-01T01:00 column',
      ]);
      expect(calls() - before).toBeLessThan(40);
    });

    it('throws on the call for invalid input', () => {
      const ctx = context();
      const visible = range('2026-03-01', '2026-03-02');
      const call =
        (mode: Mode, options?: GridLineOptions, at: TimeRange = visible): (() => unknown) =>
        () =>
          gridLines(mode, at, ctx, options);
      expect(call({ unit: 'day', minorLine: '15m' })).toThrow(/Invalid minorLine/);
      expect(call({ unit: 'day', minorLine: '0min' })).toThrow(/one kind/);
      expect(call({ unit: 'day', minorLine: '1mo 1d' })).toThrow(RangeError);
      expect(call({ unit: 'day', step: 0 })).toThrow(/view mode step must be a positive integer/);
      expect(call({ unit: 'day' }, { minMinorSpacingPx: -1 })).toThrow(/minMinorSpacingPx/);
      expect(call({ unit: 'day' }, { minMinorSpacingPx: Number.NaN })).toThrow(RangeError);
      expect(
        call({ unit: 'day' }, undefined, { start: visible.start, end: asDateTimeMs(Infinity) }),
      ).toThrow(RangeError);
    });
  });

  describe('properties', () => {
    const MIN = fromParts({ year: 1950, month: 1, day: 1 });
    const MAX = fromParts({ year: 2100, month: 1, day: 1 });

    it('FR-SCALE-4, FR-SCALE-5: every column cell start is a column or major line, nothing doubles', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VIEW_MODE_PRESETS),
          fc.integer({ min: MIN, max: MAX }),
          fc.integer({ min: 1, max: 4000 }),
          fc.integer({ min: 0, max: 6 }),
          (mode, start, widthPx, weekStartsOn) => {
            const ctx: HeaderContext = {
              ...context({ weekStartsOn: weekStartsOn as Weekday, pxPerDay: mode.pxPerDay }),
              locale: 'en',
            };
            const end = asDateTimeMs(Math.round(start + (widthPx / mode.pxPerDay) * DAY));
            const visible: TimeRange = { start: asDateTimeMs(start), end };
            const all = [...gridLines(mode, visible, ctx)];
            const positions = all.map((line) => line.t);
            expect(new Set(positions).size).toBe(positions.length);
            expect([...positions].sort((a, b) => a - b)).toEqual(positions);
            const columnRow = { unit: mode.unit, step: mode.step ?? 1, format: () => '' };
            const starts = [...headerCells(columnRow, visible, ctx)]
              .map((cell) => cell.start)
              .filter((t) => t >= visible.start);
            const strong = all.filter((line) => line.kind !== 'minor').map((line) => line.t);
            for (const t of starts) expect(strong).toContain(t);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
