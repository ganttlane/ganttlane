import type {
  CalendarDay,
  DateAdapter,
  DateInput,
  DateTimeMs,
  DayKey,
  DayReason,
  HeaderContext,
  TimeRange,
  WorkCalendar,
} from '@ganttlane/core';
import { parseDateInput, toDayKey } from '@ganttlane/core';

import { createReconciler, createSvg, setAttr, setAttrs, setCssVar, withClass } from '../../shared';
import type { HighlightInput, NonWorkingDaysOption } from '../types';

/**
 * Days narrower than this many px are not drawn, neither as non-working days nor as
 * highlights: at 1 px a day (the year view) a weekend is a hairline, and the window spans
 * thousands of days.
 */
export const MIN_DAY_PX = 2;

/** Side and spacing of the stripes pattern tile, in px. */
const STRIPES_TILE = 8;

/** Calls `visit` for each day that starts before `time.end` and ends after `time.start`. */
function eachDay(
  time: TimeRange,
  adapter: DateAdapter,
  visit: (start: DateTimeMs, key: DayKey) => void,
): void {
  for (let day = adapter.startOf(time.start, 'day'); day < time.end;) {
    visit(day, toDayKey(day));
    day = adapter.add(day, 1, 'day');
  }
}

// ---- non-working days ----

/** One non-working day to draw. */
interface NonWorkingItem {
  readonly key: DayKey;
  readonly x: number;
  readonly width: number;
  readonly reason: DayReason;
}

/** What {@link NonWorkingSection.sync} draws from. */
export interface NonWorkingInput {
  readonly mode: NonWorkingDaysOption;
  /** The time to draw; `undefined` for none. */
  readonly time: TimeRange | undefined;
  readonly header: HeaderContext;
  readonly calendar: WorkCalendar;
  /** Height of every rect: the body height. */
  readonly height: number;
}

/** The non-working days of the visible time (`g.gantt__nonworking`). */
export interface NonWorkingSection {
  /** Draws the non-working days, or removes them when the mode is off. */
  sync(input: NonWorkingInput): void;
  /** Removes the days and the stripes pattern. */
  clear(): void;
}

/**
 * Creates the non-working days' section: one `rect.gantt__nonworking-day[data-day][data-reason]`
 * per non-working day of the time (FR-UI-2), keyed by day, in a group with
 * `data-mode="fill|stripes"`. In stripes mode the rects are filled with a `pattern` of the
 * instance (`context.id('stripes')`, class `gantt__stripes`, hatch lines in `line` children
 * that the theme gives a `stroke`), created in a `defs` under the group.
 *
 * @param context - The layer's context (document and the instance's ids).
 * @param container - The group the rects go into; the section owns it.
 * @returns The section.
 */
export function createNonWorkingSection(
  context: { readonly document: Document; id(name: string): string },
  container: SVGGElement,
): NonWorkingSection {
  const { document } = context;
  let defs: SVGDefsElement | undefined;
  let fill: string | undefined;
  let height = 0;

  const days = createReconciler<NonWorkingItem, DayKey, SVGRectElement>(container, {
    key: (item) => item.key,
    create: () => createSvg(document, 'rect', { class: 'gantt__nonworking-day' }),
    update: (rect, item) => {
      setAttrs(rect, {
        x: item.x,
        y: 0,
        width: item.width,
        height,
        fill,
        'data-day': item.key,
        'data-reason': item.reason,
      });
    },
    node: (rect) => rect,
  });

  const removePattern = (): void => {
    defs?.remove();
    defs = undefined;
  };

  return {
    sync({ mode, time, header, calendar, height: bodyHeight }): void {
      setAttr(container, 'data-mode', mode === false ? undefined : mode);
      if (mode === 'stripes') {
        if (defs === undefined) {
          defs = createStripes(document, context.id('stripes'));
          container.append(defs);
        }
        fill = `url(#${context.id('stripes')})`;
      } else {
        removePattern();
        fill = undefined;
      }
      height = bodyHeight;
      const items: NonWorkingItem[] = [];
      const { scale, adapter } = header;
      if (mode !== false && time !== undefined && scale.pxPerDay >= MIN_DAY_PX) {
        eachDay(time, adapter, (start, key) => {
          if (calendar.isWorkingDay(key)) return;
          items.push({
            key,
            x: scale.dateToX(start),
            width: scale.pxPerDay,
            reason: calendar.explain(key).reason,
          });
        });
      }
      days.sync(items);
    },
    clear(): void {
      days.clear();
      removePattern();
    },
  };
}

