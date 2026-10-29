import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { boxOf } from './edit-harness';
import { BUILDS, centre, openReact, revealTask, trackOf, watchPage } from './react-support';

/** An input the e2e marks, to tell it from a new one. */
type KeptInput = HTMLInputElement & { __kept?: boolean };
/** What the page's observer records: the nodes taken out of the popover. */
interface RemovalWindow {
  __removed: string[];
}

/**
 * The `ReactNode` slots and the `ref` handle of `<Gantt>` (plan step 5.3, FR-REACT-3, FR-REACT-4)
 * on the React playground page with `?slots=1`: a tooltip that is a React component with a state
 * of its own, and bar labels that are React, drawn through portals into the nodes the vanilla
 * renderer shows.
 */

const CHART = '.stub .chart';

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

interface ReactWindow {
  __reactLabels?: number;
  __ganttReact?: {
    getTask(id: string): { name: string } | undefined;
    getBarRect(id: string): { x: number; y: number; width: number; height: number } | undefined;
    scrollToTask(id: string, options?: object): void;
  } | null;
}

/** The labels React has mounted and not unmounted: what a left-behind portal would add to. */
const mountedLabels = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as ReactWindow).__reactLabels ?? 0);

/** Lets two animation frames pass (the chart's frame, and the React commit it causes). */
const frames = (page: Page): Promise<void> =>
  page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

test.describe('React slots (plan step 5.3)', () => {
  test('bar labels are React, in the page’s context, one per drawn bar', async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto('/react/?slots=1');

    const chart = page.locator(CHART);
    const labels = chart.locator('.gantt__bar-label .react-label');
    await expect(labels.first()).toBeVisible();
    await expect(labels.first()).toContainText('★');
    // The slot content is part of the page's tree: it reads the context the page provides.
    await expect(labels.first()).toHaveAttribute('data-page', 'playground');
    // The chart's own text labels are not drawn: the foreignObject holds the React node.
    await expect(chart.locator('text.gantt__bar-label')).toHaveCount(0);
    await expect(labels).toHaveCount(await chart.locator('.gantt__bar').count());
    // StrictMode mounts twice, and still every label is mounted once.
    await frames(page);
    expect(await mountedLabels(page)).toBe(await labels.count());
    expect(errors).toEqual([]);
  });

  test('a click opens a tooltip that is a React component, with a state of its own', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/react/?slots=1');
    const chart = page.locator(CHART);
    await expect(chart.locator('.gantt__bar').first()).toBeAttached();

    const track = chart.locator('.gantt__bar[data-task-id="group-1"] .gantt__bar-track');
    await track.scrollIntoViewIfNeeded();
    // The scroll events of that scroll come a frame late, and one that comes after a popover opened
    // closes it (as it should: the popover's boxes are stale).
    await frames(page);
    const box = await track.boundingBox();
    if (box === null) throw new Error('the bar has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const popover = page.locator('.gantt__layer > .gantt__popover');
    await expect(popover).toBeVisible();
    await expect(popover).toHaveAttribute('role', 'tooltip');
    const tooltip = popover.getByTestId('react-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(popover.locator('[data-slot="tooltip"]')).toHaveCount(1);
    await expect(tooltip.getByTestId('react-tooltip-title')).toHaveText('Planning');
    await expect(tooltip.getByTestId('react-tooltip-context')).toHaveText('playground');

    // The state of the component is React's: it counts, and the popover is still the one open.
    const counter = tooltip.getByTestId('react-tooltip-counter');
    await expect(counter).toHaveText('Clicked 0');
    await counter.click();
    await counter.click();
    await expect(counter).toHaveText('Clicked 2');
    await expect(popover).toHaveCount(1);
    await expect(popover).toHaveAttribute('data-interactive', '');

    // Escape closes it, and the React content goes with it.
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(page.locator('[data-slot="tooltip"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('another bar’s click replaces the tooltip, and a press elsewhere closes it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/react/?slots=1');
    const chart = page.locator(CHART);
    await expect(chart.locator('.gantt__bar').nth(1)).toBeAttached();

    const clickTrack = async (id: string): Promise<void> => {
      const track = chart.locator(`.gantt__bar[data-task-id="${id}"] .gantt__bar-track`);
      await track.scrollIntoViewIfNeeded();
      await frames(page);
      const box = await track.boundingBox();
      if (box === null) throw new Error('the bar has no box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const title = page.getByTestId('react-tooltip-title');

    await clickTrack('group-1');
    await expect(title).toHaveText('Planning');
    await clickTrack('group-2');
    await expect(title).not.toHaveText('Planning');
    await expect(page.getByTestId('react-tooltip')).toHaveCount(1);
    await expect(page.locator('[data-slot="tooltip"]')).toHaveCount(1);

    await page.mouse.click(5, 5);
    await expect(page.getByTestId('react-tooltip')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the ref handle drives the chart', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/react/?slots=1');
    await expect(page.locator(`${CHART} .gantt__bar`).first()).toBeAttached();

    const answer = await page.evaluate(() => {
      const handle = (window as unknown as ReactWindow).__ganttReact;
      return {
        name: handle?.getTask('group-1')?.name,
        hasBar: handle?.getBarRect('group-1') !== undefined,
      };
    });

    expect(answer).toEqual({ name: 'Planning', hasBar: true });
    expect(errors).toEqual([]);
  });

  test('a large chart keeps one portal per drawn bar while it scrolls, and leaves none behind', async ({
    page,
  }, testInfo) => {
    const errors = trackErrors(page);
    await page.goto('/react/?slots=1&fixture=generated-1k');
    // A tall chart: many bars in the window at once.
    await page.addStyleTag({ content: `${CHART} { height: 5000px; }` });
    const chart = page.locator(CHART);
    await expect(chart.locator('.gantt__bar').first()).toBeAttached();
    await frames(page);

    const result = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.stub .gantt__scroller');
      if (scroller === null) throw new Error('no chart');
      const counted = window as unknown as ReactWindow;
      const settle = async (): Promise<void> =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        });
      const drawn = (): number => document.querySelectorAll('.stub .gantt__bar').length;
      const labels = (): number =>
        document.querySelectorAll('.stub .gantt__bar-label .react-label').length;
      await settle();
      const first = { bars: drawn(), labels: labels(), mounted: counted.__reactLabels ?? 0 };
      const steps: number[] = [];
      const mismatches: string[] = [];
      for (let i = 0; i < 30; i++) {
        scroller.scrollLeft += 700;
        const start = performance.now();
        await settle();
        steps.push(performance.now() - start);
        const now = { bars: drawn(), labels: labels(), mounted: counted.__reactLabels ?? 0 };
        if (now.bars !== now.labels || now.labels !== now.mounted)
          mismatches.push(JSON.stringify(now));
      }
      const sorted = [...steps].sort((a, b) => a - b);
      return {
        first,
        mismatches,
        median: sorted[Math.floor(sorted.length / 2)] ?? 0,
        worst: sorted.at(-1) ?? 0,
      };
    });

    await testInfo.attach('portals', {
      body: `${String(result.first.bars)} bars drawn, ${String(result.first.mounted)} labels mounted; 30 scroll steps of 700 px, one settled frame (two rAFs) each: median ${result.median.toFixed(1)} ms, worst ${result.worst.toFixed(1)} ms`,
      contentType: 'text/plain',
    });
    expect(result.first.bars).toBeGreaterThan(10);
    expect(result.first.labels).toBe(result.first.bars);
    expect(result.first.mounted).toBe(result.first.bars);
    // After every scroll step the portals are exactly the bars: none left behind, none missing.
    expect(result.mismatches).toEqual([]);
    expect(errors).toEqual([]);
  });
});

