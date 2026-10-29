import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asDateTimeMs, createFloatingAdapter, type DateAdapter, type DateTimeMs } from '../time';
import {
  type HeaderCellRange,
  type HeaderFormatter,
  type HeaderRowSpec,
  mergeSnap,
  resolveViewModes,
  VIEW_MODE_PRESETS,
  type ViewMode,
  type ViewModeOverrides,
  type ViewModesInput,
} from './view-modes';

const at = (iso: string): DateTimeMs =>
  asDateTimeMs(Date.parse(iso.includes('T') ? `${iso}Z` : iso));

function preset(id: string): ViewMode {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

/** The formatter of a preset row, called with `adapter` (the default floating one). */
function formatter(
  mode: ViewMode,
  row: number,
  adapter: DateAdapter = createFloatingAdapter(),
): (range: HeaderCellRange, locale: string) => string {
  const format = mode.headers[row]?.format;
  if (typeof format !== 'function') throw new Error(`${mode.id} row ${row} has no formatter`);
  return (cell, locale) => format(cell, locale, adapter);
}

const range = (start: string, end: string): HeaderCellRange => ({ start: at(start), end: at(end) });

/** Every object reachable from a value (functions excluded), the value itself included. */
function objectsIn(value: unknown, found: object[] = []): object[] {
  if (typeof value === 'object' && value !== null) {
    found.push(value);
    for (const field of Object.values(value)) objectsIn(field, found);
  }
  return found;
}

/** The value at an issue path such as `'day.headers[0].unit'`. */
function valueAt(root: unknown, path: string): unknown {
  let value = root;
  for (const key of path.match(/[^.[\]]+/g) ?? []) {
    value = (value as Record<string, unknown> | undefined)?.[key];
  }
  return value;
}

/** Deep copy of plain JSON-like data. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  for (const object of objectsIn(value)) Object.freeze(object);
  return value;
}

/** Resolves overrides of the day preset and returns the issues and whether `day` survived. */
function resolveDay(override: Record<string, unknown>): ReturnType<typeof resolveViewModes> & {
  day: ViewMode | undefined;
} {
  const resolved = resolveViewModes({ day: override });
  return { ...resolved, day: resolved.modes.find((mode) => mode.id === 'day') };
}

/** A complete custom mode for the array form. */
const custom = (fields: Partial<ViewMode> = {}): ViewMode => ({
  id: 'sprint',
  unit: 'week',
  step: 2,
  pxPerDay: 10,
  headers: [{ unit: 'week', step: 2, format: { day: 'numeric', month: 'short' } }],
  ...fields,
});

describe('scale/view-modes', () => {
  describe('presets', () => {
    it('FR-SCALE-2: are the seven kebab-case presets from the finest to the coarsest', () => {
      expect(VIEW_MODE_PRESETS.map((mode) => mode.id)).toEqual([
        'hour',
        'quarter-day',
        'half-day',
        'day',
        'week',
        'month',
        'year',
      ]);
      expect(VIEW_MODE_PRESETS.map((mode) => mode.label)).toEqual([
        'Hour',
        'Quarter day',
        'Half day',
        'Day',
        'Week',
        'Month',
        'Year',
      ]);
    });

    it.each([
      ['hour', 'hour', undefined, 960],
      ['quarter-day', 'hour', 6, 160],
      ['half-day', 'hour', 12, 80],
      ['day', 'day', undefined, 40],
      ['week', 'week', undefined, 20],
      ['month', 'month', undefined, 4],
      ['year', 'year', undefined, 1],
    ] as const)(
      'FR-SCALE-2: %s has %s columns (step %s) at %i px/day',
      (id, unit, step, pxPerDay) => {
        const mode = preset(id);
        expect(mode.unit).toBe(unit);
        expect(mode.step).toBe(step);
        expect(mode.pxPerDay).toBe(pxPerDay);
      },
    );

    it('FR-SCALE-2, FR-SNAP-9: hour columns are 40 px wide like day columns, so 15 min is 10 px', () => {
      expect(preset('hour').pxPerDay / 24).toBe(preset('day').pxPerDay);
      expect(preset('hour').pxPerDay / 24 / 4).toBe(10);
    });

    it.each([
      ['hour', '15min'],
      ['quarter-day', '1h'],
      ['half-day', '1h'],
      ['day', '1d'],
      ['week', '1d'],
      ['month', '1d'],
      ['year', '1mo'],
    ])('FR-SNAP-5: %s snaps to %s by default', (id, snap) => {
      expect(preset(id).snap).toBe(snap);
    });

    it.each([
      ['hour', '15min'],
      ['quarter-day', '1h'],
      ['half-day', '1h'],
      ['day', undefined],
      ['week', undefined],
      ['month', undefined],
      ['year', undefined],
    ])('FR-SNAP-9: %s has minor lines every %s', (id, minorLine) => {
      expect(preset(id).minorLine).toBe(minorLine);
    });

    it.each([
      ['hour', '7d'],
      ['quarter-day', '7d'],
      ['half-day', '14d'],
      ['day', '14d'],
      ['week', '4w'],
      ['month', '4mo'],
      ['year', '2y'],
    ])('FR-SCALE-3: %s pads the timeline by %s (fork defaults)', (id, padding) => {
      expect(preset(id).padding).toBe(padding);
    });

    it.each([
      ['hour', { unit: 'day' }],
      ['quarter-day', { unit: 'day' }],
      ['half-day', { unit: 'day' }],
      ['day', { unit: 'week' }],
      ['week', { unit: 'month' }],
      ['month', { unit: 'quarter' }],
      ['year', undefined],
    ])('FR-SCALE-5: %s draws major lines at %o', (id, majorLine) => {
      expect(preset(id).majorLine).toEqual(majorLine);
    });

    it('FR-SCALE-4: hourly presets have a day row over an hour row', () => {
      expect(preset('hour').headers).toEqual([
        { unit: 'day', format: { day: 'numeric', month: 'long' } },
        { unit: 'hour', format: { hour: 'numeric' } },
      ]);
      expect(preset('quarter-day').headers).toEqual([
        { unit: 'day', format: { day: 'numeric', month: 'long' } },
        { unit: 'hour', step: 6, format: { hour: 'numeric' } },
      ]);
      expect(preset('half-day').headers).toEqual([
        { unit: 'day', format: { day: 'numeric', month: 'short' } },
        { unit: 'hour', step: 12, format: { hour: 'numeric' } },
      ]);
    });

    it('FR-SCALE-4: day, week, month and year presets have two rows with their own units', () => {
      expect(preset('day').headers).toEqual([
        { unit: 'month', format: { month: 'long', year: 'numeric' } },
        { unit: 'day', format: { day: 'numeric' } },
      ]);
      const week = preset('week');
      expect(week.headers[0]).toEqual({
        unit: 'month',
        format: { month: 'long', year: 'numeric' },
      });
      expect(week.headers[1]?.unit).toBe('week');
      expect(typeof week.headers[1]?.format).toBe('function');
      expect(preset('month').headers).toEqual([
        { unit: 'year', format: { year: 'numeric' } },
        { unit: 'month', format: { month: 'long' } },
      ]);
      const year = preset('year');
      expect(year.headers[0]).toMatchObject({ unit: 'year', step: 10 });
      expect(typeof year.headers[0]?.format).toBe('function');
      expect(year.headers[1]).toEqual({ unit: 'year', format: { year: 'numeric' } });
    });

    it('FR-SCALE-4: the week row shows the day range of the week', () => {
      const week = formatter(preset('week'), 1);
      expect(week(range('2026-03-02', '2026-03-09'), 'en')).toBe('2–8');
      expect(week(range('2026-03-30', '2026-04-06'), 'en')).toBe('Mar 30 – Apr 5');
      expect(week(range('2026-12-28', '2027-01-04'), 'en')).toBe('Dec 28 – Jan 3');
      expect(week(range('2026-03-02', '2026-03-03'), 'en')).toBe('Mar 2');
      const uk = new Intl.DateTimeFormat('uk', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      expect(week(range('2026-03-30', '2026-04-06'), 'uk')).toBe(
        `${uk.format(at('2026-03-30'))} – ${uk.format(at('2026-04-05'))}`,
      );
    });

    it('FR-SCALE-4: the decade row shows its first and last year', () => {
      const decade = formatter(preset('year'), 0);
      expect(decade(range('2020-01-01', '2030-01-01'), 'en')).toBe('2020–2029');
      expect(decade(range('2026-01-01', '2027-01-01'), 'en')).toBe('2026');
      expect(decade(range('2026-01-01', '2026-01-01'), 'en')).toBe('2026');
    });

    it('FR-SCALE-4: built-in formatters read dates and format through the given adapter', () => {
      const base = createFloatingAdapter();
      const calls: string[] = [];
      const adapter: DateAdapter = {
        ...base,
        getParts: (t) => {
          calls.push('getParts');
          return base.getParts(t);
        },
        format: (t, options, locale) => {
          calls.push('format');
          return `<${base.format(t, options, locale)}>`;
        },
      };
      expect(formatter(preset('week'), 1, adapter)(range('2026-03-02', '2026-03-09'), 'en')).toBe(
        '<2>–<8>',
      );
      expect(formatter(preset('year'), 0, adapter)(range('2020-01-01', '2030-01-01'), 'en')).toBe(
        '<2020>–<2029>',
      );
      expect(calls).toEqual(['getParts', 'getParts', 'format', 'format', 'format', 'format']);
    });

    it('FR-SCALE-4: a two-argument formatter still fits HeaderFormatter', () => {
      const legacy = (cell: HeaderCellRange, locale: string): string => `${locale}:${cell.start}`;
      const row: HeaderRowSpec = { unit: 'day', format: legacy };
      const format: HeaderFormatter = legacy;
      expect(format(range('1970-01-02', '1970-01-03'), 'en', createFloatingAdapter())).toBe(
        'en:86400000',
      );
      expect(resolveDay({ headers: [row] }).issues).toEqual([]);
    });

    it('are deeply frozen', () => {
      const objects = objectsIn(VIEW_MODE_PRESETS);
      expect(objects.length).toBeGreaterThan(30);
      for (const object of objects) expect(Object.isFrozen(object)).toBe(true);
    });

    it('FR-SCALE-2: resolve to themselves without issues when there is no input', () => {
      const resolved = resolveViewModes();
      expect(resolved.modes).toBe(VIEW_MODE_PRESETS);
      expect(resolved.issues).toEqual([]);
      expect(Object.isFrozen(resolved)).toBe(true);
      expect(Object.isFrozen(resolved.issues)).toBe(true);
    });
  });

  describe('record form (overrides)', () => {
    it('FR-SCALE-2: merges a partial override over its preset field by field', () => {
      const { modes, issues } = resolveViewModes({ day: { pxPerDay: 50, label: 'Tag' } });
      expect(issues).toEqual([]);
      expect(modes.map((mode) => mode.id)).toEqual(VIEW_MODE_PRESETS.map((mode) => mode.id));
      const day = modes[3]!;
      expect(day).toEqual({ ...preset('day'), pxPerDay: 50, label: 'Tag' });
      expect(day).not.toBe(preset('day'));
      expect(modes[4]).toBe(preset('week'));
      expect(preset('day').pxPerDay).toBe(40);
    });

    it('FR-SCALE-2: replaces headers instead of concatenating them', () => {
      const headers = [{ unit: 'week', format: { day: 'numeric' } }] as const;
      const { day, issues } = resolveDay({ headers });
      expect(issues).toEqual([]);
      expect(day?.headers).toEqual(headers);
    });

    it('keeps the preset value for fields set to undefined', () => {
      const { day, issues } = resolveDay({ pxPerDay: undefined, snap: '1h', padding: undefined });
      expect(issues).toEqual([]);
      expect(day).toEqual({ ...preset('day'), snap: '1h' });
    });

    it('FR-SNAP-9: removes preset lines and snap with false', () => {
      const { modes } = resolveViewModes({
        hour: { minorLine: false, majorLine: false, snap: false },
      });
      expect(modes[0]).toMatchObject({ minorLine: false, majorLine: false, snap: false });
    });

    describe('snap merge', () => {
      it.each([
        [{ mode: 'relative' }, { step: '1d', mode: 'relative' }],
        [
          { move: '1h', progress: false },
          { step: '1d', move: '1h', progress: false },
        ],
        [
          { step: '1w', mode: 'grid' },
          { step: '1w', mode: 'grid' },
        ],
        [
          { mode: 'grid', move: undefined },
          { step: '1d', mode: 'grid' },
        ],
        [{}, { step: '1d' }],
      ])(
        'FR-SNAP-4: merges the object-form snap %o over the preset step "1d" field by field',
        (snap, expected) => {
          const { day, issues } = resolveDay({ snap });
          expect(issues).toEqual([]);
          expect(day?.snap).toEqual(expected);
          expect(day).toEqual({ ...preset('day'), snap: expected });
        },
      );

      it('FR-SNAP-4, FR-SNAP-5: { mode: "relative" } keeps the 15min step of the hour preset', () => {
        const { modes } = resolveViewModes({ hour: { snap: { mode: 'relative' } } });
        expect(modes[0]?.snap).toEqual({ step: '15min', mode: 'relative' });
      });

      it.each(['unit', false, '1h', { hours: 2 }] as const)(
        'FR-SNAP-4: a step-form snap %o replaces the preset snap whole',
        (snap) => {
          expect(resolveDay({ snap }).day?.snap).toEqual(snap);
        },
      );

      it('merges over an object-form preset snap field by field, durations replaced whole', () => {
        expect(
          mergeSnap(
            { step: { hours: 1, minutes: 30 }, mode: 'grid', move: '1d' },
            { step: { minutes: 15 }, resize: undefined, progress: false },
          ),
        ).toEqual({ step: { minutes: 15 }, mode: 'grid', move: '1d', progress: false });
        expect(mergeSnap({ hours: 1 }, { mode: 'relative' })).toEqual({
          step: { hours: 1 },
          mode: 'relative',
        });
        expect(mergeSnap(false, { mode: 'relative' })).toEqual({ step: false, mode: 'relative' });
      });

      it('validates the merged snap and reports problems at the override path', () => {
        const { day, issues } = resolveDay({ snap: { mode: 'relative', move: '5m' } });
        expect(day).toBe(preset('day'));
        expect(issues).toEqual([
          expect.objectContaining({
            code: 'invalid-view-mode',
            path: 'day.snap.move',
            value: '5m',
          }),
        ]);
      });

      it('keeps the object snap of a new mode and never mutates or keeps the override', () => {
        const snap = { mode: 'relative', move: { hours: 1 } } as const;
        const { modes } = resolveViewModes({
          sprint: { ...custom(), id: undefined, snap },
          day: { snap },
        });
        expect(modes.find((mode) => mode.id === 'sprint')?.snap).toEqual(snap);
        const day = modes.find((mode) => mode.id === 'day');
        expect(day?.snap).toEqual({ step: '1d', ...snap });
        expect(day?.snap).not.toBe(snap);
        for (const object of objectsIn(day)) expect(Object.isFrozen(object)).toBe(true);
        expect(Object.isFrozen(snap)).toBe(false);
        expect(snap).toEqual({ mode: 'relative', move: { hours: 1 } });
      });
    });

    it('keeps the preset for an undefined override and for an empty record', () => {
      expect(resolveViewModes({ day: undefined }).modes).toEqual([...VIEW_MODE_PRESETS]);
      const empty = resolveViewModes({});
      expect(empty.issues).toEqual([]);
      empty.modes.forEach((mode, index) => expect(mode).toBe(VIEW_MODE_PRESETS[index]));
    });

    it('FR-SCALE-3: adds a complete mode under a new id after the presets, in input order', () => {
      const { modes, issues } = resolveViewModes({
        sprint: { unit: 'week', step: 2, pxPerDay: 10, headers: custom().headers },
        day: { pxPerDay: 30 },
        quarter: {
          unit: 'quarter',
          pxPerDay: 2,
          headers: [{ unit: 'quarter', format: { month: 'short', year: 'numeric' } }],
        },
      });
      expect(issues).toEqual([]);
      expect(modes.map((mode) => mode.id)).toEqual([
        'hour',
        'quarter-day',
        'half-day',
        'day',
        'week',
        'month',
        'year',
        'sprint',
        'quarter',
      ]);
      expect(modes[7]).toEqual(custom());
    });

    it('FR-SCALE-3: drops an incomplete mode under a new id with an issue per missing field', () => {
      const { modes, issues } = resolveViewModes({ sprint: { pxPerDay: 10 } });
      expect(modes.map((mode) => mode.id)).not.toContain('sprint');
      expect(issues.map((issue) => issue.path)).toEqual(['sprint.unit', 'sprint.headers']);
      expect(issues[0]).toMatchObject({ code: 'invalid-view-mode', severity: 'error' });
      expect(issues[0]?.message).toContain('"sprint" is not a preset');
    });

    it('FR-SCALE-3: keeps the preset when its override has an id that does not match its key', () => {
      const { day, issues } = resolveDay({ id: 'Day', pxPerDay: 50 });
      expect(day).toBe(preset('day'));
      expect(issues).toEqual([
        expect.objectContaining({ code: 'invalid-view-mode', path: 'day.id', value: 'Day' }),
      ]);
      expect(issues[0]?.message).toContain('The "day" preset is kept.');
      expect(resolveDay({ id: 'day' }).issues).toEqual([]);
      // A new id has no preset to fall back to: the mode is dropped.
      const { modes } = resolveViewModes({ sprint: { ...custom(), id: 'other' } });
      expect(modes.map((mode) => mode.id)).not.toContain('sprint');
    });

    it.each([null, 5, 'fast', [{ pxPerDay: 50 }]])(
      'FR-SCALE-3: keeps a preset overridden with %o',
      (value) => {
        const { modes, issues } = resolveViewModes({ day: value } as unknown as ViewModeOverrides);
        expect(modes).toEqual([...VIEW_MODE_PRESETS]);
        expect(issues).toEqual([
          expect.objectContaining({ code: 'invalid-view-mode', severity: 'error', path: 'day' }),
        ]);
      },
    );

    it('keeps a __proto__ key as plain data', () => {
      const input = JSON.parse(
        '{ "day": { "__proto__": { "pxPerDay": -1 }, "snap": "1h" } }',
      ) as ViewModeOverrides;
      const { modes, issues } = resolveViewModes(input);
      expect(issues).toEqual([
        expect.objectContaining({ severity: 'warning', path: 'day.__proto__' }),
      ]);
      expect(modes[3]).toEqual({ ...preset('day'), snap: '1h' });
      expect(Object.getPrototypeOf(modes[3])).toBe(Object.prototype);
    });
  });

  describe('array form (custom list)', () => {
    it('FR-SCALE-3: replaces the presets with a complete custom list', () => {
      const { modes, issues } = resolveViewModes([custom(), preset('month')]);
      expect(issues).toEqual([]);
      expect(modes).toEqual([custom(), preset('month')]);
    });

    it('drops later duplicates of an id', () => {
      const { modes, issues } = resolveViewModes([custom(), custom({ pxPerDay: 99 })]);
      expect(modes).toEqual([custom()]);
      expect(issues).toEqual([
        expect.objectContaining({ code: 'invalid-view-mode', path: '[1].id', value: 'sprint' }),
      ]);
    });

    it.each([
      [null, '[0]'],
      ['day', '[0]'],
      [{ ...custom(), id: undefined }, '[0].id'],
      [{ ...custom(), id: '' }, '[0].id'],
      [{ ...custom(), id: 7 }, '[0].id'],
    ])('reports %o at %s', (item, path) => {
      const { issues } = resolveViewModes([item, preset('day')] as unknown as ViewMode[]);
      expect(issues).toEqual([expect.objectContaining({ code: 'invalid-view-mode', path })]);
    });
  });

  describe('validation', () => {
    it.each([
      ['pxPerDay', 0, 'day.pxPerDay'],
      ['pxPerDay', -40, 'day.pxPerDay'],
      ['pxPerDay', Number.NaN, 'day.pxPerDay'],
      ['pxPerDay', Number.POSITIVE_INFINITY, 'day.pxPerDay'],
      ['pxPerDay', '40', 'day.pxPerDay'],
      ['unit', 'minute', 'day.unit'],
      ['unit', 'days', 'day.unit'],
      ['unit', 1, 'day.unit'],
      ['step', 0, 'day.step'],
      ['step', -1, 'day.step'],
      ['step', 1.5, 'day.step'],
      ['step', '6', 'day.step'],
      ['label', 5, 'day.label'],
      ['headers', [], 'day.headers'],
      ['headers', 'D MMM', 'day.headers'],
      ['headers', { unit: 'day' }, 'day.headers'],
      ['headers', [5], 'day.headers[0]'],
      ['headers', [{ unit: 'decade', format: {} }], 'day.headers[0].unit'],
      ['headers', [{ unit: 'year', step: 0, format: {} }], 'day.headers[0].step'],
      ['headers', [{ unit: 'day' }], 'day.headers[0].format'],
      ['headers', [{ unit: 'day', format: 'D MMM' }], 'day.headers[0].format'],
      ['headers', [{ unit: 'day', format: { month: 'longest' } }], 'day.headers[0].format'],
      [
        'headers',
        [{ unit: 'day', format: { dateStyle: 'short', day: 'numeric' } }],
        'day.headers[0].format',
      ],
      ['majorLine', 'week', 'day.majorLine'],
      ['majorLine', true, 'day.majorLine'],
      ['majorLine', { unit: 'decade' }, 'day.majorLine.unit'],
      ['minorLine', '15m', 'day.minorLine'],
      ['minorLine', '0min', 'day.minorLine'],
      ['minorLine', 15, 'day.minorLine'],
      ['minorLine', '1mo 1d', 'day.minorLine'],
      ['minorLine', { months: 1, hours: 12 }, 'day.minorLine'],
      ['snap', '5m', 'day.snap'],
      ['snap', '0d', 'day.snap'],
      ['snap', true, 'day.snap'],
      ['snap', { mode: 'magnet' }, 'day.snap.mode'],
      ['snap', { move: '1x' }, 'day.snap.move'],
      ['snap', { step: '1h', moves: '1h' }, 'day.snap.moves'],
      ['snap', { hours: 1.5 }, 'day.snap'],
      ['padding', '2 weeks', 'day.padding'],
      ['padding', 14, 'day.padding'],
      ['padding', ['1d'], 'day.padding'],
      ['padding', ['1d', '1d', '1d'], 'day.padding'],
      ['padding', ['1d', '1x'], 'day.padding[1]'],
    ])('FR-SCALE-3: rejects %s %o (issue at %s) and keeps the preset', (field, value, path) => {
      const input = { day: { [field]: value } };
      const { day, issues } = resolveDay(input.day);
      expect(day).toBe(preset('day'));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'invalid-view-mode', severity: 'error', path });
      // The issue carries the offending value found at its path.
      expect(issues[0]?.value).toBe(valueAt(input, path));
      expect(issues[0]?.message).toMatch(/\S/);
    });

    it.each([
      ['snap', 'unit'],
      ['snap', false],
      ['snap', '1d 4h'],
      ['snap', { hours: 1 }],
      [
        'snap',
        { step: '1h', mode: 'relative', move: false, resize: 'unit', progress: { days: 1 } },
      ],
      ['padding', '0d'],
      ['padding', ['1d', { weeks: 2 }]],
      ['minorLine', { minutes: 30 }],
      ['minorLine', '1d 12h'],
      ['minorLine', '1q'],
      ['majorLine', { unit: 'month' }],
      ['majorLine', (date: DateTimeMs) => date % 2 === 0],
      ['headers', [{ unit: 'minute', step: 30, format: (r: HeaderCellRange) => String(r.start) }]],
      ['headers', [{ unit: 'day', format: {} }]],
    ])('FR-SNAP-1, FR-SNAP-4: accepts %s %o', (field, value) => {
      const { day, issues } = resolveDay({ [field]: value });
      expect(issues).toEqual([]);
      expect(day?.[field as keyof ViewMode]).toEqual(value);
    });

    it('reports every problem of a mode at once', () => {
      const { issues } = resolveDay({ pxPerDay: 0, unit: 'days', snap: '5m' });
      expect(issues.map((issue) => issue.path)).toEqual(['day.unit', 'day.pxPerDay', 'day.snap']);
    });

    it('warns about unknown fields, with a hint for frappe-gantt names, and keeps the mode', () => {
      const { day, issues } = resolveDay({
        day_width: 50,
        extra: true,
        headers: [{ unit: 'day', format: { day: 'numeric' }, text: 'D' }],
        majorLine: { unit: 'week', every: 2 },
      });
      expect(day?.pxPerDay).toBe(40);
      expect(day?.headers).toEqual([{ unit: 'day', format: { day: 'numeric' } }]);
      expect(day?.majorLine).toEqual({ unit: 'week' });
      expect(issues.map((issue) => [issue.severity, issue.path])).toEqual([
        ['warning', 'day.headers[0].text'],
        ['warning', 'day.majorLine.every'],
        ['warning', 'day.day_width'],
        ['warning', 'day.extra'],
      ]);
      expect(issues[2]?.message).toContain('use pxPerDay instead');
    });

    it('falls back to the presets with an issue when the input is not a list or a record', () => {
      for (const input of [null, 'day', 5]) {
        const { modes, issues } = resolveViewModes(input as unknown as ViewModesInput);
        expect(modes).toBe(VIEW_MODE_PRESETS);
        expect(issues).toEqual([
          expect.objectContaining({ code: 'invalid-view-mode', severity: 'error', value: input }),
        ]);
        expect(issues[0]).not.toHaveProperty('path');
      }
    });

    it('falls back to the presets with an issue when no valid mode is left', () => {
      const empty = resolveViewModes([]);
      expect(empty.modes).toBe(VIEW_MODE_PRESETS);
      expect(empty.issues).toEqual([expect.objectContaining({ code: 'invalid-view-mode' })]);
      expect(empty.issues[0]?.message).toContain('presets are used');

      const invalid = resolveViewModes([custom({ pxPerDay: 0 })]);
      expect(invalid.modes).toBe(VIEW_MODE_PRESETS);
      expect(invalid.issues.map((issue) => issue.path)).toEqual(['[0].pxPerDay', undefined]);
    });

    it('never throws, whatever the input, and always returns modes', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.anything(),
            fc.array(fc.anything()),
            fc.dictionary(fc.constantFrom('day', 'hour', 'new'), fc.anything()),
          ),
          (input) => {
            const { modes } = resolveViewModes(input as ViewModesInput);
            expect(modes.length).toBeGreaterThan(0);
          },
        ),
      );
    });
  });

  describe('immutability', () => {
    it('accepts deeply frozen inputs and never freezes or keeps mutable input objects', () => {
      const override = { pxPerDay: 50, headers: [{ unit: 'week', format: { day: 'numeric' } }] };
      const frozen = deepFreeze({ day: clone(override) });
      expect(resolveViewModes(frozen as ViewModeOverrides).issues).toEqual([]);

      const list = [custom({ snap: { step: { hours: 1 } }, padding: ['1d', { weeks: 1 }] })];
      const { modes } = resolveViewModes(list);
      for (const object of objectsIn(list)) expect(Object.isFrozen(object)).toBe(false);
      for (const object of objectsIn(modes)) expect(Object.isFrozen(object)).toBe(true);
      expect(modes[0]).not.toBe(list[0]);
      expect(modes[0]?.headers).not.toBe(list[0]?.headers);

      const before = clone(modes[0]);
      (list[0] as { pxPerDay: number }).pxPerDay = 1;
      (list[0]?.headers[0]?.format as { day?: string }).day = '2-digit';
      expect(modes[0]).toEqual(before);
    });

    it('never mutates the presets', () => {
      const snapshot = VIEW_MODE_PRESETS.map((mode) => ({ ...mode }));
      resolveViewModes({ day: { pxPerDay: 1, headers: [] }, hour: { snap: false } });
      resolveViewModes([preset('day')]);
      expect(VIEW_MODE_PRESETS.map((mode) => ({ ...mode }))).toEqual(snapshot);
    });

    it('freezes the merged modes deeply', () => {
      const { modes } = resolveViewModes({ day: { padding: ['1d', { days: 2 }] } });
      for (const object of objectsIn(modes)) expect(Object.isFrozen(object)).toBe(true);
    });
  });
});