/** The `defs` with the hatch pattern; the lines get their colour from the theme. */
function createStripes(document: Document, id: string): SVGDefsElement {
  const middle = STRIPES_TILE / 2;
  const line = createSvg(document, 'line', {
    class: 'gantt__stripes-line',
    x1: middle,
    y1: 0,
    x2: middle,
    y2: STRIPES_TILE,
  });
  const pattern = createSvg(
    document,
    'pattern',
    {
      id,
      class: 'gantt__stripes',
      patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)',
      width: STRIPES_TILE,
      height: STRIPES_TILE,
    },
    line,
  );
  return createSvg(document, 'defs', undefined, pattern);
}

// ---- highlights ----

/** A highlight with its dates parsed to day keys. */
interface CompiledHighlight {
  readonly input: HighlightInput;
  /** Prefix of the node keys: the list index and the id, so that equal ids do not merge nodes. */
  readonly tag: string;
  readonly dates: ReadonlySet<number>;
  /** First and last day of the range, both inclusive. */
  readonly range: { readonly from: number; readonly to: number } | undefined;
  /** The predicate, when the input has a function there. */
  readonly match: ((day: CalendarDay) => boolean) | undefined;
}

/** One highlighted day to draw. */
interface HighlightItem {
  readonly key: string;
  readonly input: HighlightInput;
  readonly day: DayKey;
  readonly x: number;
  readonly width: number;
}

/** What {@link HighlightsSection.sync} draws from. */
export interface HighlightsInput {
  /** Whether highlights are shown at all (`display.highlights`). */
  readonly enabled: boolean;
  readonly highlights: readonly HighlightInput[];
  /** The time to draw; `undefined` for none. */
  readonly time: TimeRange | undefined;
  readonly header: HeaderContext;
  /** Height of every rect: the body height. */
  readonly height: number;
}

/** The highlighted days of the visible time (`g.gantt__highlights`). */
export interface HighlightsSection {
  /**
   * Draws the highlights' days, or removes them when they are off.
   *
   * @returns The errors the `match` predicates threw, one per highlight: every day is drawn
   *   first, and the caller throws once its own drawing is done.
   */
  sync(input: HighlightsInput): readonly unknown[];
  /** Removes every highlighted day. */
  clear(): void;
}

/**
 * Creates the highlights' section: one `rect.gantt__highlight[data-highlight][data-day]` per
 * highlighted day of the time (FR-UI-3), keyed by the highlight's place in the list, its id and
 * the day, so highlights that share an id each keep their days (and their own class and colour).
 * The days of a highlight come from its `dates`, its `range` and its `match` predicate; only
 * days inside the time are resolved, so a range of years costs the visible days only. The
 * input's `className` joins the class and its `color` becomes `--gantt-highlight-color` of the
 * rect.
 *
 * The list is data from outside, so every field is checked here too: an entry that is not an
 * object, `dates` that is not an array, a `range` that is not an object with two readable ends
 * and a `match` that is not a function are skipped, and the highlight keeps the days its other
 * fields give. A `match` that throws is asked about the next day all the same; its first error
 * of the draw is returned by `sync`, not thrown, so that the rest of the grid is drawn first.
 *
 * @param document - Document that owns the nodes.
 * @param container - The group the rects go into; the section owns it.
 * @returns The section.
 */
