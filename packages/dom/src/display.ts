import type { CalendarDay, DateInput, Task, TaskId } from '@ganttlane/core';

import type {
  HighlightTooltipOptions,
  LinkMenuOptions,
  TooltipOptions,
} from './layers/popover/types';
import type { DisposableNode } from './shared';

/** Which grid lines the body draws. */
export type GridLinesOption = 'none' | 'vertical' | 'horizontal' | 'both';

/** How non-working days are shown: a fill, a striped pattern, or not at all. */
export type NonWorkingDaysOption = 'fill' | 'stripes' | false;

/** Zebra stripes of the rows: by row, by group (a parent with its children), or off. */
export type RowStripesOption = 'row' | 'group' | false;

/** Where a bar's label goes: `auto` puts it inside when it fits, else outside. */
export type BarLabelOption = 'auto' | 'inside' | 'outside' | 'none';

/**
 * A visual highlight of days: it has no effect on scheduling. Days come from `dates`,
 * a `range` (both ends inclusive) or a `match` predicate, in any combination.
 */
export interface HighlightInput {
  /** Stable id, used as the key of the highlight's nodes and in `data-highlight`. */
  readonly id: string;
  /** Single days. */
  readonly dates?: readonly DateInput[] | undefined;
  /** A run of days, both ends inclusive. */
  readonly range?: { readonly start: DateInput; readonly end: DateInput } | undefined;
  /** Days the predicate accepts. */
  readonly match?: ((day: CalendarDay) => boolean) | undefined;
  /** Text shown for a highlighted day (tooltip): a string, or one per day. */
  readonly label?: string | ((day: CalendarDay) => string) | undefined;
  /** Extra class on the highlight's nodes. */
  readonly className?: string | undefined;
  /** Colour, set as `--gantt-highlight-color` on the highlight's nodes. */
  readonly color?: string | undefined;
}

/**
 * What {@link BarLabelRenderer} is told about the bar it labels.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface BarLabelContext<TData = unknown> {
  /** Task id. */
  readonly id: TaskId;
  /** Task name. */
  readonly name: string;
  /** The caller's task, as given. */
  readonly task: Task<TData>;
  /** Progress in percent, `0` … `100`. */
  readonly progress: number;
}

/**
 * Custom bar label content: a node, a {@link DisposableNode} (a node that is told
 * when the bar is done with it), or a string (inserted as text, never parsed). `null` /
 * `undefined` falls back to the task name. For `auto` placement a plain node's width is that of
 * its text when the renderer returns; a `DisposableNode`'s width is unknown and counts as 0, so it
 * goes inside the bar (unless the bar is narrower than twice the label padding).
 *
 * @typeParam TData - Type of `task.data`.
 */
export type BarLabelRenderer<TData = unknown> = (
  context: BarLabelContext<TData>,
) => Node | DisposableNode | string | null | undefined;

/**
 * Display options of the renderer (`display` plus the visual extras).
 * `createGantt` takes the plain ones under `display` and lifts `highlightDays`, `tooltip`,
 * `linkMenu` and `highlightTooltip` to its top-level options (`highlights`, `tooltip`,
 * `linkMenu`, `highlightTooltip`).
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface DisplayOptions<TData = unknown> {
  /** Grid lines. Default `'both'`. */
  readonly gridLines?: GridLinesOption | undefined;
  /** The today line and marker. Default `true`. */
  readonly today?: boolean | undefined;
  /** Non-working days. Default `'fill'`. */
  readonly nonWorkingDays?: NonWorkingDaysOption | undefined;
  /** Whether {@link highlightDays} are drawn. Default `true`. */
  readonly highlights?: boolean | undefined;
  /** Highlighted days. Default none. */
  readonly highlightDays?: readonly HighlightInput[] | undefined;
  /** Row stripes. Default `false`. */
  readonly rowStripes?: RowStripesOption | undefined;
  /** Bar labels. Default `'auto'`. */
  readonly barLabel?: BarLabelOption | undefined;
  /** Custom bar label content. Default the task name. */
  readonly renderBarLabel?: BarLabelRenderer<TData> | undefined;
  /** Highlight a hovered bar's range in the header. Default `true`. */
  readonly headerRangeHighlight?: boolean | undefined;
  /** Largest corner radius of link routes, in px. Default `5`. */
  readonly linkCurveRadius?: number | undefined;
  /**
   * Bar labels that stay in view while scrolling. Default `false`. Not available yet:
   * the renderer ignores it, and `createGantt` reports `true` as an `unsupported-option`.
   */
  readonly stickyBarLabels?: boolean | undefined;
  /**
   * The expected-progress marker. Default `false`. Not available yet: the renderer ignores
   * it, and `createGantt` reports `true` as an `unsupported-option`.
   */
  readonly expectedProgress?: boolean | undefined;

  // ---- popovers. Each is a group taken as a whole: `setDisplay` replaces it,
  // and the popover layer applies the defaults of its fields when it reads them. ----

  /** The task tooltip: trigger, cursor following, content. */
  readonly tooltip?: TooltipOptions<TData> | undefined;
  /** The menu a click on a link opens. */
  readonly linkMenu?: LinkMenuOptions<TData> | undefined;
  /** The tooltip of highlighted and holiday days. */
  readonly highlightTooltip?: HighlightTooltipOptions | undefined;
}

/** The display options of the popover groups, which `createGantt` lifts to its top level. */
export type GroupKey = 'tooltip' | 'linkMenu' | 'highlightTooltip';

