import type { GanttCoreOptions, LinkRecord, OptionIssue, OptionIssueCode } from '@ganttlane/core';

import {
  DISPLAY_RULES,
  type DisplayOptions,
  func,
  GROUP_RULES,
  type GroupKey,
  type HighlightInput,
  type PlainDisplayKey,
  type Rule,
} from './display';
import type {
  HighlightTooltipOptions,
  LinkMenuOptions,
  TooltipOptions,
} from './layers/popover/types';
import type { RendererOptions } from './renderer';
import { type HeightOption, resolveHeight, resolveTheme, type ThemeOption } from './skeleton';
import { DEFAULT_STRINGS, type GanttStringsInput } from './strings';

/** The display options `createGantt` takes under `display`: the plain values of {@link DisplayOptions}. */
export type GanttDisplayOptions<TData = unknown> = Pick<DisplayOptions<TData>, PlainDisplayKey>;

/**
 * The toolbar (`docs/api.md` §3, FR-UI-6). Reserved for P1: nothing draws it yet, and turning it
 * on is reported as an `unsupported-option` issue.
 */
export interface ToolbarOptions {
  /** A button that scrolls to today. */
  readonly todayButton?: boolean | undefined;
  /** A selector of the view mode. */
  readonly viewModeSelect?: boolean | undefined;
  /** Zoom buttons. */
  readonly zoom?: boolean | undefined;
}

/**
 * What can be set only when the chart is created: how the renderer is mounted. `setOptions`
 * ignores `renderer`.
 */
export interface GanttMountOptions {
  /**
   * Prefix of every element id of the chart, and the id of its root; default `gantt-1`,
   * `gantt-2`, … per document. Give your own for ids that are the same on every render, e.g.
   * a server render or React's `useId()`.
   */
  readonly idPrefix?: RendererOptions['idPrefix'];
  /** Replaces built-in layers by name (advanced: custom renderers and tests). */
  readonly layers?: RendererOptions['layers'];
  /** Where frames come from; default `requestAnimationFrame` (tests pass a manual queue). */
  readonly frames?: RendererOptions['frames'];
}

/**
 * The options of `createGantt` that the renderer owns, on top of the core's
 * (`docs/api.md` §3). `createGantt` validates them like the core validates its own: an unusable
 * value is an `invalid-option` issue with the full path of the value (`tooltip.trigger`,
 * `display.gridLines`, `layout.height`, `highlights[2]`, …), the default is used instead, and
 * nothing throws.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttVisualOptions<TData = unknown> {
  /**
   * `'light'`, `'dark'`, or `'auto'` (default) to follow `prefers-color-scheme`: the
   * `data-theme` of the chart (FR-THEME-2). Changes at runtime without a redraw.
   */
  readonly theme?: ThemeOption | undefined;
  /**
   * The text the chart writes on its own (FR-I18N-2): any subset of `GanttStrings`, merged over
   * the English defaults and over the strings set before. Dates and numbers follow `locale`.
   */
  readonly strings?: GanttStringsInput | undefined;
  /**
   * Display: grid lines, today line, non-working days, row stripes, bar labels, … Merged field
   * by field with the display set before; a field set to `undefined` returns to its default.
   */
  readonly display?: GanttDisplayOptions<TData> | undefined;
  /**
   * Highlighted days, visual only: no effect on scheduling (FR-UI-3). A list replaces the one
   * set before. `display.highlights` turns drawing them on and off.
   */
  readonly highlights?: readonly HighlightInput[] | undefined;
  /**
   * The task tooltip (FR-TIP-1, FR-TIP-2, FR-EDIT-8). Taken whole: a given group replaces the
   * one set before, so a field it leaves out is back to its default.
   */
  readonly tooltip?: TooltipOptions<TData> | undefined;
  /**
   * The menu a click on a link opens (FR-TIP-4). Taken whole, like `tooltip`. `onRemove`
   * defaults to the chart's own `removeLink`.
   */
  readonly linkMenu?: LinkMenuOptions<TData> | undefined;
  /** The tooltip of highlighted and holiday days (FR-TIP-5). Taken whole, like `tooltip`. */
  readonly highlightTooltip?: HighlightTooltipOptions | undefined;
  /** The toolbar (FR-UI-6). Reserved for P1: off by default, and `unsupported-option` when on. */
  readonly toolbar?: false | ToolbarOptions | undefined;
  /**
   * Group `layout` of the core, plus `height`, which only the renderer knows (`layout.height`,
   * FR-SCROLL-3): a number of px, `'auto'` to grow with the rows and let the page scroll, or
   * left out to fill the container. Merged field by field with the layout set before.
   */
  readonly layout?: { readonly height?: HeightOption | undefined } | undefined;
  /** How the renderer is mounted; set at creation only. */
  readonly renderer?: GanttMountOptions | undefined;
}

