import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import {
  asDateTimeMs,
  createFloatingAdapter,
  type DateTimeMs,
  DAY,
  type Granularity,
  HOUR,
  MINUTE,
  parseGranularity,
} from '../time';
import {
  clampResize,
  effectiveSnapRule,
  type FixedSnapRule,
  resolveSnap,
  type ResolveSnapInput,
  type SnapContext,
  snapTime,
} from './snap';
import type { SnapInput } from './snap-input';
import { resolveViewModes, VIEW_MODE_PRESETS, type ViewModeId } from './view-modes';

const at = (iso: string): DateTimeMs =>
  asDateTimeMs(Date.parse(iso.includes('T') ? `${iso}Z` : `${iso}T00:00Z`));
const iso = (t: number): string => new Date(t).toISOString().slice(0, 16);

const adapter = createFloatingAdapter();
const sundayAdapter = createFloatingAdapter({ weekStartsOn: 0 });
const { calendar } = createWorkCalendar(); // Saturday and Sunday off

function granularity(input: string): Granularity {
  const parsed = parseGranularity(input);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

function preset(id: ViewModeId): (typeof VIEW_MODE_PRESETS)[number] {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

const fixed = (ms: number): FixedSnapRule => ({ kind: 'fixed', ms });

/** Resolves snap for a preset with an optional `scheduling.snap` and granularity. */
function resolve(id: ViewModeId, option?: SnapInput, step = '1d'): ReturnType<typeof resolveSnap> {
  return resolveSnap({ viewMode: preset(id), option, granularity: granularity(step) });
}

/** Snaps an ISO date-time and returns it as ISO (minutes). */
function snap(value: string, context: Partial<SnapContext> & Pick<SnapContext, 'rule'>): string {
  return iso(snapTime(at(value), { adapter, precision: 'time', ...context }));
}

describe('scale/snap', () => {
  describe('resolveSnap', () => {
    it.each([
      ['hour', '1d', fixed(DAY)],
      ['quarter-day', '1d', fixed(DAY)],
      ['day', '1d', fixed(DAY)],
      ['week', '1d', fixed(DAY)],
      ['month', '1d', fixed(DAY)],
      ['year', '1d', { kind: 'calendar', unit: 'month', count: 1 }],
      ['hour', '1h', fixed(HOUR)],
      ['hour', '15min', fixed(15 * MINUTE)],
      ['hour', '5min', fixed(15 * MINUTE)],
      ['quarter-day', '15min', fixed(HOUR)],
      ['half-day', '45min', fixed(90 * MINUTE)],
      ['day', '1h', fixed(DAY)],
    ] as const)(
      'FR-SNAP-5, FR-SNAP-14: the %s preset at granularity %s snaps by %o, silently',
      (id, step, rule) => {
        const { snap, issues } = resolve(id, undefined, step);
        expect(snap).toEqual({
          mode: 'grid',
          move: rule,
          resize: rule,
          progress: rule,
          granularity: granularity(step),
          keepDayPrecision: true,
        });
        expect(issues).toEqual([]);
      },
    );

    it('returns frozen results and keeps keepDayPrecision', () => {
      const result = resolveSnap({ viewMode: preset('day'), keepDayPrecision: false });
      expect(result.snap.keepDayPrecision).toBe(false);
      expect(result.snap.granularity.ms).toBe(DAY);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.snap)).toBe(true);
      expect(Object.isFrozen(result.snap.move)).toBe(true);
      expect(Object.isFrozen(result.issues)).toBe(true);
    });

    it('FR-SNAP-14: an explicit 15min step at granularity 1h is raised to 1h with an issue', () => {
      const { snap, issues } = resolve('hour', '15min', '1h');
      expect(snap.move).toEqual(fixed(HOUR));
      expect(issues).toEqual([
        {
          code: 'snap-below-granularity',
          severity: 'warning',
          message: 'Snap step 15min is finer than the granularity 1h: raised to 1h.',
          path: 'scheduling.snap',
          value: '15min',
          suggested: '1h',
        },
      ]);
    });

    it.each([
      ['90min', '1h', 2 * HOUR, '2h'],
      ['5h', '1h', 6 * HOUR, '6h'],
      ['7h', '1h', 8 * HOUR, '8h'],
      ['2h', '45min', 3 * HOUR, '3h'],
      ['36h', '1h', 2 * DAY, '2d'],
      ['1d 12h', '1d', 2 * DAY, '2d'],
      ['50min', '1min', 60 * MINUTE, '1h'],
    ])(
      'FR-SNAP-2, FR-SNAP-14: an explicit %s at granularity %s is raised to %s',
      (option, step, ms, suggested) => {
        const { snap, issues } = resolve('day', option, step);
        expect(snap.move).toEqual(fixed(ms));
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
          code: 'snap-not-multiple',
          severity: 'warning',
          path: 'scheduling.snap',
          value: option,
          suggested,
        });
        expect(issues[0]?.message).toContain(`raised to ${suggested}`);
      },
    );

    it.each([
      ['30min', '15min', fixed(30 * MINUTE)],
      ['6h', '1h', fixed(6 * HOUR)],
      ['2d', '1h', fixed(2 * DAY)],
      ['1w', '1d', { kind: 'calendar', unit: 'week', count: 1 }],
      ['14d', '1d', { kind: 'calendar', unit: 'week', count: 2 }],
      ['1mo', '1h', { kind: 'calendar', unit: 'month', count: 1 }],
      ['2mo', '1d', { kind: 'calendar', unit: 'month', count: 2 }],
      ['1q', '1d', { kind: 'calendar', unit: 'quarter', count: 1 }],
      ['3mo', '1d', { kind: 'calendar', unit: 'quarter', count: 1 }],
      ['6mo', '1d', { kind: 'calendar', unit: 'quarter', count: 2 }],
      ['1y', '1d', { kind: 'calendar', unit: 'year', count: 1 }],
      ['24mo', '1d', { kind: 'calendar', unit: 'year', count: 2 }],
      [{ hours: 2 }, '1h', fixed(2 * HOUR)],
      [false, '1h', false],
    ] as const)('FR-SNAP-1: the step %o at granularity %s is %o', (option, step, rule) => {
      const { snap, issues } = resolve('day', option, step);
      expect(snap.move).toEqual(rule);
      expect(snap.progress).toEqual(rule);
      expect(issues).toEqual([]);
    });

    it.each([
      ['quarter-day', fixed(6 * HOUR)],
      ['half-day', fixed(12 * HOUR)],
      ['hour', fixed(HOUR)],
      ['day', fixed(DAY)],
      ['week', { kind: 'calendar', unit: 'week', count: 1 }],
      ['month', { kind: 'calendar', unit: 'month', count: 1 }],
      ['year', { kind: 'calendar', unit: 'year', count: 1 }],
    ] as const)("FR-SNAP-1: 'unit' in the %s preset is one column, %o", (id, rule) => {
      expect(resolve(id, 'unit', '1h').snap.move).toEqual(rule);
    });

    it("FR-SNAP-1: 'unit' follows custom columns and is checked like an explicit step", () => {
      const viewMode = { id: 'custom', unit: 'hour', step: 5, snap: 'unit' } as const;
      const { snap, issues } = resolveSnap({ viewMode, granularity: granularity('1h') });
      expect(snap.move).toEqual(fixed(6 * HOUR));
      expect(issues).toMatchObject([
        { code: 'snap-not-multiple', path: 'viewModes.custom.snap', value: 'unit' },
      ]);
      const quarters = resolveSnap({
        viewMode: { id: 'q', unit: 'quarter', step: 2 },
        option: 'unit',
      });
      expect(quarters.snap.move).toEqual({ kind: 'calendar', unit: 'quarter', count: 2 });
      const days = resolveSnap({ viewMode: { id: 'd', unit: 'day', step: 2 }, option: 'unit' });
      expect(days.snap.move).toEqual(fixed(2 * DAY));
    });

    it("FR-SNAP-3: option { mode: 'relative' } keeps the view mode's step", () => {
      const { snap, issues } = resolve('hour', { mode: 'relative' }, '15min');
      expect(snap.mode).toBe('relative');
      expect(snap.move).toEqual(fixed(15 * MINUTE));
      expect(issues).toEqual([]);
    });

    it('FR-SNAP-4: per-interaction steps override the shared step', () => {
      // Untyped JS may pass `undefined` fields: they are skipped.
      const option = { step: '1h', move: '1d', resize: undefined, progress: false } as SnapInput;
      const { snap } = resolve('hour', option, '15min');
      expect(snap.move).toEqual(fixed(DAY));
      expect(snap.resize).toEqual(fixed(HOUR));
      expect(snap.progress).toBe(false);
    });

    it('FR-SNAP-4: the option overrides the view mode field by field; a plain step replaces it', () => {
      const viewMode = {
        id: 'custom',
        unit: 'hour',
        snap: { step: '1h', progress: '1d', mode: 'relative' },
      } as const;
      const g = granularity('1h');
      const merged = resolveSnap({ viewMode, option: { step: '2h' }, granularity: g }).snap;
      expect([merged.mode, merged.move, merged.resize, merged.progress]).toEqual([
        'relative',
        fixed(2 * HOUR),
        fixed(2 * HOUR),
        fixed(DAY),
      ]);
      const replaced = resolveSnap({ viewMode, option: '2h', granularity: g }).snap;
      expect([replaced.mode, replaced.move, replaced.progress]).toEqual([
        'grid',
        fixed(2 * HOUR),
        fixed(2 * HOUR),
      ]);
      const empty = resolveSnap({ viewMode, option: {}, granularity: g }).snap;
      expect([empty.mode, empty.move, empty.progress]).toEqual([
        'relative',
        fixed(HOUR),
        fixed(DAY),
      ]);
    });

    it('FR-SNAP-14: a shared step that does not fit is reported once', () => {
      const { snap, issues } = resolve('day', { step: '30min' }, '1h');
      expect([snap.move, snap.resize, snap.progress]).toEqual([
        fixed(HOUR),
        fixed(HOUR),
        fixed(HOUR),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe('scheduling.snap.step');
    });

    it('FR-SNAP-14: overridden view mode snaps are explicit, preset ones are not', () => {
      const g = granularity('1h');
      const hourWith = (override: object): ResolveSnapInput['viewMode'] => {
        const { modes } = resolveViewModes({ hour: override });
        return modes.find((mode) => mode.id === 'hour')!;
      };
      expect(resolveSnap({ viewMode: hourWith({ snap: '5min' }), granularity: g })).toMatchObject({
        snap: { move: fixed(HOUR) },
        issues: [{ code: 'snap-below-granularity', path: 'viewModes.hour.snap', value: '5min' }],
      });
      const preset = resolveSnap({ viewMode: hourWith({ pxPerDay: 300 }), granularity: g });
      expect(preset.snap.move).toEqual(fixed(HOUR));
      expect(preset.issues).toEqual([]);
    });

    it('FR-SNAP-14: false explicit snap warnings: a merged preset override warns only for changed fields', () => {
      const hourWith = (override: object): ResolveSnapInput['viewMode'] => {
        const { modes, issues } = resolveViewModes({ hour: override });
        expect(issues).toEqual([]);
        return modes.find((mode) => mode.id === 'hour')!;
      };
      // Merges to { step: '15min', mode: 'relative' }: the step is still the preset's.
      const relative = hourWith({ snap: { mode: 'relative' } });
      expect(relative.snap).toEqual({ step: '15min', mode: 'relative' });
      const quiet = resolveSnap({ viewMode: relative });
      expect(quiet.issues).toEqual([]);
      expect(quiet.snap).toMatchObject({ mode: 'relative', move: fixed(DAY), resize: fixed(DAY) });
      // Equal durations in another form are still the preset's step.
      const minutes = resolveSnap({ viewMode: hourWith({ snap: { step: { minutes: 15 } } }) });
      expect(minutes.issues).toEqual([]);
      // A step the override does change warns, at its own path only.
      const changed = resolveSnap({
        viewMode: hourWith({ snap: { mode: 'relative', step: '5min' } }),
      });
      expect(changed.snap.move).toEqual(fixed(DAY));
      expect(changed.issues).toMatchObject([
        { code: 'snap-below-granularity', path: 'viewModes.hour.snap.step', value: '5min' },
      ]);
      // A field the preset does not have is the caller's, even with the preset's value.
      const added = resolveSnap({ viewMode: hourWith({ snap: { move: '15min' } }) });
      expect(added.issues).toMatchObject([
        { code: 'snap-below-granularity', path: 'viewModes.hour.snap.move', value: '15min' },
      ]);
      // A custom view mode has no preset defaults.
      const custom = resolveSnap({ viewMode: { ...relative, id: 'custom' } });
      expect(custom.issues).toMatchObject([
        { code: 'snap-below-granularity', path: 'viewModes.custom.snap.step' },
      ]);
    });

    it('uses the granularity when no snap is configured', () => {
      const viewMode = { id: 'custom', unit: 'day' } as const;
      const { snap, issues } = resolveSnap({ viewMode, granularity: granularity('30min') });
      expect(snap.move).toEqual(fixed(30 * MINUTE));
      expect(snap.mode).toBe('grid');
      expect(issues).toEqual([]);
    });

    it.each<[unknown, string[]]>([
      ['5m', ['scheduling.snap']],
      [true, ['scheduling.snap']],
      [{ moves: '1h' }, ['scheduling.snap']],
      ['1mo 1d', ['scheduling.snap']],
      [{ move: '1mo 1d', mode: 'magnet' }, ['scheduling.snap.mode', 'scheduling.snap.move']],
      [{ step: '0min', resize: '2h', extra: 1 }, ['scheduling.snap.step', 'scheduling.snap.extra']],
    ])('invalid scheduling.snap %o is ignored with invalid-snap at %o', (option, paths) => {
      const { snap, issues } = resolve('hour', option as SnapInput, '15min');
      expect(issues.map((issue) => issue.code)).toEqual(paths.map(() => 'invalid-snap'));
      expect(issues.map((issue) => issue.path)).toEqual(paths);
      expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
      expect(snap.mode).toBe('grid');
      expect(snap.move).toEqual(fixed(15 * MINUTE));
    });

    it('invalid view mode snaps are ignored too', () => {
      const viewMode = { id: 'custom', unit: 'day', snap: { step: '1mo 2h' } } as const;
      const { snap, issues } = resolveSnap({ viewMode });
      expect(snap.move).toEqual(fixed(DAY));
      expect(issues).toMatchObject([{ code: 'invalid-snap', path: 'viewModes.custom.snap.step' }]);
      expect(issues[0]?.message).toContain('mixes calendar and fixed units');
    });

    it('rejects unknown view mode units as a programming error', () => {
      const viewMode = { id: 'x', unit: 'decade', snap: 'unit' } as unknown;
      expect(() => resolveSnap({ viewMode } as ResolveSnapInput)).toThrow('decade');
    });
  });

  describe('effectiveSnapRule', () => {
    const g = granularity('1h');

    it.each([
      [false, 'time', true, fixed(HOUR)],
      [false, 'day', true, fixed(DAY)],
      [false, 'day', false, fixed(HOUR)],
      [fixed(15 * MINUTE), 'time', true, fixed(HOUR)],
      [fixed(90 * MINUTE), 'time', true, fixed(2 * HOUR)],
      [fixed(6 * HOUR), 'day', true, fixed(DAY)],
      [fixed(36 * HOUR), 'day', true, fixed(2 * DAY)],
      [fixed(6 * HOUR), 'day', false, fixed(6 * HOUR)],
      [{ kind: 'calendar', unit: 'month', count: 1 }, 'day', true, null],
    ] as const)(
      'FR-SNAP-7, FR-SNAP-14: %o for a %s task (keepDayPrecision %s) is %o',
      (rule, precision, keepDayPrecision, expected) => {
        const result = effectiveSnapRule(rule, { precision, keepDayPrecision, granularity: g });
        expect(result).toEqual(expected ?? rule);
      },
    );

    it('keeps rules that already fit and defaults to a day of granularity', () => {
      const rule = fixed(2 * HOUR);
      expect(effectiveSnapRule(rule, { precision: 'time', granularity: g })).toBe(rule);
      expect(effectiveSnapRule(false, { precision: 'time' })).toEqual(fixed(DAY));
    });
  });

  describe('snapTime: grid', () => {
    it.each([
      ['2026-03-10T23:52', '2026-03-10T23:45'],
      ['2026-03-10T23:53', '2026-03-11T00:00'],
      ['2026-03-11T00:07', '2026-03-11T00:00'],
      ['2026-03-11T00:08', '2026-03-11T00:15'],
    ])('FR-SNAP-2: 15min steps across midnight: %s → %s', (value, expected) => {
      const rule = fixed(15 * MINUTE);
      expect(snap(value, { rule, granularity: granularity('15min') })).toBe(expected);
    });

    it.each([
      ['2026-03-10T23:31', '2026-03-11T00:00'],
      ['2026-03-11T00:29', '2026-03-11T00:00'],
      ['2026-03-11T00:31', '2026-03-11T01:00'],
    ])('FR-SNAP-2: 1h steps across midnight: %s → %s', (value, expected) => {
      expect(snap(value, { rule: fixed(HOUR), granularity: granularity('1h') })).toBe(expected);
    });

    it.each([
      ['2026-03-10T20:59', 0, '2026-03-10T18:00'],
      ['2026-03-10T21:01', 0, '2026-03-11T00:00'],
      ['2026-03-10T21:00', 1, '2026-03-11T00:00'],
      ['2026-03-10T21:00', 0, '2026-03-11T00:00'],
      ['2026-03-10T21:00', -1, '2026-03-10T18:00'],
      ['2026-03-11T02:59', -1, '2026-03-11T00:00'],
    ] as const)(
      'FR-SNAP-2, FR-SNAP-6: 6h steps across midnight: %s (direction %i) → %s',
      (value, direction, expected) => {
        const rule = fixed(6 * HOUR);
        expect(snap(value, { rule, direction, granularity: granularity('1h') })).toBe(expected);
      },
    );

    it.each([
      [1, '2026-03-12T11:00', 0, '2026-03-09T00:00'],
      [1, '2026-03-12T13:00', 0, '2026-03-16T00:00'],
      [1, '2026-03-12T12:00', 0, '2026-03-16T00:00'],
      [1, '2026-03-12T12:00', -1, '2026-03-09T00:00'],
      [0, '2026-03-11T11:00', 0, '2026-03-08T00:00'],
      [0, '2026-03-12T11:00', 0, '2026-03-15T00:00'],
      [0, '2026-03-11T12:00', -1, '2026-03-08T00:00'],
    ] as const)(
      'FR-SNAP-2: 1w steps with weekStartsOn %i: %s (direction %i) → %s',
      (weekStartsOn, value, direction, expected) => {
        const rule = { kind: 'calendar', unit: 'week', count: 1 } as const;
        const dates = createFloatingAdapter({ weekStartsOn });
        expect(snap(value, { rule, direction, adapter: dates })).toBe(expected);
      },
    );

    it('FR-SNAP-2: n-week steps keep their parity across years', () => {
      const rule = { kind: 'calendar', unit: 'week', count: 2 } as const;
      expect(snap('2026-03-15', { rule })).toBe('2026-03-09T00:00');
      expect(snap('2026-03-17', { rule })).toBe('2026-03-23T00:00');
      expect(snap('2026-03-14', { rule, adapter: sundayAdapter })).toBe('2026-03-08T00:00');
      expect(snap('2026-03-16', { rule, adapter: sundayAdapter })).toBe('2026-03-22T00:00');
    });

    it.each([
      ['2024-02-15T11:00', 0, '2024-02-01T00:00'],
      ['2024-02-15T12:00', 1, '2024-03-01T00:00'],
      ['2024-02-15T12:00', -1, '2024-02-01T00:00'],
      ['2024-02-15T13:00', -1, '2024-03-01T00:00'],
      ['2025-02-14T23:00', 0, '2025-02-01T00:00'],
      ['2025-02-15T00:00', 0, '2025-03-01T00:00'],
      ['2025-02-15T00:00', -1, '2025-02-01T00:00'],
      ['2025-02-15T12:00', -1, '2025-03-01T00:00'],
      ['2024-12-31T00:00', 0, '2025-01-01T00:00'],
    ] as const)(
      'FR-SNAP-2: 1mo steps across February (leap 2024, non-leap 2025): %s (direction %i) → %s',
      (value, direction, expected) => {
        const rule = { kind: 'calendar', unit: 'month', count: 1 } as const;
        expect(snap(value, { rule, direction })).toBe(expected);
      },
    );

    it.each([
      [{ kind: 'calendar', unit: 'month', count: 2 }, '2026-02-10', '2026-03-01T00:00'],
      [{ kind: 'calendar', unit: 'month', count: 2 }, '2026-03-20', '2026-03-01T00:00'],
      [{ kind: 'calendar', unit: 'quarter', count: 1 }, '2026-05-20', '2026-07-01T00:00'],
      [{ kind: 'calendar', unit: 'quarter', count: 1 }, '2026-05-10', '2026-04-01T00:00'],
      [{ kind: 'calendar', unit: 'year', count: 1 }, '2026-07-02T11:00', '2026-01-01T00:00'],
      [{ kind: 'calendar', unit: 'year', count: 1 }, '2026-07-02T13:00', '2027-01-01T00:00'],
      [{ kind: 'calendar', unit: 'year', count: 2 }, '2026-09-01', '2026-01-01T00:00'],
      [{ kind: 'calendar', unit: 'year', count: 2 }, '2027-03-01', '2028-01-01T00:00'],
    ] as const)('FR-SNAP-2: %o snaps %s to %s', (rule, value, expected) => {
      expect(snap(value, { rule })).toBe(expected);
    });

    it('FR-SNAP-14: the hour preset at granularity 1d snaps by days', () => {
      const { snap: settings } = resolve('hour');
      const context = { rule: settings.move, granularity: settings.granularity };
      expect(snap('2026-03-10T10:40', context)).toBe('2026-03-10T00:00');
      expect(snap('2026-03-10T13:00', context)).toBe('2026-03-11T00:00');
    });

    it('FR-SNAP-10: snapping off still aligns to the granularity', () => {
      const g = granularity('1h');
      expect(snap('2026-03-10T10:29', { rule: false, granularity: g })).toBe('2026-03-10T10:00');
      expect(snap('2026-03-10T10:30', { rule: false, granularity: g, direction: -1 })).toBe(
        '2026-03-10T10:00',
      );
      expect(snap('2026-03-10T10:29', { rule: false })).toBe('2026-03-10T00:00');
    });

    it('FR-SNAP-7: a day-precision task in the hour preset keeps whole days unless disabled', () => {
      const { snap: settings } = resolve('hour', undefined, '15min');
      const base = { rule: settings.move, granularity: settings.granularity };
      expect(snap('2026-03-10T10:40', { ...base, precision: 'day' })).toBe('2026-03-10T00:00');
      expect(snap('2026-03-10T13:00', { ...base, precision: 'day' })).toBe('2026-03-11T00:00');
      expect(snap('2026-03-10T10:40', { ...base, precision: 'day', keepDayPrecision: false })).toBe(
        '2026-03-10T10:45',
      );
      expect(snap('2026-03-10T10:40', { ...base, precision: 'time' })).toBe('2026-03-10T10:45');
    });

    it('returns non-finite dates unchanged', () => {
      const context = { adapter, precision: 'time', rule: fixed(HOUR) } as const;
      expect(snapTime(asDateTimeMs(Number.NaN), context)).toBeNaN();
      expect(snapTime(asDateTimeMs(Infinity), context)).toBe(Infinity);
    });
  });

  describe('snapTime: relative', () => {
    const hourly = granularity('1h');

    it('FR-SNAP-3: a task at 10:00 with snap 1d moves to 10:00 of the next day, grid to 00:00', () => {
      const origin = at('2026-03-10T10:00');
      const context = { rule: fixed(DAY), granularity: hourly, origin };
      expect(snap('2026-03-11T08:00', { ...context, mode: 'relative' })).toBe('2026-03-11T10:00');
      expect(snap('2026-03-11T08:00', { ...context, mode: 'grid' })).toBe('2026-03-11T00:00');
      expect(snap('2026-03-11T08:00', { ...context, mode: 'relative', origin: undefined })).toBe(
        '2026-03-11T00:00',
      );
      expect(snap('2026-03-09T21:00', { ...context, mode: 'relative' })).toBe('2026-03-09T10:00');
      expect(snap('2026-03-09T22:00', { ...context, mode: 'relative', direction: -1 })).toBe(
        '2026-03-09T10:00',
      );
      expect(snap('2026-03-09T22:00', { ...context, mode: 'relative', direction: 1 })).toBe(
        '2026-03-10T10:00',
      );
    });

    it('FR-SNAP-3: aligns a misaligned origin to the granularity first', () => {
      const context = { rule: fixed(DAY), granularity: hourly, mode: 'relative' } as const;
      expect(snap('2026-03-11T09:00', { ...context, origin: at('2026-03-10T10:30') })).toBe(
        '2026-03-11T11:00',
      );
    });

    it('FR-SNAP-3: week steps keep the weekday and time', () => {
      const rule = { kind: 'calendar', unit: 'week', count: 1 } as const;
      const origin = at('2026-03-11T10:00'); // a Wednesday
      expect(
        snap('2026-03-17T08:00', { rule, origin, mode: 'relative', granularity: hourly }),
      ).toBe('2026-03-18T10:00');
    });

    it.each([
      ['2025-02-20', '2025-02-28T10:00'],
      ['2025-03-25', '2025-03-31T10:00'],
      ['2024-12-20', '2024-12-31T10:00'],
      ['2024-11-10', '2024-10-31T10:00'],
      ['2025-01-31T10:00', '2025-01-31T10:00'],
    ])('FR-SNAP-3: month steps from Jan 31 clamp without drift: %s → %s', (value, expected) => {
      const rule = { kind: 'calendar', unit: 'month', count: 1 } as const;
      const origin = at('2025-01-31T10:00');
      expect(snap(value, { rule, origin, mode: 'relative', granularity: hourly })).toBe(expected);
    });

    it('FR-SNAP-3: quarter steps count from the origin', () => {
      const rule = { kind: 'calendar', unit: 'quarter', count: 1 } as const;
      const origin = at('2026-02-15');
      expect(snap('2026-06-01', { rule, origin, mode: 'relative' })).toBe('2026-05-15T00:00');
    });
  });

  describe('snapTime: non-working days', () => {
    const hourly = granularity('1h');
    const skip = { calendar, skipNonWorking: true, granularity: hourly } as const;

    it('FR-SNAP-8, FR-SCH-4: skipping a weekend keeps the time of day', () => {
      const origin = at('2026-03-06T10:00'); // Friday
      const context = { ...skip, rule: fixed(DAY), origin, mode: 'relative' } as const;
      expect(snap('2026-03-07T09:00', context)).toBe('2026-03-09T10:00');
      expect(snap('2026-03-07T09:00', { ...context, direction: 1 })).toBe('2026-03-09T10:00');
      expect(snap('2026-03-08T11:00', { ...context, direction: -1 })).toBe('2026-03-06T10:00');
      expect(snap('2026-03-07T10:20', { ...skip, rule: fixed(HOUR) })).toBe('2026-03-09T10:00');
    });

    it('FR-SNAP-8: working days and disabled skipping are left alone', () => {
      expect(snap('2026-03-10T10:20', { ...skip, rule: fixed(HOUR) })).toBe('2026-03-10T10:00');
      const off = { ...skip, skipNonWorking: false, rule: fixed(HOUR) };
      expect(snap('2026-03-07T10:20', off)).toBe('2026-03-07T10:00');
      const noCalendar = { skipNonWorking: true, rule: fixed(HOUR), granularity: hourly };
      expect(snap('2026-03-07T10:20', noCalendar)).toBe('2026-03-07T10:00');
    });

    it('FR-SNAP-8: an exclusive end checks the day before it', () => {
      const context = { ...skip, rule: fixed(DAY), edge: 'end' } as const;
      expect(snap('2026-03-07T00:00', context)).toBe('2026-03-07T00:00');
      expect(snap('2026-03-08T00:00', context)).toBe('2026-03-10T00:00');
      expect(snap('2026-03-08T00:00', { ...context, direction: -1 })).toBe('2026-03-07T00:00');
      expect(snap('2026-03-07T10:00', { ...context, rule: fixed(HOUR) })).toBe('2026-03-09T10:00');
    });

    it('FR-SNAP-8: stays put when the calendar has no working day', () => {
      const { calendar: closed } = createWorkCalendar({ weekends: [0, 1, 2, 3, 4, 5, 6] });
      const context = { calendar: closed, skipNonWorking: true, rule: fixed(DAY) } as const;
      expect(snap('2026-03-07T03:00', context)).toBe('2026-03-07T00:00');
    });
  });

  describe('clampResize', () => {
    const day = fixed(DAY);

    it('FR-SNAP-6: the dragged end stays at least one step after the start', () => {
      const start = at('2026-03-09');
      expect(clampResize({ start, end: start, edge: 'end', minStep: day, adapter })).toEqual({
        start,
        end: at('2026-03-10'),
      });
      const end = at('2026-03-12');
      expect(clampResize({ start, end, edge: 'end', minStep: day, adapter })).toEqual({
        start,
        end,
      });
    });

    it('FR-SNAP-6: the dragged start stays at least one step before the end', () => {
      const end = at('2026-03-12T10:00');
      const minStep = fixed(HOUR);
      expect(
        clampResize({ start: at('2026-03-13'), end, edge: 'start', minStep, adapter }),
      ).toEqual({ start: at('2026-03-12T09:00'), end });
      const start = at('2026-03-11');
      expect(clampResize({ start, end, edge: 'start', minStep, adapter })).toEqual({ start, end });
    });

    it('FR-SNAP-6: calendar steps clamp to the month end', () => {
      const minStep = { kind: 'calendar', unit: 'month', count: 1 } as const;
      const start = at('2025-01-31');
      expect(clampResize({ start, end: at('2025-02-10'), edge: 'end', minStep, adapter }).end).toBe(
        at('2025-02-28'),
      );
      const end = at('2025-03-31');
      expect(
        clampResize({ start: at('2025-03-20'), end, edge: 'start', minStep, adapter }).start,
      ).toBe(at('2025-02-28'));
    });

    it('FR-SNAP-6, FR-SNAP-7: the minimum follows the effective rule of a day task', () => {
      const minStep = effectiveSnapRule(fixed(15 * MINUTE), {
        precision: 'day',
        granularity: granularity('15min'),
      });
      const start = at('2026-03-09');
      expect(clampResize({ start, end: start, edge: 'end', minStep, adapter }).end).toBe(
        at('2026-03-10'),
      );
    });
  });
});
