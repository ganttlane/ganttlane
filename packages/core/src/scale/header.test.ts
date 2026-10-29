import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  asDateTimeMs,
  createFloatingAdapter,
  type DateAdapter,
  type DateTimeMs,
  DAY,
  fromParts,
  HOUR,
  type TimeUnit,
  type Weekday,
} from '../time';
import type { TimeRange } from './cell-grid';
import {
  currentCell,
  type HeaderCell,
  headerCells,
  type HeaderContext,
  headerRows,
} from './header';
import { createTimeScale } from './time-scale';
import { type HeaderRowSpec, VIEW_MODE_PRESETS, type ViewMode } from './view-modes';

const at = (iso: string): DateTimeMs =>
  asDateTimeMs(Date.parse(iso.includes('T') ? `${iso}Z` : iso));

/** `2026-03-08` for midnight, `2026-03-08T06:00` otherwise. */
function show(t: number): string {
  const text = new Date(t).toISOString().slice(0, 16);
  return text.endsWith('T00:00') ? text.slice(0, 10) : text;
}

const span = (cell: HeaderCell): string => `${show(cell.start)}/${show(cell.end)}`;

function preset(id: string): ViewMode {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

function row(id: string, index: number): HeaderRowSpec {
  const spec = preset(id).headers[index];
  if (!spec) throw new Error(`${id} has no row ${index}`);
  return spec;
}

interface ContextOptions {
  readonly origin?: string;
  readonly pxPerDay?: number;
  readonly locale?: string;
  readonly weekStartsOn?: Weekday;
  readonly adapter?: DateAdapter;
}

function context({
  origin = '2026-01-01',
  pxPerDay = 40,
  locale = 'en',
  weekStartsOn,
  adapter,
}: ContextOptions = {}): HeaderContext {
  return {
    scale: createTimeScale({ origin: at(origin), pxPerDay }),
    adapter: adapter ?? createFloatingAdapter(weekStartsOn === undefined ? {} : { weekStartsOn }),
    locale,
  };
}

const range = (start: string, end: string): TimeRange => ({ start: at(start), end: at(end) });

function cells(spec: HeaderRowSpec, start: string, end: string, ctx = context()): HeaderCell[] {
  return [...headerCells(spec, range(start, end), ctx)];
}

/** `Intl.DateTimeFormat` in the floating encoding, for expected labels. */
function intl(locale: string, options: Intl.DateTimeFormatOptions, iso: string): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(at(iso));
}

