import { describe, expect, it } from 'vitest';

import { VIEW_MODE_PRESETS } from '../scale';
import { type DateTimeMs, DAY, parseDateInput } from '../time';
import { resolveScrollOptions, resolveTimelineOptions, type TimelineOptions } from './options';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

const day = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;
const ZERO = { months: 0, ms: 0 };
const days = (n: number): { months: number; ms: number } => ({ months: 0, ms: n * DAY });

describe('viewport/resolveTimelineOptions', () => {
  it('FR-TL-1: defaults, and the view mode padding', () => {
    const { options, issues } = resolveTimelineOptions(undefined);
    expect(options).toEqual({
      range: undefined,
      padding: [ZERO, ZERO],
      includeToday: false,
      infinite: undefined,
    });
    expect(issues).toEqual([]);
    expect(Object.isFrozen(options)).toBe(true);
    expect(resolveTimelineOptions({}, { viewMode: day }).options.padding).toEqual([
      days(14),
      days(14),
    ]);
    // An unchecked custom view mode with a broken padding counts as none.
    const broken = { padding: 'soon' } as unknown as typeof day;
    expect(resolveTimelineOptions({}, { viewMode: broken }).options.padding).toEqual([ZERO, ZERO]);
  });

  it('FR-TL-1: padding as one duration or [before, after]', () => {
    const one = resolveTimelineOptions({ padding: '1w' }, { viewMode: day });
    expect(one.options.padding).toEqual([days(7), days(7)]);
    const pair = resolveTimelineOptions({ padding: ['1d', '1mo'] });
    expect(pair.options.padding).toEqual([days(1), { months: 1, ms: 0 }]);
    // Zero is fine for padding.
    expect(resolveTimelineOptions({ padding: '0d' }, { viewMode: day }).issues).toEqual([]);
  });

  it('FR-TL-1: an explicit range with an inclusive date-only end', () => {
    const input: TimelineOptions = { range: { start: '2026-03-01', end: '2026-03-31' } };
    expect(resolveTimelineOptions(input).options.range).toEqual({
      start: at('2026-03-01'),
      end: at('2026-04-01'),
    });
    expect(resolveTimelineOptions(input, { endInclusive: false }).options.range?.end).toBe(
      at('2026-03-31'),
    );
    const timed = { range: { start: '2026-03-01', end: '2026-03-31T12:00' } };
    expect(resolveTimelineOptions(timed).options.range?.end).toBe(at('2026-03-31T12:00'));
    expect(resolveTimelineOptions({ range: 'auto' }).options.range).toBeUndefined();
  });

  it('FR-TL-2, FR-TL-4: infinite on with defaults or with parsed settings', () => {
    expect(resolveTimelineOptions({ infinite: true }).options.infinite).toEqual({});
    expect(resolveTimelineOptions({ infinite: false }).options.infinite).toBeUndefined();
    const { options, issues } = resolveTimelineOptions({
      infinite: {
        threshold: 300,
        extendBy: '1mo',
        bounds: { min: '2020-01-01', max: '2030-12-31' },
        maxSpan: '5y',
      },
    });
    expect(issues).toEqual([]);
    expect(options.infinite).toEqual({
      threshold: 300,
      extendBy: { months: 1, ms: 0 },
      bounds: { min: at('2020-01-01'), max: at('2031-01-01') },
      maxSpan: { months: 60, ms: 0 },
    });
    expect(
      resolveTimelineOptions({ infinite: { bounds: { max: '2030-12-31T18:00' } } }).options
        .infinite,
    ).toEqual({
      bounds: { max: at('2030-12-31T18:00') },
    });
    const onlyMin = resolveTimelineOptions({ infinite: { bounds: { min: '2020-01-01' } } });
    expect(onlyMin.options.infinite).toEqual({ bounds: { min: at('2020-01-01') } });
  });

  it('reports every unusable value and falls back to its default', () => {
    const { options, issues } = resolveTimelineOptions(
      {
        range: { start: '2026-03-10', end: '2026-03-01' },
        padding: ['1d'],
        includeToday: 'yes',
        infinite: {
          threshold: -5,
          extendBy: '0d',
          bounds: { min: '2030-01-01', max: '2020-01-01' },
          maxSpan: '5m',
        },
      } as unknown as TimelineOptions,
      { viewMode: day },
    );
    expect(options).toEqual({
      range: undefined,
      padding: [days(14), days(14)],
      includeToday: false,
      infinite: {},
    });
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['invalid-timeline-option', 'range'],
      ['invalid-timeline-option', 'padding'],
      ['invalid-timeline-option', 'includeToday'],
      ['invalid-timeline-option', 'infinite.threshold'],
      ['invalid-timeline-option', 'infinite.extendBy'],
      ['invalid-timeline-option', 'infinite.maxSpan'],
      ['invalid-timeline-option', 'infinite.bounds'],
    ]);
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
    expect(issues[0]!.message).toMatch(/^timeline\.range: /);
    expect(Object.isFrozen(issues[0])).toBe(true);
  });

  it('reports malformed shapes', () => {
    const bad = (input: unknown): readonly (string | undefined)[] =>
      resolveTimelineOptions(input as TimelineOptions).issues.map((issue) => issue.path);
    expect(bad('auto')).toEqual([undefined]);
    expect(bad({ range: 'all' })).toEqual(['range']);
    expect(bad({ range: { start: 'soon', end: '2026-03-01' } })).toEqual(['range.start']);
    expect(bad({ padding: 'P1Y2' })).toEqual(['padding']);
    expect(bad({ padding: ['1d', 'never'] })).toEqual(['padding[1]']);
    expect(bad({ infinite: 'always' })).toEqual(['infinite']);
    expect(bad({ infinite: { bounds: [] } })).toEqual(['infinite.bounds']);
    expect(bad({ infinite: { bounds: { min: 'x' } } })).toEqual(['infinite.bounds.min']);
    const array = resolveTimelineOptions({ range: [] } as unknown as TimelineOptions);
    expect(array.issues.map((issue) => issue.message)).toEqual([
      "timeline.range: an array is not 'auto' or { start, end }",
    ]);
    expect(resolveTimelineOptions('auto' as unknown as TimelineOptions).issues[0]!.message).toMatch(
      /^timeline: /,
    );
  });
});

