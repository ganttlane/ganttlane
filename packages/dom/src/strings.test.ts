import { VIEW_MODE_PRESETS } from '@ganttlane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_STRINGS, type GanttStrings, resolveStrings } from './strings';
import { emulateRuntimeLocale } from './testing/runtime-locale';

/** The keys of the strings, which are the keys of the English defaults. */
const KEYS = Object.keys(DEFAULT_STRINGS) as (keyof GanttStrings)[];

describe('DEFAULT_STRINGS', () => {
  it('FR-I18N-2: has every key the renderer, the toolbar and the view mode names need', () => {
    expect([...KEYS].sort()).toEqual(
      [
        'chartLabel',
        'progress',
        'workingDays',
        'dateRange',
        'linkTitle',
        'removeLink',
        'today',
        'zoomIn',
        'zoomOut',
        'viewMode',
        'hour',
        'quarterDay',
        'halfDay',
        'day',
        'week',
        'month',
        'quarter',
        'year',
      ].sort(),
    );
  });

  it('FR-I18N-2: is frozen, English, and its texts are strings or functions, never empty', () => {
    expect(Object.isFrozen(DEFAULT_STRINGS)).toBe(true);
    expect(DEFAULT_STRINGS.chartLabel).toBe('Gantt chart');
    expect(DEFAULT_STRINGS.removeLink).toBe('Remove dependency');
    for (const key of KEYS) {
      const value = DEFAULT_STRINGS[key];
      expect(['string', 'function'], key).toContain(typeof value);
      if (typeof value === 'string') expect(value, key).not.toBe('');
    }
  });

  it('FR-I18N-2: the English sentences are built from the values they are given', () => {
    expect(DEFAULT_STRINGS.progress(60, 'en')).toBe('60% done');
    expect(DEFAULT_STRINGS.workingDays(1, 'en')).toBe('1 working day');
    expect(DEFAULT_STRINGS.workingDays(0, 'en')).toBe('0 working days');
    expect(DEFAULT_STRINGS.workingDays(2.5, 'en')).toBe('2.5 working days');
    expect(DEFAULT_STRINGS.dateRange('Mar 2', 'Mar 6', 'en')).toBe('Mar 2 – Mar 6');
    expect(DEFAULT_STRINGS.linkTitle('Design', 'Build', 'en')).toBe('Design → Build');
  });

  it('FR-I18N-1: numbers in the sentences follow the locale, the words stay English', () => {
    expect(DEFAULT_STRINGS.workingDays(2.5, 'de')).toBe('2,5 working days');
    expect(DEFAULT_STRINGS.workingDays(1234, 'de')).toBe('1.234 working days');
    expect(DEFAULT_STRINGS.progress(60, 'de')).toBe('60 % done');
    expect(DEFAULT_STRINGS.progress(60, 'ar-EG')).toMatch(/^[٠-٩]+٪؜? done$/);
  });

  it('FR-I18N-2: every view mode preset of the core has its name here, the same English', () => {
    const camel = (id: string): string =>
      id.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

    for (const preset of VIEW_MODE_PRESETS) {
      expect(DEFAULT_STRINGS[camel(preset.id) as keyof GanttStrings], preset.id).toBe(preset.label);
    }
  });
});

