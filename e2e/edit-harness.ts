/**
 * Shared helpers of the editing e2e specs (`e2e/edit-*.spec.ts`, plan step 4.7) and of the shared
 * journeys (`e2e/journeys/`, step 6.1): opening an editing page of the playground with a chart,
 * finding bars and handles, dragging with the real mouse, and reading what the chart reported
 * through the page's test hook (`window.__ganttEdit`, the contract of
 * `apps/playground/src/harness.ts`). The vanilla page is `/edit/` (`apps/playground/src/edit.ts`);
 * the React one, `/react-edit/`, has the same hook and the same DOM.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A point or a box in CSS pixels of the page. */
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Box extends Point {
  readonly width: number;
  readonly height: number;
}

/** A task's scheduled values as the core reports them (floating milliseconds). */
export interface Patch {
  readonly start: number;
  readonly endExclusive: number;
  readonly progress: number;
  readonly precision?: 'day' | 'time';
}
/** One changed task of a change set. */
export interface ChangeRecord {
  readonly id: string | number;
  readonly before: Patch;
  readonly after: Patch;
  readonly cause: 'direct' | 'link' | 'parent';
}
/** A change set as `onTasksChange` reported it. */
export interface ChangeSetRecord {
  readonly reason: string;
  readonly changes: readonly ChangeRecord[];
}

/**
 * What the tests read of the page's test hook and of the core behind it. A function passed to
 * `page.evaluate` runs in the page and sees nothing of this module but types: it reads
 * `window.__ganttEdit` itself.
 */
interface HarnessWindow {
  __ganttEdit?: {
    mount(config: unknown): void;
    readonly changes: ChangeSetRecord[];
    readonly events: string[];
    readonly core: unknown;
  };
}

/** Collects uncaught page errors; assert it is empty at the end of a test. */
export function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

/** What the browser told about a page: uncaught errors, and what it logged as error or warning. */
export interface PageProblems {
  /** `error: …` / `warning: …` console messages and `uncaught: …` page errors, in order. */
  readonly list: string[];
}

/**
 * Warnings that a browser makes about a page by itself, and not the page or the chart: Firefox
 * reports "a scroll-linked positioning effect" once something on the page is positioned in a
 * `scroll` handler, which is how a chart keeps its sticky header labels and its window of rows
 * where the eye is.
 */
const BROWSER_DIAGNOSTICS: readonly RegExp[] = [/scroll-linked positioning effect/];

/**
 * Watches the page for anything that must not happen: an uncaught error, `console.error` (React
 * reports its development warnings that way) and `console.warn`, except the diagnostics a
 * browser makes of its own accord. Assert `list` is empty at the end.
 *
 * @param page - The page.
 * @returns The problems seen so far (the list grows).
 */
export function watchPage(page: Page): PageProblems {
  const list: string[] = [];
  page.on('pageerror', (error) => list.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      !BROWSER_DIAGNOSTICS.some((diagnostic) => diagnostic.test(text))
    ) {
      list.push(`${message.type()}: ${text}`);
    }
  });
  return { list };
}

/** Floating milliseconds of `'YYYY-MM-DD'` or `'YYYY-MM-DDTHH:mm'`, the core's own time. */
export function utc(iso: string): number {
  return Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : `${iso}:00Z`);
}

/**
 * Opens an editing page and replaces its chart with one made from `config`.
 *
 * @param page - The page.
 * @param config - Options of the chart (`mount` of the page's hook).
 * @param path - The page; default the vanilla one. `/react-edit/` (in one of the builds of
 *   `react-support.ts`) is the React one.
 */
export async function openEdit(
  page: Page,
  config: Record<string, unknown>,
  path = '/edit/',
): Promise<void> {
  await page.goto(path);
  await page.evaluate((options) => {
    const hook = (window as unknown as HarnessWindow).__ganttEdit;
    if (hook === undefined) throw new Error('the editing page has no test hook');
    hook.mount(options);
  }, config);
  await expect(page.locator('#gantt .gantt__bar').first()).toBeAttached();
}

