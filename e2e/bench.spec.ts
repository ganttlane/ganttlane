import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * E2E of plan step 4.5 (NFR-PERF-1 … NFR-PERF-3) on the benchmark page: a generated plan of 1k
 * and 10k tasks is auto-scrolled and dragged in Chromium, Firefox and WebKit. The assertions are
 * functional (the DOM stays bounded however many tasks there are, the drag really previews, the
 * chart survives the run without errors) plus generous ceilings that only a real regression, not
 * a slow CI machine, would cross. The measured numbers are attached to every test report as
 * annotations (`bench`) and printed, so a run documents the speed of the machine it ran on.
 */

/** The part of the page's `BenchResult` these tests read (`apps/playground/src/bench.ts`). */
interface FrameStats {
  readonly frames: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly longFrames: number;
}
interface BenchResult {
  readonly bench: string;
  readonly tasks: number;
  readonly links: number;
  readonly coreMs: number;
  readonly mountMs: number;
  readonly firstPaintMs: number;
  readonly nodesAfterMount: number;
  readonly nodesMax: number;
  readonly scrollX: FrameStats;
  readonly scrollY: FrameStats;
  readonly workX: FrameStats;
  readonly workY: FrameStats;
  readonly fling: FrameStats;
  readonly workFling: FrameStats;
  readonly churn: {
    readonly added: number;
    readonly removed: number;
    readonly attributes: number;
    readonly nodesByLayer: Readonly<Record<string, number>>;
  };
  readonly drag: {
    readonly sendMeanMs: number;
    readonly sendP95Ms: number;
    readonly sendMaxMs: number;
    readonly frame: FrameStats;
    readonly dragging: boolean;
  };
  readonly longTasks: { readonly count: number; readonly maxMs: number } | null;
}
interface BenchWindow {
  __ganttBench?: { status: string; result?: BenchResult; error?: string };
}

/** Frames per auto-scroll and drag phase: enough to see a trend, short enough for CI. */
const FRAMES = 120;

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

/** Opens the page for a size, waits for the run to finish and returns what it measured. */
async function runBench(page: Page, size: '1k' | '10k'): Promise<BenchResult> {
  await page.goto(`/bench/?bench=${size}&run=1&frames=${String(FRAMES)}`);
  await page.waitForFunction(
    () => {
      const status = (window as unknown as BenchWindow).__ganttBench?.status;
      return status === 'done' || status === 'failed';
    },
    undefined,
    { timeout: 120_000 },
  );
  const outcome = await page.evaluate(() => (window as unknown as BenchWindow).__ganttBench);
  expect(outcome?.error).toBeUndefined();
  expect(outcome?.status).toBe('done');
  const result = outcome?.result;
  if (!result) throw new Error('the benchmark finished without a result');
  return result;
}

/** Puts the numbers in the test report and in the log. */
function report(browser: string, result: BenchResult): void {
  const f = (value: number): string => value.toFixed(1);
  const f2 = (value: number): string => value.toFixed(2);
  const stats = (s: FrameStats): string =>
    `${f(s.meanMs)} / ${f(s.p95Ms)} / ${f(s.maxMs)} ms, ${String(s.longFrames)} long`;
  const line =
    `${browser} ${result.bench}: first paint ${f(result.firstPaintMs)} ms ` +
    `(core ${f(result.coreMs)}, mount ${f(result.mountMs)}); nodes ${String(result.nodesAfterMount)} -> max ${String(result.nodesMax)}; ` +
    `scroll x ${stats(result.scrollX)}; scroll y ${stats(result.scrollY)}; ` +
    `work x ${f2(result.workX.meanMs)} / ${f2(result.workX.p95Ms)} / ${f2(result.workX.maxMs)} ms; ` +
    `work y ${f2(result.workY.meanMs)} / ${f2(result.workY.p95Ms)} / ${f2(result.workY.maxMs)} ms; ` +
    `fling ${stats(result.fling)}, work ${f2(result.workFling.meanMs)} / ${f2(result.workFling.p95Ms)} / ${f2(result.workFling.maxMs)} ms; ` +
    `churn +${f(result.churn.added)} -${f(result.churn.removed)} nodes, ${f(result.churn.attributes)} attrs per frame ` +
    `(${Object.entries(result.churn.nodesByLayer)
      .map(([layer, nodes]) => `${layer} ${f(nodes)}`)
      .join(', ')}); ` +
    `drag send ${f(result.drag.sendMeanMs)} / ${f(result.drag.sendP95Ms)} / ${f(result.drag.sendMaxMs)} ms, ` +
    `drag frame ${stats(result.drag.frame)}; long tasks ${
      result.longTasks === null
        ? 'n/a'
        : `${String(result.longTasks.count)} (max ${f(result.longTasks.maxMs)} ms)`
    }`;
  test.info().annotations.push({ type: 'bench', description: line });

  console.log(line);
}