describe('resolveStrings', () => {
  it('FR-I18N-2: nothing given is the defaults themselves', () => {
    expect(resolveStrings(undefined)).toBe(DEFAULT_STRINGS);
    expect(resolveStrings({})).toBe(DEFAULT_STRINGS);
  });

  it('FR-I18N-2: merges the given keys over the defaults, frozen', () => {
    const strings = resolveStrings({ chartLabel: 'Діаграма Ганта', today: 'Сьогодні' });

    expect(strings.chartLabel).toBe('Діаграма Ганта');
    expect(strings.today).toBe('Сьогодні');
    expect(strings.zoomIn).toBe(DEFAULT_STRINGS.zoomIn);
    expect(strings.workingDays).toBe(DEFAULT_STRINGS.workingDays);
    expect(Object.isFrozen(strings)).toBe(true);
    expect(Object.keys(strings)).toEqual(KEYS);
  });

  it('FR-I18N-2: takes a function where a function goes', () => {
    const workingDays = (days: number): string => `${String(days)} р. д.`;

    expect(resolveStrings({ workingDays }).workingDays).toBe(workingDays);
  });

  it('FR-I18N-2: keeps identity when nothing changes, like display does', () => {
    const base = resolveStrings({ today: 'Сьогодні' });

    expect(resolveStrings({}, base)).toBe(base);
    expect(resolveStrings(undefined, base)).toBe(base);
    expect(resolveStrings({ today: 'Сьогодні' }, base)).toBe(base);
    expect(resolveStrings({ today: 'Сьогодні', nothing: 1 } as never, base)).toBe(base);
    expect(resolveStrings({ chartLabel: DEFAULT_STRINGS.chartLabel }, base)).toBe(base);
    expect(resolveStrings({ today: 'Інше' }, base)).not.toBe(base);
  });

  it('FR-I18N-2: a patch merges over the current strings and does not reset the other keys', () => {
    const first = resolveStrings({ today: 'Сьогодні' });
    const second = resolveStrings({ zoomIn: 'Збільшити' }, first);

    expect(second.today).toBe('Сьогодні');
    expect(second.zoomIn).toBe('Збільшити');
    expect(first.zoomIn).toBe(DEFAULT_STRINGS.zoomIn);
  });

  it('FR-I18N-2: undefined puts the default of a key back', () => {
    const base = resolveStrings({ today: 'Сьогодні', zoomIn: 'Збільшити' });

    const next = resolveStrings({ today: undefined }, base);

    expect(next.today).toBe(DEFAULT_STRINGS.today);
    expect(next.zoomIn).toBe('Збільшити');
    expect(resolveStrings({ today: undefined }, DEFAULT_STRINGS)).toBe(DEFAULT_STRINGS);
  });

  it('FR-I18N-2: unknown keys are ignored', () => {
    const strings = resolveStrings({ nothing: 'x', toString: 'y' } as never);

    expect(strings).toBe(DEFAULT_STRINGS);
    expect('nothing' in strings).toBe(false);
  });

  it('FR-I18N-2: a value of the wrong kind falls back to the default of its key', () => {
    const wrong = {
      chartLabel: 5, // a number
      today: ['x'], // an array
      zoomIn: () => 'function where a string goes',
      zoomOut: '', // an empty string
      viewMode: null,
      progress: 'string where a function goes',
      workingDays: { x: 1 },
      dateRange: 7,
      linkTitle: null,
      removeLink: true,
    };

    expect(resolveStrings(wrong as never)).toBe(DEFAULT_STRINGS);
  });

  it('FR-I18N-2: a wrong value puts the default back over a good one, key by key', () => {
    const base = resolveStrings({ today: 'Сьогодні', zoomIn: 'Збільшити' });

    const next = resolveStrings({ today: 5, zoomIn: 'Ще' } as never, base);

    expect(next.today).toBe(DEFAULT_STRINGS.today);
    expect(next.zoomIn).toBe('Ще');
  });

  it('FR-I18N-2: a patch that is not an object changes nothing', () => {
    const base = resolveStrings({ today: 'Сьогодні' });

    for (const patch of [null, 'today', 5, true]) {
      expect(resolveStrings(patch as never, base)).toBe(base);
    }
  });

  it('never mutates the input or the base', () => {
    const patch = Object.freeze({ today: 'Сьогодні' });
    const base = resolveStrings(patch);
    const snapshot = { ...base };

    resolveStrings({ zoomIn: 'Збільшити' }, base);

    expect(base).toEqual(snapshot);
    expect(patch).toEqual({ today: 'Сьогодні' });
  });

  it('does not call the functions it is given', () => {
    const progress = vi.fn(() => 'x');

    resolveStrings({ progress });

    expect(progress).not.toHaveBeenCalled();
  });
});

describe('DEFAULT_STRINGS: a locale the runtime does not have', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('FR-I18N-1: the numbers of the sentences are written in English, not in the runtime’s locale', () => {
    emulateRuntimeLocale('de');

    expect(DEFAULT_STRINGS.progress(60, 'xx')).toBe('60% done');
    expect(DEFAULT_STRINGS.workingDays(2.5, 'xx-YY')).toBe('2.5 working days');
    // A locale it has is still what the numbers follow.
    expect(DEFAULT_STRINGS.workingDays(2.5, 'de')).toBe('2,5 working days');
  });
});