/**
 * The options of {@link createGantt} (`docs/api.md` §3): the core's options (data, view mode,
 * locale, calendar, scheduling, hierarchy, layout, editing, history, timeline, scroll, interaction
 * and the `on<Event>` handlers) plus the renderer's, {@link GanttVisualOptions}. A key neither
 * knows is ignored.
 *
 * @typeParam TData - Type of `task.data`: it flows through `tasks`, the records and events, and
 * the render functions of `tooltip`, `linkMenu` and `display.renderBarLabel`.
 */
export type GanttOptions<TData = unknown> = GanttCoreOptions<TData> & GanttVisualOptions<TData>;

/**
 * A partial update of {@link GanttOptions} (`setOptions`): a key left out keeps its value; a key
 * given with `undefined` returns to its default. See {@link createGantt} for how each key is
 * merged and routed. `renderer` is for creation only.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttOptionsPatch<TData = unknown> = Partial<
  GanttCoreOptions<TData> & Omit<GanttVisualOptions<TData>, 'renderer'>
>;

type Fields = Readonly<Record<string, unknown>>;

/** Whether a value is a plain object, not an array and not `null`. */
export function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys the renderer owns: they never reach the core (`layout` is cut apart, see `coreOf`). */
const OWN: ReadonlySet<string> = new Set([
  'theme',
  'strings',
  'display',
  'highlights',
  'tooltip',
  'linkMenu',
  'highlightTooltip',
  'toolbar',
  'renderer',
  'onIssues',
]);

/**
 * The option groups `setOptions` merges field by field with the group set before: a field left
 * out keeps its value and a field given as `undefined` returns to its default. They are the
 * core's groups (`calendar`, `dates`, `scheduling`, `hierarchy`, `layout`, `timeline`, `scroll`,
 * `interaction`) and the renderer's `display` and `strings`. Every other option is taken whole.
 * A binding that works out *what changed* between two sets of options (React) needs this to say
 * "a field was removed" the way `setOptions` understands it.
 */
export const MERGED_OPTION_GROUPS: ReadonlySet<string> = new Set([
  'calendar',
  'dates',
  'scheduling',
  'hierarchy',
  'layout',
  'timeline',
  'scroll',
  'interaction',
  'display',
  'strings',
]);

/** The display options that are lifted to the top level, and so are not read from `display`. */
const LIFTED: ReadonlySet<string> = new Set([
  'highlightDays',
  'tooltip',
  'linkMenu',
  'highlightTooltip',
]);

/**
 * What goes to the core: the given options without the renderer's. `layout` loses `height`, and
 * is left out when `height` was all it had, so that a change of the height does not touch the
 * core's layout (and the core does not hear of `height`, which it does not know).
 *
 * @param source - Options or a patch of them.
 * @returns A new object for `createGanttCore` / `setOptions`.
 */
export function coreOf(source: Fields): Record<string, unknown> {
  const core: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (OWN.has(key)) continue;
    if (key === 'layout' && isRecord(value)) {
      const rest = Object.fromEntries(
        Object.entries(value).filter(([field]) => field !== 'height'),
      );
      if (Object.keys(rest).length > 0) core.layout = rest;
    } else core[key] = value;
  }
  return core;
}

/** An object of the fields of `rules`, every one `undefined`: a group put back to its defaults. */
export const resetOf = (rules: object): Record<string, undefined> =>
  Object.fromEntries(Object.keys(rules).map((field) => [field, undefined]));

/** The usable part of an object of fields: the fields the rules refuse are left out. */
const usable = (rules: Readonly<Record<string, Rule>>, value: Fields): Fields =>
  Object.fromEntries(
    Object.entries(value).filter(([field, given]) => {
      const rule = Object.hasOwn(rules, field) ? rules[field] : undefined;
      return rule === undefined || given === undefined || rule[0](given);
    }),
  );

/** The usable part of a group of fields (`undefined` for what is no object). */
const groupOf = (group: GroupKey, value: unknown): Fields | undefined =>
  isRecord(value) ? usable(GROUP_RULES[group], value) : undefined;

/** A rule for a value of one of the kinds `typeof` names. */
const kind = (...kinds: string[]): Rule => [(value) => kinds.includes(typeof value)];

/** The fields of a highlight besides its `id`, and what each accepts (FR-UI-3). */
const HIGHLIGHT_RULES: Readonly<Record<string, Rule>> = {
  dates: [Array.isArray],
  range: [(value) => isRecord(value) && value.start != null && value.end != null],
  match: func,
  label: kind('string', 'function'),
  className: kind('string'),
  color: kind('string'),
};

