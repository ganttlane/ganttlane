/**
 * Framework-free model of the playground's fixture debug table, shared by the vanilla and React
 * pages. The "flags" are a quick visual aid computed here with naive checks, not the core's
 * validation (that arrives with `model/` in plan step 2.1).
 */

import type {
  Fixture,
  FixtureEntry,
  FixtureGroup,
  FixtureLink,
  FixtureTask,
  FixtureTaskId,
} from '@ganttlane/fixtures';
import { findFixture, fixtureCatalog } from '@ganttlane/fixtures';

/** Query parameter that holds the selected fixture id. */
export const FIXTURE_PARAM = 'fixture';
/** Fixture shown when the URL names none (or an unknown one). */
export const DEFAULT_FIXTURE_ID = 'sample-project';

/** Picker sections, in display order. */
export const FIXTURE_GROUPS: readonly { group: FixtureGroup; label: string }[] = [
  { group: 'dataset', label: 'Datasets' },
  { group: 'edge-case', label: 'Edge cases' },
  { group: 'generated', label: 'Generated' },
  { group: 'scenario', label: 'Scenarios (FR-SCH-7)' },
];

/** Catalog entries of one picker section. */
export const entriesOf = (group: FixtureGroup): FixtureEntry[] =>
  fixtureCatalog.filter((entry) => entry.group === group);

/** The selection read from a URL query string. */
export interface FixtureSelection {
  entry: FixtureEntry;
  /** The id from the URL when it matched no fixture (the default is shown instead). */
  unknownId?: string;
}

/**
 * Reads the selected fixture from a query string such as `?fixture=sample-project`.
 *
 * @param search - `location.search`.
 * @returns The entry to show, plus the rejected id if the URL named an unknown fixture.
 */
export function readSelection(search: string): FixtureSelection {
  const id = new URLSearchParams(search).get(FIXTURE_PARAM);
  const fallback = findFixture(DEFAULT_FIXTURE_ID);
  if (!fallback) throw new Error(`Default fixture ${DEFAULT_FIXTURE_ID} is missing`);
  if (id === null || id === '') return { entry: fallback };
  const entry = findFixture(id);
  return entry ? { entry } : { entry: fallback, unknownId: id };
}

/**
 * Stores the selection in the URL without adding a history entry.
 *
 * @param id - Catalog id.
 */
export function writeSelection(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(FIXTURE_PARAM, id);
  window.history.replaceState(null, '', url);
}

/** One row of the debug table: display strings only. */
export interface DebugRow {
  /** Unique per row (ids may repeat in the duplicate-ids fixture). */
  key: string;
  index: number;
  id: string;
  name: string;
  depth: number;
  type: string;
  parentId: string;
  start: string;
  end: string;
  duration: string;
  progress: string;
  attributes: string;
  flags: string[];
}

/** Debug table columns, in display order. */
export const DEBUG_COLUMNS: readonly { key: keyof DebugRow; label: string }[] = [
  { key: 'index', label: '#' },
  { key: 'id', label: 'id' },
  { key: 'name', label: 'name' },
  { key: 'type', label: 'type' },
  { key: 'parentId', label: 'parentId' },
  { key: 'start', label: 'start' },
  { key: 'end', label: 'end' },
  { key: 'duration', label: 'duration' },
  { key: 'progress', label: 'progress' },
  { key: 'attributes', label: 'attributes' },
  { key: 'flags', label: 'flags' },
];

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const MINUTES_PER_DAY = 1440;

/**
 * Minutes since the epoch of a date input, treating a date-only `end` as inclusive.
 * `undefined` when absent, `NaN` when it does not parse.
 */
function toMinutes(value: FixtureTask['start'], edge: 'start' | 'end'): number | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.getTime() / 60_000;
  if (typeof value === 'number') return value / 60_000;
  const match = DATE_INPUT.exec(value);
  if (!match) return Number.NaN;
  const [, year, month, day, hours, minutes] = match;
  const [y, mo, d, h, mi] = [year, month, day, hours ?? '0', minutes ?? '0'].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || h > 23 || mi > 59) {
    return Number.NaN;
  }
  const dateOnly = hours === undefined;
  return date.getTime() / 60_000 + (dateOnly && edge === 'end' ? MINUTES_PER_DAY : 0);
}

const show = (value: FixtureTask['start']): string =>
  value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);

function showDuration(duration: FixtureTask['duration']): string {
  if (duration === undefined) return '';
  if (typeof duration === 'number') return `${duration}d`;
  if (typeof duration === 'string') return duration;
  return Object.entries(duration)
    .map(([unit, amount]) => `${String(amount)} ${unit}`)
    .join(' ');
}