/**
 * An input in a React tooltip that renames the task in the page's own (controlled) tasks (the
 * review of phase 5, FR-REACT-4): every keystroke is a new `tasks`, the chart makes its tooltip
 * again, and the input must stay in the page with the focus, or the user types into nothing.
 * Real key presses, on every build: production, development (StrictMode doubles effects, React
 * warns) and React 18.3.
 */
for (const build of BUILDS) {
  test.describe(`React slots, an input in the tooltip, ${build.name}`, () => {
    test('typing in the tooltip input renames the task: the input and its focus stay through every key', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build, { slots: '1' });
      await revealTask(page, 'group-1');
      const at = centre(await boxOf(trackOf(page, 'group-1')));
      await page.mouse.click(at.x, at.y);

      const popover = page.locator('.gantt__layer > .gantt__popover');
      const input = popover.getByTestId('react-tooltip-rename');
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('Planning');
      // The input is marked, and the removals from the popover are recorded: it must be the same
      // element at the end, and nothing (the host React draws it into) may have been taken out.
      await input.evaluate((element) => {
        (element as KeptInput).__kept = true;
        const removed: string[] = [];
        (window as unknown as RemovalWindow).__removed = removed;
        const popoverElement = element.closest('.gantt__popover');
        if (popoverElement === null) throw new Error('no popover');
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.removedNodes) {
              if (node instanceof HTMLElement) removed.push(node.dataset.slot ?? node.localName);
            }
          }
        }).observe(popoverElement, { childList: true, subtree: true });
      });
      await input.click();
      await expect(input).toBeFocused();

      await page.keyboard.type('xyz', { delay: 60 });

      await expect(input).toHaveValue('Planningxyz');
      await expect(input).toBeFocused();
      await expect(popover.getByTestId('react-tooltip-title')).toHaveText('Planningxyz');
      // The page's tasks follow (the debug table is the page's state).
      await expect(page.getByTestId('debug-table')).toContainText('Planningxyz');
      expect(await input.evaluate((element) => (element as KeptInput).__kept)).toBe(true);
      expect(await page.evaluate(() => (window as unknown as RemovalWindow).__removed)).toEqual([]);
      await expect(popover).toHaveCount(1);
      await expect(page.locator('[data-slot="tooltip"]')).toHaveCount(1);
      expect(problems.list).toEqual([]);
    });
  });
}