/**
 * Goes through a list of highlights: the usable part of it, and what is wrong with the rest. An
 * item that is no object or has no string `id`, and an item whose `id` an earlier one has, is
 * left out; a field of the wrong kind is dropped from its item, which stays. The list itself is
 * returned when nothing was wrong, so that the renderer sees the caller's array.
 *
 * @param value - The `highlights` array, as given.
 * @param path - The option's path, the start of every issue's path.
 * @returns The usable list and the issues, each at `<path>[i]` or `<path>[i].<field>`.
 */
function inspectHighlights(
  value: readonly unknown[],
  path: string,
): { readonly list: readonly HighlightInput[]; readonly issues: readonly OptionIssue[] } {
  const issues: OptionIssue[] = [];
  const ids = new Set<string>();
  const kept: Fields[] = [];
  value.forEach((item, at) => {
    const where = `${path}[${String(at)}]`;
    if (!isRecord(item) || typeof item.id !== 'string') issues.push(issue(where, item));
    else if (ids.has(item.id)) issues.push(issue(`${where}.id`, item.id));
    else {
      ids.add(item.id);
      const found = issues.length;
      testGroup(where, item, HIGHLIGHT_RULES, issues);
      kept.push(issues.length > found ? usable(HIGHLIGHT_RULES, item) : item);
    }
  });
  return { list: (issues.length > 0 ? kept : value) as readonly HighlightInput[], issues };
}

/** The usable part of `highlights` (see {@link inspectHighlights}). */
const highlightsOf = (value: unknown): readonly HighlightInput[] | undefined =>
  Array.isArray(value) ? inspectHighlights(value as unknown[], 'highlights').list : undefined;

/**
 * The display options of the renderer made from the options (or the patch) of `createGantt`:
 * `display` as it is (without the keys that are lifted), `highlights` as `highlightDays`, and
 * the three groups, each taken whole with the fields the rules refuse left out. `linkMenu`
 * always has an `onRemove`: the caller's, or `onRemove`.
 *
 * @param source - Options or a patch of them.
 * @param creating - Whether these are the options at creation, which always give a `linkMenu`.
 * @param onRemove - What removes a link when `linkMenu.onRemove` is not given.
 * @returns What to give `mountRenderer` / `setDisplay`, `undefined` when `source` has nothing
 * for the display.
 */
export function displayOf(
  source: Fields,
  creating: boolean,
  onRemove: (link: LinkRecord) => unknown,
): DisplayOptions | undefined {
  const touched = ['display', 'highlights', 'tooltip', 'linkMenu', 'highlightTooltip'].some(
    (key) => key in source,
  );
  if (!creating && !touched) return undefined;
  // A `display` that is not an object, or is `undefined`, puts every plain option back.
  const plain = isRecord(source.display)
    ? source.display
    : 'display' in source
      ? resetOf(DISPLAY_RULES)
      : {};
  const patch: Record<string, unknown> = Object.fromEntries(
    Object.entries(plain).filter(([key]) => !LIFTED.has(key)),
  );
  if ('highlights' in source) patch.highlightDays = highlightsOf(source.highlights);
  if ('tooltip' in source) patch.tooltip = groupOf('tooltip', source.tooltip);
  if ('highlightTooltip' in source) {
    patch.highlightTooltip = groupOf('highlightTooltip', source.highlightTooltip);
  }
  if (creating || 'linkMenu' in source) {
    const menu = groupOf('linkMenu', source.linkMenu);
    patch.linkMenu = { ...menu, onRemove: menu?.onRemove ?? onRemove };
  }
  return patch;
}

// ---- validation ----

/**
 * An issue of an option, in the short form of the core's production build: the message is
 * `'<path>: <code>'`, and `value` and `suggested` say the rest (`docs/api.md` §4).
 */
function issue(
  path: string,
  value: unknown,
  suggested?: unknown,
  code: OptionIssueCode = 'invalid-option',
): OptionIssue {
  return Object.freeze({
    code,
    severity: 'error',
    message: `${path}: ${code}`,
    path,
    value,
    ...(suggested === undefined ? {} : { suggested }),
  });
}

/** An option that is planned for a later release (P1) and has no effect yet. */
const unsupported = (path: string, value: unknown): OptionIssue =>
  issue(path, value, undefined, 'unsupported-option');

/** Checks a value against a rule; `undefined` is always fine (it means the default). */
function test(path: string, value: unknown, rule: Rule, issues: OptionIssue[]): void {
  if (value !== undefined && !rule[0](value)) issues.push(issue(path, value, rule[1]));
}

