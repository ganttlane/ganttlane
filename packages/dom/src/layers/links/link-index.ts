import {
  type BarGeometry,
  type Conflict,
  type GanttSnapshot,
  type Layout,
  linkBBox,
  type LinkGraph,
  type LinkRect,
  type LinkRoute,
  type LinkType,
  routeLink,
  type RowLayout,
  type TaskId,
} from '@ganttlane/core';

/**
 * What a route was made from. It stays valid exactly while every field still equals the
 * current value, so a layout that was rebuilt for another reason (a draft that moved one bar, a
 * data change elsewhere) leaves the routes of untouched links as they are.
 */
interface Geometry {
  readonly type: LinkType;
  readonly radius: number;
  readonly rowGap: number;
  readonly source: BarGeometry;
  readonly target: BarGeometry;
  /** `linkBBox` of the input above: the box tested against the window. */
  readonly bbox: LinkRect;
  /** `routeLink` of the input above, made when the link is first drawn. */
  route: LinkRoute | undefined;
}

/**
 * A link that can be drawn: what the link graph says (`type`, rows, cycle) and what the index
 * knows about its current picture (`geometry`, `selected`, `conflict`). Entries are reused
 * between calls of {@link LinkIndex.visible}, so a layer can key its nodes by `id` and read the
 * flags without allocating per update. Internal to the links layer.
 */
export interface LinkEntry {
  /** `LinkRecord.id`. */
  readonly id: string;
  /** Link type at the time the entry was made. */
  readonly type: LinkType;
  /** Row index of the source in the layout the entry was made for. */
  readonly sourceRow: number;
  /** Row index of the target. */
  readonly targetRow: number;
  /** The first row of the two. */
  readonly rowLo: number;
  /** The last row of the two. */
  readonly rowHi: number;
  /** The link is on a cycle (`ActiveLinkRecord.inCycle`). */
  readonly cycle: boolean;
  /** Set by `visible`: this is the selected link (`snapshot.selection.link`). */
  selected: boolean;
  /** Set by `visible`: a `link-violated` conflict names this link. */
  conflict: boolean;
  /** The cached route input and box; present while the entry is a candidate. */
  geometry: Geometry | undefined;
  /** Epoch of the candidate list this entry last belonged to (see `selectCandidates`). */
  mark: number;
}

/**
 * Decides which links to draw and keeps their routes, so that a frame costs what changed.
 * Internal to the links layer.
 */
export interface LinkIndex {
  /**
   * The links to draw for a snapshot, in link graph order: active links of rows that exist
   * (not hidden by a collapsed parent) whose box (`linkBBox`) touches the snapshot's window, rows
   * and time, overscan included. Each entry has its `selected` and `conflict` flags set and a
   * route available through {@link routeOf}.
   *
   * Cost: the link table is rebuilt only when the link graph or the rows change; a window
   * change costs one integer comparison per link plus a box test per link in the rows of the
   * window; a route is made only for a link whose bars, type or radius changed.
   *
   * @param snapshot - The snapshot to draw.
   * @param radius - `display.linkCurveRadius`.
   * @returns The entries to draw. A new array per call; the entries are shared.
   */
  visible(snapshot: GanttSnapshot, radius: number): readonly LinkEntry[];
  /** Forgets every link and route. */
  clear(): void;
}

/**
 * The route of an entry returned by {@link LinkIndex.visible}: `routeLink` of its bars, made on
 * first use and kept until the link's geometry changes.
 *
 * @param entry - An entry of the last `visible` call.
 * @returns The route, or `undefined` for an entry without geometry.
 */
export function routeOf(entry: LinkEntry): LinkRoute | undefined {
  const { geometry } = entry;
  if (geometry === undefined) return undefined;
  geometry.route ??= routeLink({
    type: geometry.type,
    source: geometry.source,
    target: geometry.target,
    options: { curveRadius: geometry.radius, rowGap: geometry.rowGap },
  });
  return geometry.route;
}

const NO_ENTRIES: readonly LinkEntry[] = Object.freeze([]);
const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Creates the index of one chart instance.
 *
 * @returns A new, empty index.
 */
