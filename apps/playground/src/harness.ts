/**
 * The test hook of the editing pages (`/edit/`, vanilla, and `/react-edit/`, React; plan steps 4.7
 * and 6.1), as one contract: both pages put an object of this shape on `window.__ganttEdit`, so
 * that the e2e scenarios (`e2e/journeys/`) read and drive a chart the same way whichever renderer
 * made it. What differs is the renderer's own idiom behind each member: `update` is
 * `gantt.setOptions` on the vanilla page and new props of `<Gantt>` on the React one; `owned` is
 * the chart's own data on the one and the page's `tasks` (controlled) on the other.
 *
 * Specs drive the chart with the real mouse and keyboard; the hook is for mounting it with
 * options, reading what it reported, and calling methods that no control does.
 */
import type { ChangeSet, Gantt, GanttCore, GanttOptions, Task } from '@ganttlane/dom';

/**
 * What the pages' `mount` takes: serialisable options of the chart (`tasks`, `links`, `calendar`,
 * `viewMode`, `scheduling`, `timeline`, `scroll`, `history`, `editing`, `theme`, `locale`,
 * `tooltip`, `display`, …) plus the page's own switches.
 */
export type HarnessConfig = Partial<Omit<GanttOptions, 'now' | `on${string}`>> & {
  /** A fixed "today" (ISO date), so that the initial scroll does not depend on the clock. */
  readonly today?: string;
  /** Width of the chart in px; default the width of the page. */
  readonly width?: number;
};

/** Options that change while the chart runs (`update`). */
export type RuntimeOptions = Partial<
  Pick<GanttOptions, 'theme' | 'locale' | 'editing' | 'history' | 'tooltip' | 'display'>
>;

/** A task as the owner of the data holds it: ISO dates (`end` as the input has it) and progress. */
export interface OwnedTask {
  readonly start: string;
  readonly end: string;
  /** Percent, `0` … `100`. */
  readonly progress: number;
}

/**
 * The chart's public methods that the scenarios call by name (`edit.begin()`, `undo()`, …): the
 * `Gantt` of `createGantt` and the `ref` handle of `<Gantt>` both have them.
 */
export type HarnessChart = Pick<
  Gantt,
  | 'canRedo'
  | 'canUndo'
  | 'edit'
  | 'getBarRect'
  | 'getIssues'
  | 'getTask'
  | 'redo'
  | 'scrollToTask'
  | 'setViewMode'
  | 'undo'
>;

/** The test hook. */
export interface EditHarness {
  /** Which renderer made the chart. */
  readonly renderer: 'vanilla' | 'react';
  /** Replaces the chart with one made from `config`; clears `changes` and `events`. */
  mount(config?: HarnessConfig): void;
  /** Sets options on the chart that is running (a locale brings the strings of its language). */
  update(patch: RuntimeOptions): void;
  /** Change sets reported by `onTasksChange`, in order (`recorder.ts`). */
  readonly changes: ChangeSet[];
  /** Everything else the chart reported, in order (`recorder.ts`). */
  readonly events: string[];
  /** The mounted chart: the `Gantt` of `createGantt`, or the `ref` handle of `<Gantt>`. */
  readonly chart: HarnessChart | undefined;
  /** The mounted chart's core. */
  readonly core: GanttCore | undefined;
  /** A task as its owner holds it: the chart itself (vanilla), or the page's own tasks (React). */
  owned(id: Task['id']): OwnedTask | undefined;
}

declare global {
  interface Window {
    /** The test hook of the editing pages. */
    __ganttEdit?: EditHarness;
  }
}
