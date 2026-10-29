import type { TaskRecord } from '@ganttlane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_STRINGS, resolveStrings } from '../../testing';
import { emulateRuntimeLocale } from '../../testing/runtime-locale';
import type { GanttStrings } from '../types';
import { defaultTaskContent } from './task-content';
import type { TaskPreview, TaskTooltipContext } from './types';

const duration = (workingDays: number): NonNullable<TaskRecord['duration']> => ({
  calendarDays: workingDays,
  workingDays,
  nonWorkingDays: 0,
  ms: workingDays * 86_400_000,
  workingMs: workingDays * 86_400_000,
});

function record(fields: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'design',
    name: 'Design',
    task: { id: 'design', name: 'Design' },
    type: 'task',
    precision: 'day',
    start: new Date(2026, 2, 2),
    end: new Date(2026, 2, 6),
    endExclusive: new Date(2026, 2, 7),
    duration: duration(5),
    progress: 60,
    progressDate: new Date(2026, 2, 5),
    level: 0,
    parentId: undefined,
    childIds: [],
    rowIndex: 0,
    isExpanded: false,
    issues: [],
    conflicts: [],
    ...fields,
  };
}

function context(
  task: TaskRecord,
  fields: { preview?: TaskPreview; locale?: string } = {},
): TaskTooltipContext {
  return {
    task,
    preview: fields.preview,
    isDragging: fields.preview !== undefined,
    gesture: undefined,
    parent: undefined,
    predecessors: [],
    successors: [],
    locale: fields.locale ?? 'en',
    api: { getTask: () => undefined, getLink: () => undefined, hide: () => undefined },
  };
}

const contentOf = (
  tooltip: TaskTooltipContext,
  strings: GanttStrings = DEFAULT_STRINGS,
): ReturnType<typeof defaultTaskContent> => defaultTaskContent(tooltip, strings);

describe('defaultTaskContent', () => {
  it('FR-TIP-1: shows the name, the dates, the progress and the working days', () => {
    expect(contentOf(context(record()))).toEqual({
      title: 'Design',
      subtitle: 'Mar 2, 2026 – Mar 6, 2026',
      details: '60% done · 5 working days',
    });
  });

  it('FR-TIP-1: a task with a time of day shows it', () => {
    const content = contentOf(
      context(
        record({
          precision: 'time',
          start: new Date(2026, 2, 2, 9, 0),
          end: new Date(2026, 2, 2, 17, 30),
          duration: duration(0.5),
        }),
      ),
    );

    expect(content.subtitle).toMatch(/Mar 2, 2026.*9:00.*–.*Mar 2, 2026.*5:30/);
    expect(content.details).toBe('60% done · 0.5 working days');
  });

  it('FR-TIP-1: a one-day task shows its date once, and one working day is singular', () => {
    const content = contentOf(
      context(record({ end: new Date(2026, 2, 2), duration: duration(1) })),
    );

    expect(content.subtitle).toBe('Mar 2, 2026');
    expect(content.details).toBe('60% done · 1 working day');
  });

  it('FR-TIP-1, FR-I18N-1: dates follow the locale of the chart', () => {
    const content = contentOf(context(record(), { locale: 'de' }));

    expect(content.subtitle).toBe('02.03.2026 – 06.03.2026');
  });

  it('FR-EDIT-8: while dragging it shows the previewed dates, progress and working days', () => {
    const preview: TaskPreview = {
      start: new Date(2026, 2, 9),
      end: new Date(2026, 2, 13),
      endExclusive: new Date(2026, 2, 14),
      progress: 25.4,
      workingDays: 4,
    };

    expect(contentOf(context(record(), { preview }))).toEqual({
      title: 'Design',
      subtitle: 'Mar 9, 2026 – Mar 13, 2026',
      details: '25% done · 4 working days',
    });
  });

  it('FR-TIP-1: a milestone shows one date and no length', () => {
    const content = contentOf(
      context(record({ type: 'milestone', end: new Date(2026, 2, 3), duration: duration(0) })),
    );

    expect(content).toEqual({ title: 'Design', subtitle: 'Mar 2, 2026', details: undefined });
  });

  it('FR-TIP-1: a row without dates shows its name only', () => {
    const content = contentOf(
      context(
        record({
          type: 'placeholder',
          start: undefined,
          end: undefined,
          endExclusive: undefined,
          duration: undefined,
        }),
      ),
    );

    expect(content).toEqual({ title: 'Design' });
  });
});

/** A Ukrainian pack: plurals by `Intl.PluralRules`, numbers by the locale it is given. */
const UKRAINIAN = resolveStrings({
  progress: (percent, locale) => `${percent.toLocaleString(locale)} % виконано`,
  workingDays: (days, locale) => {
    const word = {
      one: 'робочий день',
      few: 'робочі дні',
      many: 'робочих днів',
      other: 'робочого дня',
      zero: '',
      two: '',
    }[new Intl.PluralRules(locale).select(days)];
    return `${days.toLocaleString(locale)} ${word}`;
  },
  dateRange: (from, to) => `${from} — ${to}`,
});