/** The display options that are plain values, which `createGantt` takes under `display`. */
export type PlainDisplayKey = Exclude<keyof DisplayOptions, GroupKey | 'highlightDays'>;

/** {@link DisplayOptions} with every default applied. Frozen. */
export interface ResolvedDisplay {
  readonly gridLines: GridLinesOption;
  readonly today: boolean;
  readonly nonWorkingDays: NonWorkingDaysOption;
  readonly highlights: boolean;
  readonly highlightDays: readonly HighlightInput[];
  readonly rowStripes: RowStripesOption;
  readonly barLabel: BarLabelOption;
  readonly renderBarLabel: BarLabelRenderer | undefined;
  readonly headerRangeHighlight: boolean;
  readonly linkCurveRadius: number;
  readonly stickyBarLabels: boolean;
  readonly expectedProgress: boolean;
  readonly tooltip: TooltipOptions;
  readonly linkMenu: LinkMenuOptions;
  readonly highlightTooltip: HighlightTooltipOptions;
}

/** The display defaults. */
export const DISPLAY_DEFAULTS: ResolvedDisplay = Object.freeze({
  gridLines: 'both',
  today: true,
  nonWorkingDays: 'fill',
  highlights: true,
  highlightDays: Object.freeze([]),
  rowStripes: false,
  barLabel: 'auto',
  renderBarLabel: undefined,
  headerRangeHighlight: true,
  linkCurveRadius: 5,
  stickyBarLabels: false,
  expectedProgress: false,
  tooltip: Object.freeze({}),
  linkMenu: Object.freeze({}),
  highlightTooltip: Object.freeze({}),
});

/**
 * What an option accepts: the test a value passes, and the plain value that replaces one that
 * fails and is suggested in its issue (`undefined`: none to suggest).
 */
export type Rule = readonly [valid: (value: unknown) => boolean, fallback?: unknown];

/** A rule for a fixed set of values; the first is the default. */
const oneOf = (...values: readonly unknown[]): Rule => [
  (value) => values.includes(value),
  values[0],
];
/** A rule for a boolean whose default is `fallback`. */
const flag = (fallback: boolean): Rule => [(value) => typeof value === 'boolean', fallback];
/** A rule for a function. */
export const func: Rule = [(value) => typeof value === 'function'];
/** A rule for a finite number, 0 or more, whose default is `fallback`. */
const size = (fallback?: number): Rule => [
  (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  fallback,
];
const object: Rule = [(value) => typeof value === 'object' && value !== null];

const D = DISPLAY_DEFAULTS;

/**
 * What each plain display option accepts; anything else is replaced by the option's default
 * (`DISPLAY_DEFAULTS`), which `createGantt` suggests in its issue.
 */
export const DISPLAY_RULES: Readonly<Record<PlainDisplayKey, Rule>> = {
  gridLines: oneOf(D.gridLines, 'none', 'vertical', 'horizontal'),
  today: flag(D.today),
  nonWorkingDays: oneOf(D.nonWorkingDays, 'stripes', false),
  highlights: flag(D.highlights),
  rowStripes: oneOf(D.rowStripes, 'row', 'group'),
  barLabel: oneOf(D.barLabel, 'inside', 'outside', 'none'),
  renderBarLabel: func,
  headerRangeHighlight: flag(D.headerRangeHighlight),
  linkCurveRadius: size(D.linkCurveRadius),
  stickyBarLabels: flag(D.stickyBarLabels),
  expectedProgress: flag(D.expectedProgress),
};

/** The fields of the three popover groups, with the rule of each. */
export const GROUP_RULES: Readonly<Record<GroupKey, Readonly<Record<string, Rule>>>> = {
  tooltip: {
    trigger: oneOf('hover', 'click', 'focus', 'none'),
    followCursor: flag(false),
    showWhileDragging: flag(true),
    render: func,
    delay: size(150),
    placement: oneOf('top', 'bottom'),
  },
  linkMenu: { render: func, onRemove: func },
  highlightTooltip: { followCursor: flag(false) },
};

/** Every display option with its rule: the plain ones and the four that are lists or groups. */
const ALL_RULES: { readonly [K in keyof ResolvedDisplay]: Rule } = {
  ...DISPLAY_RULES,
  highlightDays: [Array.isArray],
  tooltip: object,
  linkMenu: object,
  highlightTooltip: object,
};

/**
 * Resolves display options: every field merged over `base`, an unusable value replaced by its
 * default (`createGantt` reports those as issues). Returns `base` itself when nothing
 * changes, so layers can compare `context.display` by identity.
 *
 * @param patch - New values; a field left out keeps its value in `base`.
 * @param base - The current display. Default {@link DISPLAY_DEFAULTS}.
 * @returns The resolved display.
 */
export function resolveDisplay(
  patch: DisplayOptions | undefined,
  base: ResolvedDisplay = DISPLAY_DEFAULTS,
): ResolvedDisplay {
  if (patch === undefined) return base;
  const next: { -readonly [K in keyof ResolvedDisplay]: ResolvedDisplay[K] } = { ...base };
  let changed = false;
  for (const key of Object.keys(ALL_RULES) as (keyof ResolvedDisplay)[]) {
    if (!(key in patch)) continue;
    const value: unknown = patch[key];
    const used = (ALL_RULES[key][0](value) ? value : D[key]) as never;
    if (used === base[key]) continue;
    next[key] = used;
    changed = true;
  }
  return changed ? Object.freeze(next) : base;
}