describe('viewport/resolveScrollOptions', () => {
  it('FR-SCROLL-1, FR-EDIT-6: defaults', () => {
    const { options, issues } = resolveScrollOptions(undefined);
    expect(options).toEqual({
      initial: 'today',
      behavior: 'smooth',
      align: 'start',
      autoScroll: { edge: 40, maxSpeed: 20 },
    });
    expect(issues).toEqual([]);
    expect(Object.isFrozen(options)).toBe(true);
  });

  it('FR-SCROLL-1: keywords, dates, behaviours and alignments', () => {
    const { options, issues } = resolveScrollOptions({
      initial: '2026-03-01T09:00',
      behavior: 'instant',
      align: 0.3,
      autoScroll: { edge: 10 },
    });
    expect(issues).toEqual([]);
    expect(options).toEqual({
      initial: at('2026-03-01T09:00'),
      behavior: 'instant',
      align: 0.3,
      autoScroll: { edge: 10, maxSpeed: 20 },
    });
    for (const initial of ['today', 'start', 'end', 'first-task', 'none'] as const) {
      expect(resolveScrollOptions({ initial }).options.initial).toBe(initial);
    }
    expect(resolveScrollOptions({ align: 'center', autoScroll: false }).options).toMatchObject({
      align: 'center',
      autoScroll: false,
    });
  });

  it('reports every unusable value and falls back to its default', () => {
    const { options, issues } = resolveScrollOptions({
      initial: 'yesterday',
      behavior: 'fast',
      align: 2,
      autoScroll: { edge: -1, maxSpeed: NaN },
    } as unknown as Parameters<typeof resolveScrollOptions>[0]);
    expect(options).toEqual({
      initial: 'today',
      behavior: 'smooth',
      align: 'start',
      autoScroll: { edge: 40, maxSpeed: 20 },
    });
    expect(issues.map((issue) => [issue.code, issue.path, issue.suggested])).toEqual([
      ['invalid-scroll-option', 'initial', 'today'],
      ['invalid-scroll-option', 'behavior', 'smooth'],
      ['invalid-scroll-option', 'align', 'start'],
      ['invalid-scroll-option', 'autoScroll.edge', undefined],
      ['invalid-scroll-option', 'autoScroll.maxSpeed', undefined],
    ]);
    expect(issues[0]!.message).toMatch(/^scroll\.initial: /);
    const shape = resolveScrollOptions({ autoScroll: 'yes' } as unknown as Parameters<
      typeof resolveScrollOptions
    >[0]);
    expect(shape.issues.map((issue) => issue.path)).toEqual(['autoScroll']);
    expect(resolveScrollOptions(42 as never).issues.map((issue) => issue.path)).toEqual([
      undefined,
    ]);
  });
});