/** The default adapter with every call counted. */
function countingAdapter(weekStartsOn?: Weekday): { adapter: DateAdapter; calls: () => number } {
  let count = 0;
  const base = createFloatingAdapter(weekStartsOn === undefined ? {} : { weekStartsOn });
  const adapter = new Proxy<DateAdapter>(
    { ...base },
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

/** An adapter counting `formatter` and `format` calls. */
function formatSpy(): { adapter: DateAdapter; formatter: () => number; format: () => number } {
  const base = createFloatingAdapter();
  let formatter = 0;
  let format = 0;
  const adapter: DateAdapter = {
    ...base,
    formatter: (options, locale) => {
      formatter++;
      return base.formatter(options, locale);
    },
    format: (t, options, locale) => {
      format++;
      return base.format(t, options, locale);
    },
  };
  return { adapter, formatter: () => formatter, format: () => format };
}

/** The first `count` values of an iterator, without asking for more. */
function take<T>(iterator: Iterator<T>, count: number): T[] {
  const taken: T[] = [];
  while (taken.length < count) {
    const result = iterator.next();
    if (result.done === true) break;
    taken.push(result.value);
  }
  return taken;
}

const MONTH_ROW = row('day', 0);
const DAY_ROW = row('day', 1);
const WEEK_ROW = row('week', 1);
const DECADE_ROW = row('year', 0);

describe('scale/header', () => {
  describe('headerCells', () => {
    it('FR-SCALE-4: month cells span their real length, leap February included', () => {
      const months = cells(
        MONTH_ROW,
        '2024-01-15',
        '2024-04-10',
        context({ origin: '2024-01-01' }),
      );
      expect(months.map(span)).toEqual([
        '2024-01-01/2024-02-01',
        '2024-02-01/2024-03-01',
        '2024-03-01/2024-04-01',
        '2024-04-01/2024-05-01',
      ]);
      expect(months.map((cell) => cell.width)).toEqual([31 * 40, 29 * 40, 31 * 40, 30 * 40]);
      expect(months.map((cell) => cell.x)).toEqual([0, 31 * 40, 60 * 40, 91 * 40]);
      expect(months.map((cell) => cell.label)).toEqual([
        'January 2024',
        'February 2024',
        'March 2024',
        'April 2024',
      ]);
    });

    it('FR-SCALE-4: year cells change at New Year and a leap year is one day longer', () => {
      const years = cells(row('month', 0), '2023-06-01', '2025-02-01', context({ pxPerDay: 4 }));
      expect(years.map(span)).toEqual([
        '2023-01-01/2024-01-01',
        '2024-01-01/2025-01-01',
        '2025-01-01/2026-01-01',
      ]);
      expect(years.map((cell) => cell.width)).toEqual([365 * 4, 366 * 4, 365 * 4]);
      expect(years.map((cell) => cell.label)).toEqual(['2023', '2024', '2025']);
    });

    it('FR-SCALE-4: quarter cells start in January, April, July and October', () => {
      const spec: HeaderRowSpec = { unit: 'quarter', format: { month: 'short', year: 'numeric' } };
      expect(cells(spec, '2026-02-10', '2026-08-01').map(span)).toEqual([
        '2026-01-01/2026-04-01',
        '2026-04-01/2026-07-01',
        '2026-07-01/2026-10-01',
      ]);
      const halves = cells({ ...spec, step: 2 }, '2026-02-10', '2027-01-01').map(span);
      expect(halves).toEqual(['2026-01-01/2026-07-01', '2026-07-01/2027-01-01']);
    });

    it.each([
      [1, '2026-12-28/2027-01-04', 'Dec 28 – Jan 3', '2027-01-04/2027-01-11'],
      [0, '2026-12-27/2027-01-03', 'Dec 27 – Jan 2', '2027-01-03/2027-01-10'],
    ] as const)(
      'FR-SCALE-4: weeks across New Year start on weekStartsOn %i',
      (weekStartsOn, first, label, second) => {
        const ctx = context({ weekStartsOn });
        const weeks = cells(WEEK_ROW, '2026-12-31', '2027-01-08', ctx);
        expect(weeks.map(span)).toEqual([first, second]);
        expect(weeks[0]?.label).toBe(label);
        expect(weeks[0]?.width).toBe(7 * 40);
        const months = cells(row('week', 0), '2026-12-31', '2027-01-08', ctx);
        expect(months.map((cell) => cell.label)).toEqual(['December 2026', 'January 2027']);
      },
    );

    it('FR-SCALE-4: quarter-day cells align to 00, 06, 12 and 18 h', () => {
      const quarters = cells(row('quarter-day', 1), '2026-03-08T07:30', '2026-03-09T03:00');
      expect(quarters.map(span)).toEqual([
        '2026-03-08T06:00/2026-03-08T12:00',
        '2026-03-08T12:00/2026-03-08T18:00',
        '2026-03-08T18:00/2026-03-09',
        '2026-03-09/2026-03-09T06:00',
      ]);
      expect(quarters.map((cell) => cell.width)).toEqual([10, 10, 10, 10]);
      // The 24-hour clock in two digits: "6 AM" and "12 PM" do not fit in a 40 px column.
      expect(quarters.map((cell) => cell.label)).toEqual(['06', '12', '18', '00']);
    });

    it('FR-SCALE-4: half-day cells tell noon from midnight', () => {
      const halves = cells(row('half-day', 1), '2026-03-08T07:30', '2026-03-09T13:00');
      expect(halves.map(span)).toEqual([
        '2026-03-08/2026-03-08T12:00',
        '2026-03-08T12:00/2026-03-09',
        '2026-03-09/2026-03-09T12:00',
        '2026-03-09T12:00/2026-03-10',
      ]);
      expect(halves.map((cell) => cell.label)).toEqual(['00', '12', '00', '12']);
    });

    it('FR-SCALE-4: hour and minute steps restart at midnight, shortening the last cell', () => {
      const spec: HeaderRowSpec = { unit: 'hour', step: 5, format: { hour: 'numeric' } };
      expect(cells(spec, '2026-03-08T19:00', '2026-03-09T06:00').map(span)).toEqual([
        '2026-03-08T15:00/2026-03-08T20:00',
        '2026-03-08T20:00/2026-03-09',
        '2026-03-09/2026-03-09T05:00',
        '2026-03-09T05:00/2026-03-09T10:00',
      ]);
      const minutes: HeaderRowSpec = { unit: 'minute', step: 30, format: { minute: '2-digit' } };
      expect(cells(minutes, '2026-03-08T23:10', '2026-03-09T00:40').map(span)).toEqual([
        '2026-03-08T23:00/2026-03-08T23:30',
        '2026-03-08T23:30/2026-03-09',
        '2026-03-09/2026-03-09T00:30',
        '2026-03-09T00:30/2026-03-09T01:00',
      ]);
      const daily: HeaderRowSpec = { unit: 'hour', step: 36, format: { day: 'numeric' } };
      expect(cells(daily, '2026-03-08T12:00', '2026-03-09T12:00').map(span)).toEqual([
        '2026-03-08/2026-03-09',
        '2026-03-09/2026-03-10',
      ]);
    });

    it('FR-SCALE-4: day cells start at midnight and day steps do not move with the range', () => {
      expect(cells(DAY_ROW, '2026-03-08T10:00', '2026-03-10T00:01').map(span)).toEqual([
        '2026-03-08/2026-03-09',
        '2026-03-09/2026-03-10',
        '2026-03-10/2026-03-11',
      ]);
      // Day pairs count from 1970-01-01: 2026-03-08 is day 20 520, an even one.
      const pairs: HeaderRowSpec = { unit: 'day', step: 2, format: { day: 'numeric' } };
      expect(cells(pairs, '2026-03-09', '2026-03-14').map(span)).toEqual([
        '2026-03-08/2026-03-10',
        '2026-03-10/2026-03-12',
        '2026-03-12/2026-03-14',
      ]);
      expect(cells(pairs, '2026-03-10', '2026-03-14').map(span)).toEqual([
        '2026-03-10/2026-03-12',
        '2026-03-12/2026-03-14',
      ]);
    });

    it('FR-SCALE-4: week steps count from the week containing 1970-01-01', () => {
      // 2026-03-09 is Monday week 2932 after 1969-12-29, an even one.
      const sprints: HeaderRowSpec = { unit: 'week', step: 2, format: { day: 'numeric' } };
      expect(cells(sprints, '2026-03-02', '2026-04-01').map(span)).toEqual([
        '2026-02-23/2026-03-09',
        '2026-03-09/2026-03-23',
        '2026-03-23/2026-04-06',
      ]);
      expect(cells(sprints, '2026-03-10', '2026-04-01').map(span)).toEqual([
        '2026-03-09/2026-03-23',
        '2026-03-23/2026-04-06',
      ]);
      // With Sunday weeks, 2026-03-08 is week 2932 after 1969-12-28.
      const sundays = cells(sprints, '2026-03-10', '2026-04-01', context({ weekStartsOn: 0 }));
      expect(sundays.map(span)).toEqual(['2026-03-08/2026-03-22', '2026-03-22/2026-04-05']);
    });

    it('FR-SCALE-4: month steps count from year 0 (3 months are quarters, 6 are halves)', () => {
      const spec = (step: number): HeaderRowSpec => ({ unit: 'month', step, format: {} });
      expect(cells(spec(3), '2026-05-20', '2026-08-01').map(span)).toEqual([
        '2026-04-01/2026-07-01',
        '2026-07-01/2026-10-01',
      ]);
      expect(cells(spec(6), '2026-05-20', '2026-08-01').map(span)).toEqual([
        '2026-01-01/2026-07-01',
        '2026-07-01/2027-01-01',
      ]);
    });

    it('FR-SCALE-4: decade cells span ten years and show their first and last year', () => {
      const decades = cells(DECADE_ROW, '2019-06-01', '2031-01-01', context({ pxPerDay: 1 }));
      expect(decades.map(span)).toEqual([
        '2010-01-01/2020-01-01',
        '2020-01-01/2030-01-01',
        '2030-01-01/2040-01-01',
      ]);
      expect(decades.map((cell) => cell.label)).toEqual(['2010–2019', '2020–2029', '2030–2039']);
      expect(decades[1]?.width).toBe(3653);
      const centuries: HeaderRowSpec = { unit: 'year', step: 100, format: { year: 'numeric' } };
      expect(cells(centuries, '1999-12-31', '2000-01-02').map(span)).toEqual([
        '1900-01-01/2000-01-01',
        '2000-01-01/2100-01-01',
      ]);
    });

    it('FR-SCALE-4: includes the partial first and last cells without clipping them', () => {
      const ctx = context({ origin: '2026-03-15' });
      const months = cells(MONTH_ROW, '2026-03-15', '2026-05-10', ctx);
      expect(months.map(span)).toEqual([
        '2026-03-01/2026-04-01',
        '2026-04-01/2026-05-01',
        '2026-05-01/2026-06-01',
      ]);
      expect(months[0]?.x).toBe(-14 * 40);
      expect(months[0]?.width).toBe(31 * 40);
      expect(months[2]?.width).toBe(31 * 40);
    });

    it('FR-SCALE-4: a range on cell boundaries has no extra cell; an empty range has none', () => {
      expect(cells(MONTH_ROW, '2026-03-01', '2026-05-01').map(span)).toEqual([
        '2026-03-01/2026-04-01',
        '2026-04-01/2026-05-01',
      ]);
      expect(cells(MONTH_ROW, '2026-03-01', '2026-03-01T00:01').map(span)).toEqual([
        '2026-03-01/2026-04-01',
      ]);
      expect(cells(MONTH_ROW, '2026-03-31T23:59', '2026-04-01').map(span)).toEqual([
        '2026-03-01/2026-04-01',
      ]);
      expect(cells(MONTH_ROW, '2026-03-10', '2026-03-10')).toEqual([]);
      expect(cells(MONTH_ROW, '2026-05-01', '2026-03-01')).toEqual([]);
    });

    it.each([
      ['day', DAY_ROW, '2026-01-01', '2027-01-01', 365],
      ['month', MONTH_ROW, '2026-01-01', '2027-01-01', 12],
      ['quarter-day', row('quarter-day', 1), '2026-01-01', '2027-01-01', 4 * 365],
      ['year', row('month', 0), '2020-01-01', '2030-01-01', 10],
      ['week', WEEK_ROW, '2025-12-29', '2027-01-04', 53],
    ])(
      'FR-SCALE-4: %s cell widths add up to the span of a fully covered range',
      (_name, spec, start, end, count) => {
        const ctx = context({ pxPerDay: 13.7 });
        const all = cells(spec, start, end, ctx);
        expect(all).toHaveLength(count);
        const total = all.reduce((sum, cell) => sum + cell.width, 0);
        expect(total).toBeCloseTo(ctx.scale.dateToX(at(end)) - ctx.scale.dateToX(at(start)), 6);
      },
    );

    it('FR-SCALE-4: generates about 3650 day cells for 10 years', () => {
      const days = cells(DAY_ROW, '2020-01-01', '2030-01-01');
      expect(days).toHaveLength(3653);
      expect(span(days[0]!)).toBe('2020-01-01/2020-01-02');
      expect(span(days.at(-1)!)).toBe('2029-12-31/2030-01-01');
    });

    it('per-call key building: resolves the Intl formatter once per row, not per cell', () => {
      const spy = formatSpy();
      const days = cells(DAY_ROW, '2020-01-01', '2030-01-01', context({ adapter: spy.adapter }));
      expect(days).toHaveLength(3653);
      expect(days[0]?.label).toBe('1');
      expect(days.at(-1)?.label).toBe('31');
      expect(spy.formatter()).toBe(1);
      expect(spy.format()).toBe(0);
      // Nothing is resolved before the first cell, nor for an empty range.
      const lazy = headerCells(
        DAY_ROW,
        range('2020-01-01', '2030-01-01'),
        context({ adapter: spy.adapter }),
      );
      const empty = cells(DAY_ROW, '2020-01-01', '2020-01-01', context({ adapter: spy.adapter }));
      expect(empty).toEqual([]);
      expect(spy.formatter()).toBe(1);
      lazy.next();
      expect(spy.formatter()).toBe(2);
    });

    it.each(['en', 'uk'])('FR-SCALE-4: labels cells in the %s locale', (locale) => {
      const ctx = context({ locale });
      const month = cells(MONTH_ROW, '2026-03-08', '2026-03-09', ctx)[0]?.label;
      expect(month).toBe(intl(locale, { month: 'long', year: 'numeric' }, '2026-03-01'));
      const hour = cells(row('hour', 0), '2026-03-08', '2026-03-09', ctx)[0]?.label;
      expect(hour).toBe(intl(locale, { day: 'numeric', month: 'long' }, '2026-03-08'));
      const week = cells(WEEK_ROW, '2026-03-30', '2026-03-31', ctx)[0]?.label;
      const short: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
      expect(week).toBe(
        `${intl(locale, short, '2026-03-30')} – ${intl(locale, short, '2026-04-05')}`,
      );
    });

    it('FR-SCALE-4: Ukrainian labels are Ukrainian', () => {
      const ctx = context({ locale: 'uk' });
      expect(cells(MONTH_ROW, '2026-03-08', '2026-03-09', ctx)[0]?.label).toMatch(/^березень 2026/);
      expect(cells(row('hour', 0), '2026-03-08', '2026-03-09', ctx)[0]?.label).toBe('8 березня');
    });

    it('FR-SCALE-4: calls a formatter function with the cell range, the locale and the adapter', () => {
      const ctx = context({ locale: 'uk' });
      const seen: unknown[][] = [];
      const spec: HeaderRowSpec = {
        unit: 'day',
        format: (cell, locale, adapter) => {
          seen.push([show(cell.start), show(cell.end), locale, adapter]);
          return 'x';
        },
      };
      expect(cells(spec, '2026-03-08', '2026-03-09', ctx).map((cell) => cell.label)).toEqual(['x']);
      expect(seen).toEqual([['2026-03-08', '2026-03-09', 'uk', ctx.adapter]]);
    });

    it('is lazy: taking 5 cells of a 1000-year range costs a handful of adapter calls', () => {
      const { adapter, calls } = countingAdapter();
      const ctx = context({ adapter });
      const generator = headerCells(DAY_ROW, range('2000-01-01', '3000-01-01'), ctx);
      expect(calls()).toBe(0);
      const started = Date.now();
      const first = take(generator, 5);
      expect(Date.now() - started).toBeLessThan(50);
      expect(first.map(span)).toEqual([
        '2000-01-01/2000-01-02',
        '2000-01-02/2000-01-03',
        '2000-01-03/2000-01-04',
        '2000-01-04/2000-01-05',
        '2000-01-05/2000-01-06',
      ]);
      expect(calls()).toBeLessThanOrEqual(1 + 5 * 2);
    });

    it('throws on the call for an invalid step or a non-finite range', () => {
      const ctx = context();
      const bad =
        (spec: HeaderRowSpec, start = 0, end = DAY): (() => unknown) =>
        () =>
          headerCells(spec, { start: asDateTimeMs(start), end: asDateTimeMs(end) }, ctx);
      expect(bad({ ...DAY_ROW, step: 0 })).toThrow(RangeError);
      expect(bad({ ...DAY_ROW, step: 1.5 })).toThrow(/header row step must be a positive integer/);
      expect(bad(DAY_ROW, Number.NaN)).toThrow(RangeError);
      expect(bad(DAY_ROW, 0, Number.POSITIVE_INFINITY)).toThrow(/finite start and end/);
      expect(bad({ ...DAY_ROW, unit: 'decade' as TimeUnit })).toThrow(TypeError);
    });
  });

  describe('headerRows', () => {
    it('FR-SCALE-4: yields one re-iterable lazy row per header, top first', () => {
      const { adapter, calls } = countingAdapter();
      const ctx = context({ adapter, origin: '2026-03-01' });
      const rows = headerRows(preset('day'), range('2026-03-30', '2026-04-02'), ctx);
      expect(Object.isFrozen(rows)).toBe(true);
      expect(rows).toHaveLength(2);
      expect(calls()).toBe(0);
      const [months, days] = rows;
      expect([...months!].map((cell) => cell.label)).toEqual(['March 2026', 'April 2026']);
      expect([...days!].map((cell) => cell.label)).toEqual(['30', '31', '1']);
      expect([...days!]).toEqual([...days!]);
      expect([...days!][0]).toEqual({
        start: at('2026-03-30'),
        end: at('2026-03-31'),
        x: 29 * 40,
        width: 40,
        label: '30',
      });
    });

    it('FR-SCALE-4: matches headerCells for every preset row', () => {
      const ctx = context();
      const visible = range('2026-03-05T05:00', '2026-04-20');
      for (const mode of VIEW_MODE_PRESETS) {
        headerRows(mode, visible, ctx).forEach((cellsOfRow, index) => {
          expect([...cellsOfRow]).toEqual([...headerCells(mode.headers[index]!, visible, ctx)]);
        });
      }
    });

    it('per-call key building: resolves each row formatter once, across iterations', () => {
      const spy = formatSpy();
      const ctx = context({ adapter: spy.adapter });
      const rows = headerRows(preset('day'), range('2026-01-01', '2027-01-01'), ctx);
      expect(spy.formatter()).toBe(0);
      for (let pass = 0; pass < 3; pass++) {
        for (const cellsOfRow of rows) expect([...cellsOfRow].length).toBeGreaterThan(0);
      }
      expect(spy.formatter()).toBe(2);
      expect(spy.format()).toBe(0);
    });

    it('keeps the range it was given', () => {
      const visible = { start: at('2026-03-01'), end: at('2026-03-03') };
      const [, days] = headerRows(preset('day'), visible, context());
      visible.end = at('2026-03-10');
      expect([...days!]).toHaveLength(2);
    });

    it('validates every row on the call', () => {
      const mode = { headers: [MONTH_ROW, { ...DAY_ROW, step: -1 }] };
      expect(() => headerRows(mode, range('2026-03-01', '2026-03-02'), context())).toThrow(
        /headers\[1\]\.step must be a positive integer/,
      );
      expect(() =>
        headerRows(
          preset('day'),
          { start: at('2026-03-01'), end: asDateTimeMs(Number.NaN) },
          context(),
        ),
      ).toThrow(RangeError);
    });
  });

  describe('currentCell', () => {
    const ctx = context({ origin: '2026-01-01' });

    it('per-call key building: formats through one resolved formatter', () => {
      const spy = formatSpy();
      const cell = currentCell(MONTH_ROW, 40, context({ adapter: spy.adapter }));
      expect(cell.label).toBe('January 2026');
      expect([spy.formatter(), spy.format()]).toEqual([1, 0]);
    });

    it('FR-SCALE-4: returns the cell that starts exactly at a boundary', () => {
      const february = currentCell(MONTH_ROW, 31 * 40, ctx);
      expect(span(february)).toBe('2026-02-01/2026-03-01');
      expect(february).toMatchObject({ x: 31 * 40, width: 28 * 40, label: 'February 2026' });
      expect(span(currentCell(MONTH_ROW, 0, ctx))).toBe('2026-01-01/2026-02-01');
    });

    it('FR-SCALE-4: returns the cell containing a position inside it or just before a boundary', () => {
      expect(currentCell(MONTH_ROW, 31 * 40 - 0.01, ctx).label).toBe('January 2026');
      expect(currentCell(MONTH_ROW, 75 * 40 + 13, ctx).label).toBe('March 2026');
      expect(currentCell(MONTH_ROW, -1, ctx).label).toBe('December 2025');
      expect(span(currentCell(row('quarter-day', 1), 10 + 9.99, ctx))).toBe(
        '2026-01-01T06:00/2026-01-01T12:00',
      );
      expect(span(currentCell(row('quarter-day', 1), 10, ctx))).toBe(
        '2026-01-01T06:00/2026-01-01T12:00',
      );
      expect(currentCell(DECADE_ROW, 40 * 365 * 2, ctx).label).toBe('2020–2029');
      expect(currentCell(DECADE_ROW, 40 * 1826, ctx).label).toBe('2030–2039');
    });

    it('FR-SCALE-4: honours weekStartsOn', () => {
      // 2026-01-04 is a Sunday.
      const sunday = 3 * 40;
      expect(span(currentCell(WEEK_ROW, sunday, ctx))).toBe('2025-12-29/2026-01-05');
      const sundays = context({ origin: '2026-01-01', weekStartsOn: 0 });
      expect(span(currentCell(WEEK_ROW, sunday, sundays))).toBe('2026-01-04/2026-01-11');
    });

    it('is O(1): the adapter work does not grow with the distance from the origin', () => {
      const work = (x: number): number => {
        const { adapter, calls } = countingAdapter();
        currentCell(DAY_ROW, x, context({ adapter }));
        return calls();
      };
      expect(work(40 * 365 * 1000)).toBe(work(40));
    });

    it('throws for a non-finite x or an invalid step', () => {
      expect(() => currentCell(MONTH_ROW, Number.NaN, ctx)).toThrow(RangeError);
      expect(() => currentCell({ ...MONTH_ROW, step: 0 }, 0, ctx)).toThrow(RangeError);
    });
  });

  describe('properties', () => {
    const MIN = fromParts({ year: 1900, month: 1, day: 1 });
    const MAX = fromParts({ year: 2100, month: 1, day: 1 });
    /** Longest range per unit, so a run stays at a few hundred cells. */
    const MAX_SPAN: Readonly<Record<TimeUnit, number>> = {
      minute: 2 * DAY,
      hour: 20 * DAY,
      day: 400 * DAY,
      week: 5 * 365 * DAY,
      month: 30 * 365 * DAY,
      quarter: 60 * 365 * DAY,
      year: 200 * 365 * DAY,
    };
    const anyRow = fc.record({
      unit: fc.constantFrom<TimeUnit>('minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'),
      step: fc.oneof(fc.constant(1), fc.integer({ min: 1, max: 15 })),
    });
    const anyCase = anyRow.chain((spec) =>
      fc.record({
        spec: fc.constant(spec),
        start: fc.integer({ min: MIN, max: MAX }),
        length: fc.integer({ min: 1, max: MAX_SPAN[spec.unit] }),
        weekStartsOn: fc.integer({ min: 0, max: 6 }) as fc.Arbitrary<Weekday>,
        pxPerDay: fc.double({ min: 0.5, max: 2000, noNaN: true }),
      }),
    );

    it('FR-SCALE-4: cells are contiguous, aligned, cover the range and x grows', () => {
      fc.assert(
        fc.property(anyCase, ({ spec, start, length, weekStartsOn, pxPerDay }) => {
          const ctx: HeaderContext = {
            scale: createTimeScale({ origin: asDateTimeMs(start), pxPerDay }),
            adapter: createFloatingAdapter({ weekStartsOn }),
            locale: 'en',
          };
          const rowSpec: HeaderRowSpec = { ...spec, format: () => '' };
          const visible: TimeRange = {
            start: asDateTimeMs(start),
            end: asDateTimeMs(start + length),
          };
          const all = [...headerCells(rowSpec, visible, ctx)];
          expect(all.length).toBeGreaterThan(0);
          expect(all[0]!.start).toBeLessThanOrEqual(visible.start);
          expect(all[0]!.end).toBeGreaterThan(visible.start);
          expect(all.at(-1)!.start).toBeLessThan(visible.end);
          expect(all.at(-1)!.end).toBeGreaterThanOrEqual(visible.end);
          all.forEach((cell, index) => {
            expect(cell.start).toBeLessThan(cell.end);
            expect(cell.x).toBe(ctx.scale.dateToX(cell.start));
            expect(cell.width).toBeGreaterThan(0);
            const previous = all[index - 1];
            if (previous) {
              expect(previous.end).toBe(cell.start);
              expect(cell.x).toBeGreaterThan(previous.x);
            }
          });
          // Every cell is the one currentCell finds at its start and in its middle.
          for (const cell of [all[0]!, all.at(-1)!]) {
            expect(currentCell(rowSpec, cell.x, ctx).start).toBe(cell.start);
            const middle = ctx.scale.dateToX(asDateTimeMs((cell.start + cell.end) / 2));
            expect(currentCell(rowSpec, middle, ctx)).toEqual(cell);
          }
        }),
        { numRuns: 300 },
      );
    });

    it('FR-SCALE-4: cells do not depend on where the range starts', () => {
      fc.assert(
        fc.property(anyCase, fc.double({ min: 0, max: 1, noNaN: true }), (input, cut) => {
          const ctx = context({ weekStartsOn: input.weekStartsOn });
          const rowSpec: HeaderRowSpec = { ...input.spec, format: () => '' };
          const end = asDateTimeMs(input.start + input.length);
          const whole = [...headerCells(rowSpec, { start: asDateTimeMs(input.start), end }, ctx)];
          const later = asDateTimeMs(Math.round(input.start + cut * input.length));
          const part = [...headerCells(rowSpec, { start: later, end }, ctx)];
          expect(whole.slice(whole.length - part.length)).toEqual(part);
        }),
        { numRuns: 200 },
      );
    });
  });

  it('FR-SCALE-4: hour cells are 40 px wide in the hour preset', () => {
    const ctx = context({ pxPerDay: preset('hour').pxPerDay });
    const hours = cells(row('hour', 1), '2026-03-08T10:00', '2026-03-08T12:00', ctx);
    expect(hours.map((cell) => cell.width)).toEqual([40, 40]);
    expect(hours[1]!.start - hours[0]!.start).toBe(HOUR);
  });
});