function attributesOf(task: FixtureTask): string {
  const anchor = task.parentAnchor;
  return [
    task.durationMode === 'working' && 'working',
    task.locked && 'locked',
    task.fixedDuration && 'fixed',
    anchor !== undefined && `anchor ${Array.isArray(anchor) ? anchor.join('+') : anchor}`,
    task.followParent && 'follows',
    task.linkable === false && 'unlinkable',
    task.progressAnchor === 'end' && 'progress→end',
    task.className,
  ]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(', ');
}

/** The tasks of a fixture, or of a page's own copy of them (read-only: nothing here writes). */
export interface ShownTasks {
  readonly tasks: readonly FixtureTask[];
}

/**
 * Builds the debug table rows for a fixture; safe for broken data (unknown parents, parent
 * cycles, duplicate ids, unparseable dates).
 *
 * @param fixture - Fixture to show, or its tasks as a page holds them.
 * @returns One row per task, in input order.
 */
export function toDebugRows(fixture: ShownTasks): DebugRow[] {
  const byId = new Map<FixtureTaskId, FixtureTask>();
  const seen = new Map<FixtureTaskId, number>();
  for (const task of fixture.tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
    seen.set(task.id, (seen.get(task.id) ?? 0) + 1);
  }

  /** Depth via the parent chain (stops at an unknown parent); `-1` when the chain loops. */
  const depthOf = (task: FixtureTask): number => {
    const visited = new Set<FixtureTaskId>([task.id]);
    let depth = 0;
    for (let parentId = task.parentId; parentId !== undefined; depth++) {
      const parent = byId.get(parentId);
      if (!parent) break;
      if (visited.has(parentId)) return -1;
      visited.add(parentId);
      parentId = parent.parentId;
    }
    return depth;
  };

  return fixture.tasks.map((task, index): DebugRow => {
    const start = toMinutes(task.start, 'start');
    const end = toMinutes(task.end, 'end');
    const depth = depthOf(task);
    const placeholder = task.type === 'placeholder';
    const hasEnd = task.end !== undefined || task.duration !== undefined;
    const flags = [
      !placeholder && task.start === undefined && !hasEnd && 'no dates',
      !placeholder && task.start === undefined && hasEnd && 'no start',
      !placeholder && task.start !== undefined && !hasEnd && 'no end',
      (Number.isNaN(start) || Number.isNaN(end)) && 'invalid date',
      start !== undefined && end !== undefined && end < start && 'end < start',
      task.parentId !== undefined && !byId.has(task.parentId) && 'unknown parent',
      depth < 0 && 'parent cycle',
      (seen.get(task.id) ?? 0) > 1 && 'duplicate id',
      task.progress !== undefined &&
        !(task.progress >= 0 && task.progress <= 100) &&
        'progress out of range',
    ].filter((flag): flag is string => typeof flag === 'string');

    return {
      key: `${String(index)}:${String(task.id)}`,
      index: index + 1,
      id: typeof task.id === 'number' ? `${task.id} (number)` : task.id,
      name: task.name,
      depth: Math.max(depth, 0),
      type: task.type ?? 'task',
      parentId: task.parentId === undefined ? '' : String(task.parentId),
      start: show(task.start),
      end: show(task.end),
      duration: showDuration(task.duration),
      progress: task.progress === undefined ? '' : String(task.progress),
      attributes: attributesOf(task),
      flags,
    };
  });
}

/** What {@link summarize} reads: the tasks, the links and the options of a fixture. */
export interface ShownFixture extends ShownTasks {
  readonly links: readonly FixtureLink[];
  readonly options?: Fixture['options'];
}

/** Ids referenced by links that match no task. */
function brokenLinkCount(fixture: ShownFixture): number {
  const ids = new Set(fixture.tasks.map((task) => task.id));
  return fixture.links.filter((link) => !ids.has(link.source) || !ids.has(link.target)).length;
}

/**
 * One-line summary above the table.
 *
 * @param fixture - Shown fixture.
 * @param rows - Its debug rows.
 * @returns E.g. `38 tasks · 8 links · 0 flagged rows`.
 */
export function summarize(fixture: ShownFixture, rows: readonly DebugRow[]): string {
  const flagged = rows.filter((row) => row.flags.length > 0).length;
  const broken = brokenLinkCount(fixture);
  const granularity = fixture.options?.scheduling?.granularity;
  return [
    `${rows.length} tasks`,
    `${fixture.links.length} links${broken > 0 ? ` (${broken} to unknown tasks)` : ''}`,
    `${flagged} flagged rows`,
    typeof granularity === 'string' ? `granularity ${granularity}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');
}
