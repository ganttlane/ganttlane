/**
 * The driver of the shared journeys (plan step 6.1): what a journey asks of a renderer, so that
 * one scenario runs on the vanilla chart (`createGantt`) and on `<Gantt>` of React. A driver
 * mounts a chart with options, changes options while it runs, reads what the chart reported,
 * calls its methods and reads its state. Everything else a journey does is the real mouse and
 * keyboard on the chart's DOM, which is the same DOM whichever renderer made it.
 *
 * Each renderer has an editing page of the playground with the same test hook
 * (`window.__ganttEdit`, the contract of `apps/playground/src/harness.ts`); the page is where
 * the renderer's own idiom lives: `update` is `gantt.setOptions` on `/edit/` and new props of
 * `<Gantt>` on `/react-edit/`, whose data is controlled (the page applies every change set to its
 * own tasks), while on `/edit/` the chart owns it.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { ChangeSetRecord, PageProblems } from '../edit-harness';
import { watchPage } from '../edit-harness';
import type { Build } from '../react-support';

export type Renderer = 'vanilla' | 'react';

/** Options of the chart, serialisable (`mount` of the hook): `tasks`, `viewMode`, `timeline`, … */
export type MountConfig = Readonly<Record<string, unknown>>;

/** Options that change while the chart runs: `theme`, `locale`, `editing`, `history`, … */
export type RuntimeOptions = Readonly<Record<string, unknown>>;

/** A task as its owner holds it (the chart itself, or the React page): ISO dates and progress. */
export interface OwnedTask {
  readonly start: string;
  readonly end: string;
  /** Percent, `0` … `100`. */
  readonly progress: number;
}

/** The diff of an edit session (`edit.getChanges()`, and what `commit` and `rollback` return). */
export interface SessionChangesRecord extends ChangeSetRecord {
  readonly links: {
    readonly added: readonly { readonly id: string }[];
    readonly removed: readonly { readonly id: string }[];
  };
}

/** The answer of `edit.begin()`, `commit()` and `rollback()`. */
export interface EditAnswer {
  readonly status: string;
  readonly changes?: SessionChangesRecord;
}

/** The answer of `undo()` and `redo()`. */
export interface HistoryAnswer {
  readonly status: string;
}

/** The methods of the chart that the journeys call, by the name of the call. */
export interface ChartMethods {
  setViewMode(id: string): void;
  scrollToTask(id: string, options?: { behavior?: 'instant' | 'smooth'; align?: string }): void;
  'edit.begin'(): EditAnswer;
  'edit.commit'(): EditAnswer;
  'edit.rollback'(): EditAnswer;
  'edit.getChanges'(): SessionChangesRecord | undefined;
  undo(): HistoryAnswer;
  redo(): HistoryAnswer;
  getIssues(): { options: unknown[]; data: unknown[] };
}