/** Checks the fields of a group against the rules, or reports a group that is not an object. */
function testGroup(
  path: string,
  value: unknown,
  rules: Readonly<Record<string, Rule>>,
  issues: OptionIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) issues.push(issue(path, value));
  else
    for (const [field, rule] of Object.entries(rules))
      test(`${path}.${field}`, value[field], rule, issues);
}

/** The strings: each key takes a value of the kind of its default, and a string is not empty. */
const STRING_RULES: Readonly<Record<string, Rule>> = Object.fromEntries(
  Object.entries(DEFAULT_STRINGS).map(([key, fallback]) => [
    key,
    [(value: unknown) => typeof value === typeof fallback && value !== ''] as Rule,
  ]),
);

const THEME: Rule = [(value) => resolveTheme(value) === value, 'auto'];
const HEIGHT: Rule = [(value) => resolveHeight(value) === value];

/** The groups of fields that are checked as they are, by option. */
const GROUPS: Readonly<Record<string, Readonly<Record<string, Rule>>>> = {
  display: DISPLAY_RULES,
  strings: STRING_RULES,
  ...GROUP_RULES,
};

/** The renderer-level options that are checked, in the order of their issues. */
const CHECKED = [
  'theme',
  'strings',
  'layout',
  'display',
  'highlights',
  'tooltip',
  'linkMenu',
  'highlightTooltip',
  'toolbar',
  'direction',
  'onIssues',
] as const;

/**
 * The keys of the lists {@link checkVisual} returns, in the order their issues go in one list
 * (`layout` holds the issues of `layout.height`).
 */
export const ISSUE_KEYS: readonly string[] = CHECKED.map((key) =>
  key === 'layout' ? 'layout.height' : key,
);

/**
 * Checks the renderer-level options that `source` gives, never throwing: the issues of each, by
 * the key that holds them (`layout` holds `layout.height`), an empty list for a key that is
 * fine. A key `source` does not have is not in the result, so a patch replaces the issues of the
 * keys it gives and leaves the others. The core checks its own options.
 *
 * Also reported as `unsupported-option` (reserved for a later release): an enabled `toolbar`,
 * `direction: 'rtl'` (accepted, and drawn as `'ltr'`), `tooltip.trigger: 'focus'` (opens
 * nothing yet, like `'none'`) and `display.stickyBarLabels` / `display.expectedProgress` set to
 * `true` (accepted, and drawn as if off).
 *
 * @param source - Options or a patch of them.
 * @returns The issues by key.
 */
export function checkVisual(source: Fields): ReadonlyMap<string, readonly OptionIssue[]> {
  const found = new Map<string, readonly OptionIssue[]>();
  CHECKED.forEach((key, index) => {
    if (!(key in source)) return;
    const value = source[key];
    const issues: OptionIssue[] = [];
    if (key === 'theme') test(key, value, THEME, issues);
    else if (key === 'layout') {
      if (isRecord(value)) test('layout.height', value.height, HEIGHT, issues);
    } else if (key === 'highlights') {
      if (value !== undefined && !Array.isArray(value)) issues.push(issue(key, value));
      else if (value !== undefined)
        issues.push(...inspectHighlights(value as unknown[], key).issues);
    } else if (key === 'onIssues') {
      test(key, value, func, issues);
    } else if (key === 'toolbar') {
      if (value !== undefined && value !== false) issues.push(unsupported(key, value));
    } else if (key === 'direction') {
      if (value === 'rtl') issues.push(unsupported(key, value));
    } else {
      testGroup(key, value, GROUPS[key] ?? {}, issues);
      if (key === 'tooltip' && isRecord(value) && value.trigger === 'focus') {
        issues.push(unsupported('tooltip.trigger', 'focus'));
      }
      if (key === 'display' && isRecord(value)) {
        for (const field of ['stickyBarLabels', 'expectedProgress']) {
          if (value[field] === true) issues.push(unsupported(`display.${field}`, true));
        }
      }
    }
    found.set(ISSUE_KEYS[index] ?? key, issues);
  });
  return found;
}

/**
 * Whether two issue lists are equal item by item: the same code, path, value and suggested value
 * (`Object.is`), the fields the `issues` event goes by (`docs/api.md` §5).
 *
 * @param a - One list.
 * @param b - Another.
 * @returns `true` when they carry the same facts.
 */
export function sameIssues(a: readonly OptionIssue[], b: readonly OptionIssue[]): boolean {
  return (
    a.length === b.length &&
    a.every((found, i) => {
      const other = b[i];
      return (
        found.code === other?.code &&
        found.path === other.path &&
        Object.is(found.value, other.value) &&
        Object.is(found.suggested, other.suggested)
      );
    })
  );
}