test.describe('benchmark page (plan step 4.5)', () => {
  // A run is a few seconds of animation frames per engine; the default 30 s is tight for 10k.
  test.setTimeout(180_000);

  test('the page starts idle, offers both sizes and runs on request', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/bench/');

    await expect(page.getByTestId('bench-status')).toHaveText('idle');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Benchmark · 1k tasks');
    await expect(page.getByRole('link', { name: '10k' })).toHaveAttribute('href', '?bench=10k');
    await page.goto('/bench/?bench=nonsense&frames=10');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Benchmark · 1k tasks');

    await page.getByRole('button', { name: /Run the 1k benchmark/ }).click();
    await expect(page.getByTestId('bench-status')).toHaveText('done', { timeout: 60_000 });
    await expect(page.getByTestId('bench-first-paint')).toHaveText(/\d+(\.\d+)? ms/);
    await expect(page.getByTestId('bench-scroll-x')).toContainText('long of');
    await expect(page.getByTestId('bench-drag-send')).toHaveText(/\d/);
    expect(errors).toEqual([]);
  });

  for (const size of ['1k', '10k'] as const) {
    test(`${size}: auto-scroll and drag keep the DOM bounded and the frames alive`, async ({
      page,
      browserName,
    }) => {
      const errors = trackErrors(page);

      const result = await runBench(page, size);
      report(browserName, result);

      expect(result.tasks).toBe(size === '1k' ? 1000 : 10_000);
      expect(result.links).toBeGreaterThan(result.tasks / 10);

      // NFR-PERF-3: the chart holds the window, not the plan. A bar, a label, a few handles
      // and the grid make some hundred elements for a screen of rows, for 10 times the tasks
      // as for 1k; 3000 would still be nowhere near one node per task.
      expect(result.nodesAfterMount).toBeGreaterThan(50);
      expect(result.nodesMax).toBeLessThan(3000);
      expect(result.nodesMax - result.nodesAfterMount).toBeLessThan(1500);
      // Scrolling adds and removes nodes at the edges of the window, a handful per frame.
      expect(result.churn.added).toBeLessThan(150);
      expect(result.churn.removed).toBeLessThan(150);

      // The scroll and drag phases really ran, frame by frame.
      for (const phase of [result.scrollX, result.scrollY, result.fling, result.drag.frame]) {
        expect(phase.frames).toBe(FRAMES);
        expect(phase.meanMs).toBeGreaterThan(0);
      }
      // The drag previewed: the dragged bar carried `data-dragging` while it ran, and the
      // cancel gave the plan back.
      expect(result.drag.dragging).toBe(true);
      await expect(page.locator('#bench-chart .gantt__bar[data-dragging]')).toHaveCount(0);

      // Generous ceilings, not budgets: a frame under a second and a mean under a tenth of one
      // survive any CI machine and still catch a render that walks the whole plan.
      for (const phase of [result.scrollX, result.scrollY, result.fling, result.drag.frame]) {
        expect(phase.meanMs).toBeLessThan(100);
        expect(phase.maxMs).toBeLessThan(1500);
      }
      expect(result.drag.sendMeanMs).toBeLessThan(50);
      // Long tasks, where the browser reports them (Chromium).
      if (result.longTasks !== null) expect(result.longTasks.maxMs).toBeLessThan(1000);

      // The chart is still there and drawn after everything: the first rows, from the start.
      await expect(page.locator('#bench-chart .gantt__bar').first()).toBeAttached();
      expect(await page.locator('#bench-chart .gantt__bar').count()).toBeLessThan(400);
      expect(errors).toEqual([]);
    });
  }

  test('the node count does not grow with the plan: 10k tasks draw about what 1k do', async ({
    page,
    browserName,
  }) => {
    const errors = trackErrors(page);

    const small = await runBench(page, '1k');
    const large = await runBench(page, '10k');
    report(browserName, small);
    report(browserName, large);

    // The same viewport shows the same rows: ten times the tasks, about the same elements.
    expect(large.nodesMax).toBeLessThan(small.nodesMax * 2);
    expect(large.nodesAfterMount).toBeLessThan(small.nodesAfterMount * 2);
    expect(errors).toEqual([]);
  });
});