/** The properties of the chart that the journeys read, by name. */
export interface ChartReads {
  'edit.isOpen': boolean;
  'edit.isDirty': boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** What the journeys read of the core's snapshot, in one go (floating milliseconds, CSS px). */
export interface ChartState {
  readonly viewMode: string;
  readonly pxPerDay: number;
  /** Whether the chart lets a bar be moved (`editing.move`). */
  readonly canMove: boolean;
  readonly viewportWidth: number;
  readonly scrollLeft: number;
  readonly contentWidth: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

/** What a journey asks of a renderer. */
export interface ChartDriver {
  readonly renderer: Renderer;
  readonly page: Page;
  /** Uncaught errors and console errors and warnings so far; every journey ends with none. */
  readonly problems: PageProblems;
  /** Opens the editing page if it is not open, and mounts a new chart made from `config`. */
  mount(config?: MountConfig): Promise<void>;
  /** Changes options on the chart that is running. */
  update(patch: RuntimeOptions): Promise<void>;
  /** The change sets `onTasksChange` reported since `mount`, in order. */
  changes(): Promise<ChangeSetRecord[]>;
  /** Everything else the chart reported (`apps/playground/src/recorder.ts`), in order. */
  events(): Promise<string[]>;
  /** A task as its owner holds it. */
  owned(id: string): Promise<OwnedTask | undefined>;
  /** Calls a method of the chart in the page and returns its answer. */
  call<K extends keyof ChartMethods>(
    method: K,
    ...args: Parameters<ChartMethods[K]>
  ): Promise<ReturnType<ChartMethods[K]>>;
  /** Reads a property of the chart. */
  read<K extends keyof ChartReads>(path: K): Promise<ChartReads[K]>;
  /** The core's snapshot, the parts the journeys use. */
  state(): Promise<ChartState>;
  /** One value of the core's snapshot by its dotted path (`feedback.link.target`). */
  snapshot(path: string): Promise<unknown>;
}

/** What the driver reads of the hook; a function given to `page.evaluate` runs in the page. */
interface HookWindow {
  __ganttEdit?: {
    mount(config: unknown): void;
    update(patch: unknown): void;
    owned(id: string): unknown;
    readonly changes: unknown[];
    readonly events: string[];
    readonly chart: Record<string, unknown> | undefined;
    readonly core: { getSnapshot(): Record<string, unknown> } | undefined;
  };
}

/** The editing page of a renderer: where the hook lives. */
export interface EditingPage {
  readonly renderer: Renderer;
  /** Path of the page, under the base of its build. */
  readonly path: string;
}

/**
 * A driver over the hook of an editing page.
 *
 * @param page - The Playwright page.
 * @param editing - The renderer and the path of its editing page.
 * @returns The driver.
 */
function hookDriver(page: Page, editing: EditingPage): ChartDriver {
  const problems = watchPage(page);
  return {
    renderer: editing.renderer,
    page,
    problems,
    async mount(config = {}) {
      if (new URL(page.url()).pathname !== editing.path) {
        await page.goto(editing.path);
        await page.waitForFunction(
          () => (window as unknown as HookWindow).__ganttEdit !== undefined,
        );
      }
      await page.evaluate((options) => {
        const hook = (window as unknown as HookWindow).__ganttEdit;
        if (hook === undefined) throw new Error('the editing page has no test hook');
        hook.mount(options);
      }, config);
      await expect(page.locator('#gantt .gantt__bar').first()).toBeAttached();
    },
    async update(patch) {
      await page.evaluate((options) => {
        (window as unknown as HookWindow).__ganttEdit?.update(options);
      }, patch);
    },
    changes: () =>
      page.evaluate(() => (window as unknown as HookWindow).__ganttEdit?.changes ?? []) as Promise<
        ChangeSetRecord[]
      >,
    events: () => page.evaluate(() => (window as unknown as HookWindow).__ganttEdit?.events ?? []),
    owned: (id) =>
      page.evaluate(
        (taskId) => (window as unknown as HookWindow).__ganttEdit?.owned(taskId),
        id,
      ) as Promise<OwnedTask | undefined>,
    call: (method, ...args) =>
      page.evaluate(
        ({ name, values }) => {
          const chart = (window as unknown as HookWindow).__ganttEdit?.chart;
          if (chart === undefined) throw new Error('there is no chart');
          const path = name.split('.');
          const last = path.pop() ?? '';
          const owner = path.reduce<Record<string, unknown>>(
            (object, key) => object[key] as Record<string, unknown>,
            chart,
          );
          return (owner[last] as (...given: unknown[]) => unknown).apply(owner, values);
        },
        { name: method, values: args },
      ) as Promise<ReturnType<ChartMethods[typeof method]>>,
    read: (path) =>
      page.evaluate((name) => {
        const chart = (window as unknown as HookWindow).__ganttEdit?.chart;
        if (chart === undefined) throw new Error('there is no chart');
        return name.split('.').reduce<unknown>((object, key) => {
          return (object as Record<string, unknown>)[key];
        }, chart);
      }, path) as Promise<ChartReads[typeof path]>,
    state: () =>
      page.evaluate((): ChartState => {
        const core = (window as unknown as HookWindow).__ganttEdit?.core;
        if (core === undefined) throw new Error('there is no chart');
        const snapshot = core.getSnapshot() as unknown as {
          viewMode: { id: string };
          editing: { move: boolean };
          contentWidth: number;
          timeline: {
            viewportWidth: number;
            scrollLeft: number;
            range: { start: number; end: number };
            scale: { pxPerDay: number };
          };
        };
        return {
          viewMode: snapshot.viewMode.id,
          pxPerDay: snapshot.timeline.scale.pxPerDay,
          canMove: snapshot.editing.move,
          viewportWidth: snapshot.timeline.viewportWidth,
          scrollLeft: snapshot.timeline.scrollLeft,
          contentWidth: snapshot.contentWidth,
          rangeStart: snapshot.timeline.range.start,
          rangeEnd: snapshot.timeline.range.end,
        };
      }),
    snapshot: (path) =>
      page.evaluate((name) => {
        const core = (window as unknown as HookWindow).__ganttEdit?.core;
        if (core === undefined) throw new Error('there is no chart');
        return name
          .split('.')
          .reduce<unknown>(
            (object, key) => (object as Record<string, unknown> | undefined)?.[key],
            core.getSnapshot(),
          );
      }, path),
  };
}

/**
 * The driver of the vanilla chart: `createGantt` on `/edit/`. The chart owns its data.
 *
 * @param page - The Playwright page.
 * @returns The driver.
 */
export const vanillaDriver = (page: Page): ChartDriver =>
  hookDriver(page, { renderer: 'vanilla', path: '/edit/' });

/**
 * The driver of `<Gantt>` of `@ganttlane/react`: `/react-edit/` in one of the builds of the
 * playground. The page owns the data (controlled) and writes every change set into it.
 *
 * @param page - The Playwright page.
 * @param build - Which build: production, development (StrictMode), or React 18.3.
 * @returns The driver.
 */
export const reactDriver = (page: Page, build: Build): ChartDriver =>
  hookDriver(page, { renderer: 'react', path: `${build.base}/react-edit/` });