export function createLinkIndex(): LinkIndex {
  // The table: every active link between rows that exist, in graph order. Valid for one link
  // graph over one row layout.
  let graph: LinkGraph | undefined;
  let rows: RowLayout | undefined;
  let table: readonly LinkEntry[] = NO_ENTRIES;
  // The candidates: the table entries whose rows touch the window's rows. Only these hold a
  // geometry, so memory follows the window, not the plan.
  let candidates: readonly LinkEntry[] = NO_ENTRIES;
  let candidatesOf: readonly LinkEntry[] | undefined;
  let candidatesFirst = 0;
  let candidatesLast = -1;
  let epoch = 0;
  let conflicts: ReadonlyMap<TaskId, readonly Conflict[]> | undefined;
  let violated: ReadonlySet<string> = NO_IDS;

  /** Rebuilds the table, carrying the geometry of links that are still candidates over. */
  const rebuild = (nextGraph: LinkGraph, nextRows: RowLayout): void => {
    const kept = new Map<string, Geometry>();
    for (const entry of candidates) {
      if (entry.geometry !== undefined) kept.set(entry.id, entry.geometry);
    }
    const entries: LinkEntry[] = [];
    const carried: LinkEntry[] = [];
    for (const link of nextGraph.links) {
      // An inactive link touches a task without a bar; a link to a row that is not in the
      // layout touches a task hidden by a collapsed parent. Neither is drawn.
      if (!link.active) continue;
      const source = nextRows.rowOf(link.source);
      const target = nextRows.rowOf(link.target);
      if (source === undefined || target === undefined) continue;
      const geometry = kept.get(link.id);
      const entry: LinkEntry = {
        id: link.id,
        type: link.type,
        sourceRow: source.index,
        targetRow: target.index,
        rowLo: Math.min(source.index, target.index),
        rowHi: Math.max(source.index, target.index),
        cycle: link.inCycle,
        selected: false,
        conflict: false,
        geometry,
        mark: 0,
      };
      entries.push(entry);
      if (geometry !== undefined) carried.push(entry);
    }
    graph = nextGraph;
    rows = nextRows;
    table = entries;
    // The carried entries are checked against the next window by `selectCandidates`, which
    // drops the geometry of the ones that left.
    candidates = carried;
    candidatesOf = undefined;
  };

  /** Picks the table entries whose rows (one row of slack) touch rows `first … last`. */
  const selectCandidates = (first: number, last: number): void => {
    if (candidatesOf === table && candidatesFirst === first && candidatesLast === last) return;
    const next: LinkEntry[] = [];
    epoch++;
    if (first <= last) {
      for (const entry of table) {
        // One row of slack: an arrowhead may reach into the next row of a thin row layout.
        if (entry.rowLo - 1 <= last && entry.rowHi + 1 >= first) {
          entry.mark = epoch;
          next.push(entry);
        }
      }
    }
    for (const entry of candidates) {
      if (entry.mark !== epoch) entry.geometry = undefined;
    }
    candidates = next;
    candidatesOf = table;
    candidatesFirst = first;
    candidatesLast = last;
  };

  return {
    visible(snapshot, radius): readonly LinkEntry[] {
      const { layout, window, layoutOptions, selection } = snapshot;
      const { derived } = snapshot.state;
      if (derived.graph !== graph || layout.rows !== rows) rebuild(derived.graph, layout.rows);
      if (derived.conflicts !== conflicts) {
        conflicts = derived.conflicts;
        violated = violatedLinks(derived.conflicts);
      }

      const firstRow = layout.rows.rows[window.firstRow];
      const lastRow = layout.rows.rows[window.lastRow];
      if (window.firstRow > window.lastRow || firstRow === undefined || lastRow === undefined) {
        selectCandidates(1, 0);
        return NO_ENTRIES;
      }
      selectCandidates(window.firstRow, window.lastRow);

      const { left, right } = window;
      const top = firstRow.y;
      const bottom = lastRow.y + lastRow.height;
      const rowGap = Math.max(layoutOptions.rowHeight - layoutOptions.barHeight, 0);
      const selected = selection.link;
      const out: LinkEntry[] = [];
      for (const entry of candidates) {
        const geometry = geometryOf(entry, layout, radius, rowGap);
        if (geometry === undefined) continue;
        const { bbox } = geometry;
        if (
          bbox.x > right ||
          bbox.x + bbox.width < left ||
          bbox.y > bottom ||
          bbox.y + bbox.height < top
        ) {
          continue;
        }
        entry.selected = entry.id === selected;
        entry.conflict = violated.has(entry.id);
        out.push(entry);
      }
      return out;
    },
    clear(): void {
      graph = undefined;
      rows = undefined;
      conflicts = undefined;
      violated = NO_IDS;
      table = NO_ENTRIES;
      candidates = NO_ENTRIES;
      candidatesOf = undefined;
    },
  };
}

/**
 * The geometry of an entry in a layout: the cached one when both bars, the type, the radius and
 * the row gap are what the route was made from, else a new one. `undefined` (and nothing kept)
 * when an end has no usable bar.
 */
function geometryOf(
  entry: LinkEntry,
  layout: Layout,
  radius: number,
  rowGap: number,
): Geometry | undefined {
  const source = layout.barAt(entry.sourceRow);
  const target = layout.barAt(entry.targetRow);
  if (source === undefined || target === undefined || !finite(source) || !finite(target)) {
    entry.geometry = undefined;
    return undefined;
  }
  const cached = entry.geometry;
  if (
    cached?.type === entry.type &&
    cached.radius === radius &&
    cached.rowGap === rowGap &&
    sameBox(cached.source, source) &&
    sameBox(cached.target, target)
  ) {
    return cached;
  }
  const geometry: Geometry = {
    type: entry.type,
    radius,
    rowGap,
    source,
    target,
    bbox: linkBBox({
      type: entry.type,
      source,
      target,
      options: { curveRadius: radius, rowGap },
    }),
    route: undefined,
  };
  entry.geometry = geometry;
  return geometry;
}

/** Whether two bars occupy the same box. */
function sameBox(a: LinkRect, b: LinkRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Whether a bar can be routed (the router throws a `RangeError` for anything else). */
function finite(bar: LinkRect): boolean {
  return Number.isFinite(bar.x + bar.y + bar.width + bar.height);
}

/** The ids of the links that a `link-violated` conflict names. */
function violatedLinks(conflicts: ReadonlyMap<TaskId, readonly Conflict[]>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const list of conflicts.values()) {
    for (const conflict of list) {
      if (conflict.type === 'link-violated') ids.add(conflict.linkId);
    }
  }
  return ids;
}