export function createHighlightsSection(
  document: Document,
  container: SVGGElement,
): HighlightsSection {
  let height = 0;
  // Parsed once per list and adapter; the list comes from the display, which is frozen.
  let compiled:
    { list: readonly HighlightInput[]; adapter: DateAdapter; days: Compiled } | undefined;

  const rects = createReconciler<HighlightItem, string, SVGRectElement>(container, {
    key: (item) => item.key,
    create: () => createSvg(document, 'rect', { class: 'gantt__highlight' }),
    update: (rect, { input, day, x, width }) => {
      setAttrs(rect, {
        class: withClass('gantt__highlight', input.className),
        'data-highlight': input.id,
        'data-day': day,
        x,
        y: 0,
        width,
        height,
      });
      setCssVar(
        rect,
        '--gantt-highlight-color',
        typeof input.color === 'string' ? input.color : undefined,
      );
    },
    node: (rect) => rect,
  });

  return {
    sync({ enabled, highlights, time, header, height: bodyHeight }): readonly unknown[] {
      height = bodyHeight;
      const { scale, adapter } = header;
      const items: HighlightItem[] = [];
      const errors = new Map<CompiledHighlight, unknown>();
      if (enabled && time !== undefined && highlights.length > 0 && scale.pxPerDay >= MIN_DAY_PX) {
        if (compiled?.list !== highlights || compiled.adapter !== adapter) {
          compiled = { list: highlights, adapter, days: compile(highlights) };
        }
        const days = compiled.days;
        eachDay(time, adapter, (start, key) => {
          let calendarDay: CalendarDay | undefined;
          for (const highlight of days) {
            let hit =
              highlight.dates.has(key) ||
              (highlight.range !== undefined &&
                key >= highlight.range.from &&
                key <= highlight.range.to);
            if (!hit && highlight.match !== undefined) {
              calendarDay ??= describeDay(adapter, start, key);
              try {
                hit = highlight.match.call(highlight.input, calendarDay);
              } catch (error) {
                if (!errors.has(highlight)) errors.set(highlight, error);
              }
            }
            if (hit) {
              items.push({
                key: `${highlight.tag}:${key}`,
                input: highlight.input,
                day: key,
                x: scale.dateToX(start),
                width: scale.pxPerDay,
              });
            }
          }
        });
      }
      rects.sync(items);
      return [...errors.values()];
    },
    clear(): void {
      rects.clear();
      compiled = undefined;
    },
  };
}

type Compiled = readonly CompiledHighlight[];

/**
 * Parses the `dates` and `range` of the highlights, whatever they hold: what cannot be read is
 * left out, and an entry that is not an object is skipped.
 */
function compile(list: readonly HighlightInput[]): Compiled {
  return list.flatMap((input, index): CompiledHighlight[] => {
    const raw: unknown = input;
    if (typeof raw !== 'object' || raw === null) return [];
    const { id, dates, range, match } = raw as Partial<Record<keyof HighlightInput, unknown>>;
    const days = new Set<number>();
    if (Array.isArray(dates)) {
      for (const date of dates as unknown[]) {
        const key = dayOf(date);
        if (key !== undefined) days.add(key);
      }
    }
    const ends: { start?: unknown; end?: unknown } =
      typeof range === 'object' && range !== null ? range : {};
    const from = dayOf(ends.start);
    const to = dayOf(ends.end);
    return [
      {
        input,
        tag: `${index}:${String(id)}`,
        dates: days,
        range: from === undefined || to === undefined ? undefined : { from, to },
        match: typeof match === 'function' ? (match as CompiledHighlight['match']) : undefined,
      },
    ];
  });
}

/** The day key of a date input, `undefined` when it cannot be read (or is not a date at all). */
function dayOf(input: unknown): number | undefined {
  const parsed = parseDateInput(input as DateInput);
  return parsed.ok ? toDayKey(parsed.value.value) : undefined;
}

/** What a `match` predicate is told about a day. */
function describeDay(adapter: DateAdapter, start: DateTimeMs, key: DayKey): CalendarDay {
  const { weekday, year, month, day } = adapter.getParts(start);
  return { dayKey: key, date: start, weekday, year, month, day };
}