export const root = (page: Page): Locator => page.locator('#gantt > .gantt');
export const scroller = (page: Page): Locator => page.locator('#gantt .gantt__scroller');
export const bar = (page: Page, id: string): Locator =>
  page.locator(`#gantt .gantt__bar[data-task-id="${id}"]`);
export const track = (page: Page, id: string): Locator =>
  bar(page, id).locator('.gantt__bar-track');
export const handle = (
  page: Page,
  id: string,
  part: 'resize-start' | 'resize-end' | 'progress',
): Locator => bar(page, id).locator(`.gantt__handle[data-handle="${part}"]`);
export const linkHandle = (page: Page, id: string, side: 'start' | 'end'): Locator =>
  bar(page, id).locator(`.gantt__link-handle[data-side="${side}"]`);
export const linkPreview = (page: Page): Locator =>
  page.locator('#gantt .gantt__overlay path.gantt__link-preview');

/** The box of an element on the page. */
export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${locator.toString()} has no box`);
  return box;
}

/** The centre of a box, in whole pixels so that a drag distance stays exact. */
export function centre(box: Box): Point {
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/**
 * Waits for the left edge of an element to be where it should be, give or take `tolerance` px
 * (a bar is drawn on whole or half pixels, the pointer on whole ones).
 */
export async function expectX(locator: Locator, expected: number, tolerance = 1): Promise<void> {
  await expect
    .poll(async () => Math.abs((await boxOf(locator)).x - expected), {
      message: `${locator.toString()} should start at x = ${String(expected)}`,
    })
    .toBeLessThanOrEqual(tolerance);
}

/** Pixels per day of the chart's scale. */
export const pxPerDay = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const hook = (window as unknown as HarnessWindow).__ganttEdit;
    const core = hook?.core as { getSnapshot(): { timeline: { scale: { pxPerDay: number } } } };
    return core.getSnapshot().timeline.scale.pxPerDay;
  });

/** The change sets reported so far. */
export const changesOf = (page: Page): Promise<ChangeSetRecord[]> =>
  page.evaluate(() => (window as unknown as HarnessWindow).__ganttEdit?.changes ?? []);

/** The other things the chart reported so far (`click:a`, `linkCreate:a>b`, …). */
export const eventsOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as HarnessWindow).__ganttEdit?.events ?? []);

/** Presses the primary button at `from` and drags, in steps, to `to`; the button stays down. */
export async function press(page: Page, from: Point, to?: Point, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (to !== undefined) await page.mouse.move(to.x, to.y, { steps });
}

/** A whole drag: press at `from`, move in steps to `to`, release there. */
export async function drag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  await press(page, from, to, steps);
  await page.mouse.up();
}

/** Waits two frames: whatever a release set going (hooks, commits, renders) has settled. */
export const settled = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

/** Where a test reads the change sets from: the page's test hook, or a journey's driver. */
export type ChangesSource = Page | { changes(): Promise<ChangeSetRecord[]> };

/**
 * Waits for the chart to have reported `count` change sets in all (a commit goes through async
 * hooks, and under React the page applies the data a render later) and returns the last one.
 *
 * @param source - The page (the editing page's hook), or the driver of a journey.
 * @param count - How many change sets the chart has reported in all so far, since it was mounted.
 * @returns The last change set.
 */
export async function committed(source: ChangesSource, count = 1): Promise<ChangeSetRecord> {
  const read = (): Promise<ChangeSetRecord[]> =>
    'changes' in source ? source.changes() : changesOf(source);
  await expect.poll(async () => (await read()).length).toBe(count);
  const changeSet = (await read()).at(-1);
  if (changeSet === undefined) throw new Error('no change set');
  return changeSet;
}

/** The change of one task in a change set. */
export function changeOf(changeSet: ChangeSetRecord, id: string): ChangeRecord {
  const change = changeSet.changes.find((candidate) => candidate.id === id);
  if (change === undefined) throw new Error(`the change set has no change of ${id}`);
  return change;
}