describe('defaultTaskContent: locale and strings (FR-I18N-1, FR-I18N-2)', () => {
  it('FR-I18N-1: the dates are formatted for the locale, the words stay English', () => {
    const { subtitle, details } = contentOf(context(record(), { locale: 'uk' }));

    expect(subtitle).toContain('бер');
    expect(subtitle).toMatch(/^2 .*2026.* – 6 .*2026/);
    expect(details).toBe('60% done · 5 working days');
  });

  it('FR-I18N-1: the decimal separator is the locale’s', () => {
    const half = record({ duration: duration(0.5) });

    expect(contentOf(context(half, { locale: 'en' })).details).toBe('60% done · 0.5 working days');
    expect(contentOf(context(half, { locale: 'uk' })).details).toBe('60% done · 0,5 working days');
    // German puts a no-break space before the percent sign.
    expect(contentOf(context(half, { locale: 'de' })).details).toBe(
      '60\u00a0% done · 0,5 working days',
    );
  });

  it('FR-I18N-1: a locale with another calendar writes its years (Buddhist era)', () => {
    const { subtitle } = contentOf(context(record(), { locale: 'th-TH-u-ca-buddhist' }));

    expect(subtitle).toContain('2569');
    expect(subtitle).not.toContain('2026');
  });

  it('FR-I18N-2: every line is made by its string, which gets the values and the locale', () => {
    const progress = vi.fn((percent: number, locale: string) => `${percent}@${locale}`);
    const workingDays = vi.fn((days: number, locale: string) => `${days}@${locale}`);
    const dateRange = vi.fn(
      (from: string, to: string, locale: string) => `${from}..${to}@${locale}`,
    );
    const strings = resolveStrings({ progress, workingDays, dateRange });

    const { subtitle, details } = contentOf(context(record(), { locale: 'uk' }), strings);

    expect(progress).toHaveBeenCalledExactlyOnceWith(60, 'uk');
    expect(workingDays).toHaveBeenCalledExactlyOnceWith(5, 'uk');
    expect(dateRange).toHaveBeenCalledOnce();
    expect(dateRange.mock.calls[0]?.[2]).toBe('uk');
    expect(details).toBe('60@uk · 5@uk');
    expect(subtitle).toMatch(/^.+\.\..+@uk$/);
  });

  it('FR-I18N-2: the numbers are rounded for the strings: whole percent, one decimal of days', () => {
    const preview: TaskPreview = {
      start: new Date(2026, 2, 9),
      end: new Date(2026, 2, 13),
      endExclusive: new Date(2026, 2, 14),
      progress: 25.4,
      workingDays: 3.14159,
    };
    const progress = vi.fn((percent: number) => String(percent));
    const workingDays = vi.fn((days: number) => String(days));

    contentOf(context(record(), { preview }), resolveStrings({ progress, workingDays }));

    expect(progress).toHaveBeenCalledWith(25, 'en');
    expect(workingDays).toHaveBeenCalledWith(3.1, 'en');
  });

  it.each([
    [1, '1 робочий день'],
    [2, '2 робочі дні'],
    [5, '5 робочих днів'],
    [21, '21 робочий день'],
    [0.5, '0,5 робочого дня'],
  ])('FR-I18N-2: plural forms are the strings’ job, with Intl.PluralRules (%s)', (days, text) => {
    const { details } = contentOf(
      context(record({ duration: duration(days) }), { locale: 'uk' }),
      UKRAINIAN,
    );

    expect(details).toBe(`60 % виконано · ${text}`);
  });

  it('FR-I18N-2: a translated pack replaces the dates line, a milestone and one day need no range', () => {
    const range = contentOf(context(record(), { locale: 'uk' }), UKRAINIAN).subtitle;
    const milestone = record({ type: 'milestone', end: new Date(2026, 2, 3) });
    const oneDay = record({ end: new Date(2026, 2, 2) });

    expect(range).toMatch(/ — /);
    expect(contentOf(context(milestone, { locale: 'uk' }), UKRAINIAN).subtitle).not.toMatch(/ — /);
    expect(contentOf(context(oneDay, { locale: 'uk' }), UKRAINIAN).subtitle).not.toMatch(/ — /);
  });

  it('FR-I18N-2: the strings are used as they are, never as markup', () => {
    const strings: GanttStrings = resolveStrings({ progress: () => '<b>done</b>' });

    expect(contentOf(context(record()), strings).details).toMatch(/^<b>done<\/b> · /);
  });

  describe('a locale the runtime does not have', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('FR-I18N-1: the dates and the numbers are English, not the runtime’s own locale', () => {
      emulateRuntimeLocale('de');

      expect(contentOf(context(record(), { locale: 'xx' }))).toEqual({
        title: 'Design',
        subtitle: 'Mar 2, 2026 – Mar 6, 2026',
        details: '60% done · 5 working days',
      });
      const time = record({ precision: 'time', start: new Date(2026, 2, 2, 9, 30) });
      expect(contentOf(context(time, { locale: 'xx-YY' })).subtitle).toMatch(
        /^Mar 2, 2026,? 9:30\sAM – /,
      );
    });

    it('FR-I18N-1: a locale the runtime has is still the one used', () => {
      emulateRuntimeLocale('de');

      expect(contentOf(context(record(), { locale: 'uk' })).subtitle).toMatch(/бер/);
    });
  });
});
