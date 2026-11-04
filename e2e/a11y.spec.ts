import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The accessibility of the chart (plan step 7.11, FR-A11Y-1, FR-A11Y-2, FR-A11Y-3, FR-EDIT-9), on both
 * renderers, written once: axe over the chart and its task list in every state that draws something
 * else (the options on, the dark theme, a tooltip open, after a keyboard change), and what a real
 * browser alone can say about the arrow keys, the live region and a context menu. axe cannot judge
 * the contrast of SVG text (it reports it as incomplete); `styles.test.ts` pins the token pairs.
 * The pages' settings are in `apps/playground/src/task-list-plan.ts`.
 */
const RENDERERS = [
  { name: 'vanilla', path: '/task-list/' },
  { name: 'React', path: '/react-task-list/' },
] as const;
type Renderer = (typeof RENDERERS)[number];

/** Collects what the page logs as an error, to be checked at the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function open(
  page: Page,
  renderer: Renderer,
  params: Readonly<Record<string, string>> = {},
): Promise<void> {
  await page.goto(`${renderer.path}?${new URLSearchParams(params).toString()}`);
  await expect(page.locator('.gantt__bar').first()).toBeVisible();
  // React's page sets its hook in an effect, after the commit that draws the bars.
  await page.waitForFunction(() => '__gantt' in window);
  await page.evaluate(() => document.fonts.ready);
}

const bar = (page: Page, id: string): Locator => page.locator(`.gantt__bar[data-task-id="${id}"]`);
const track = (page: Page, id: string): Locator => bar(page, id).locator('.gantt__bar-track');
const live = (page: Page): Locator => page.locator('.gantt__live');

/** What the page's hook says. */
interface Hook {
  focusBar(id: string): void;
  getTask(id: string): { start: Date; end: Date } | undefined;
  on(name: string, handler: (changeSet: { reason: string }) => void): () => void;
  core: { getSnapshot(): { feedback: { phase: string } } };
}
declare global {
  interface Window {
    __gantt: Hook;
    __reasons?: string[];
  }
}

/** The inclusive dates of a task, as ISO days. */
const datesOf = (page: Page, id: string): Promise<string> =>
  page.evaluate((task) => {
    const found = window.__gantt.getTask(task);
    const day = (date: Date | undefined): string => date?.toLocaleDateString('en-CA') ?? '';
    return `${day(found?.start)}/${day(found?.end)}`;
  }, id);

/** Starts collecting the reasons of the changes the chart reports. */
const collectReasons = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.__reasons = [];
    window.__gantt.on('tasksChange', (changeSet) => window.__reasons?.push(changeSet.reason));
  });
const reasons = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window.__reasons ?? [])]);

/** The violations axe finds in the chart and its list (the page around them is the playground's). */
async function violations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page }).include('.plan').analyze();
  return results.violations.map(({ id, nodes }) => ({
    id,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
}

for (const renderer of RENDERERS) {
  test.describe(`axe (${renderer.name})`, () => {
    test(`FR-A11Y-1: the chart as it is has no violations (${renderer.name})`, async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { list: '0' });
      expect(await violations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`FR-A11Y-1: the check can fail: a control without a name inside the chart is reported (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      expect(await violations(page)).toEqual([]);
      await page.evaluate(() => {
        const control = document.createElement('div');
        control.setAttribute('role', 'button');
        control.tabIndex = 0;
        document.querySelector('.gantt')?.append(control);
      });
      const found = (await violations(page)) as { id: string }[];
      expect(found.map(({ id }) => id)).toContain('aria-command-name');
    });

    test(`FR-A11Y-1, FR-A11Y-3: named bars in the dark theme have no violations (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1', theme: 'dark' });
      await expect(page.locator('.gantt__bar[role="button"][aria-label]').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`FR-A11Y-1, FR-A11Y-2: bars, keyboard editing, the live region and the task list have no violations (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, {
        barFocus: '1',
        edit: '1',
        announce: '1',
        multiple: '1',
        cells: '1',
      });
      await expect(live(page)).toHaveAttribute('role', 'status');
      expect(await violations(page)).toEqual([]);
    });

    test(`FR-A11Y-2: it has none after a keyboard change, with a selection, and with a tooltip open (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { barFocus: '1', edit: '1', multiple: '1' });
      await page.evaluate(() => {
        window.__gantt.focusBar('t1');
      });
      await expect(bar(page, 't1')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(live(page)).toContainText('Task 1');
      await page.keyboard.press('Enter');
      await expect(bar(page, 't1')).toHaveAttribute('aria-pressed', 'true');
      expect(await violations(page)).toEqual([]);
      await track(page, 't2').hover();
      await expect(page.locator('.gantt__popover[role="tooltip"]')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });

  test.describe(`keyboard editing (${renderer.name})`, () => {
    test(`FR-EDIT-9: Left and Right move the focused task one day, and the name and the region say so (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { list: '0', barFocus: '1', edit: '1' });
      await collectReasons(page);
      expect(await datesOf(page, 't1')).toBe('2026-03-05/2026-03-08');
      await page.evaluate(() => {
        window.__gantt.focusBar('t1');
      });
      await expect(bar(page, 't1')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => datesOf(page, 't1')).toBe('2026-03-06/2026-03-09');
      await expect(live(page)).toContainText('Task 1, Mar 6, 2026 – Mar 9, 2026');
      await expect(bar(page, 't1')).toHaveAttribute(
        'aria-label',
        /^Task 1, Mar 6, 2026 – Mar 9, 2026/,
      );
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => datesOf(page, 't1')).toBe('2026-03-05/2026-03-08');
      expect(await reasons(page)).toEqual(['move', 'move']);
      // The bar still has the focus, and the key moved no scroll.
      await expect(bar(page, 't1')).toBeFocused();
      expect(errors).toEqual([]);
    });

    test(`FR-EDIT-9: Shift moves the end, Alt and Shift the start, and a task keeps one day (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1', edit: '1' });
      await collectReasons(page);
      await page.evaluate(() => {
        window.__gantt.focusBar('t1');
      });
      await expect(bar(page, 't1')).toBeFocused();
      await page.keyboard.press('Shift+ArrowRight');
      await expect.poll(() => datesOf(page, 't1')).toBe('2026-03-05/2026-03-09');
      await page.keyboard.press('Alt+Shift+ArrowRight');
      await expect.poll(() => datesOf(page, 't1')).toBe('2026-03-06/2026-03-09');
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await expect.poll(() => datesOf(page, 't1')).toBe('2026-03-05/2026-03-09');
      for (let press = 0; press < 5; press += 1) await page.keyboard.press('Shift+ArrowLeft');
      await expect.poll(() => datesOf(page, 't1')).toBe('2026-03-05/2026-03-05');
      await expect.poll(() => reasons(page)).toContain('resize-start');
      expect(
        (await reasons(page)).every((reason) => /^(move|resize-start|resize-end)$/.test(reason)),
      ).toBe(true);
      await expect(live(page)).toContainText('Task 1');
    });

    test(`FR-EDIT-9: without keyboard.edit the arrows change nothing and add no region (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await page.evaluate(() => {
        window.__gantt.focusBar('t1');
      });
      await expect(bar(page, 't1')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowRight');
      expect(await datesOf(page, 't1')).toBe('2026-03-05/2026-03-08');
      await expect(live(page)).toHaveCount(0);
    });

    test(`FR-A11Y-2: a selection made by code is said where a click does not select (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1', announce: '1' });
      await expect(live(page)).toHaveText('');
      await page.evaluate(() => {
        (window.__gantt as unknown as { select(ids: string[]): void }).select(['t2']);
      });
      await expect(live(page)).toHaveText('Task 2 selected');
    });
  });

  test.describe(`a context menu on a press (${renderer.name})`, () => {
    test(`FR-EDIT-1: the press that opens a menu is no gesture, and moving afterwards drags nothing (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      const phase = (): Promise<string> =>
        page.evaluate(() => window.__gantt.core.getSnapshot().feedback.phase);
      const box = await track(page, 't1').boundingBox();
      if (box === null) throw new Error('no bar');
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      // Safari on macOS: a press with Ctrl, then contextmenu, and no release.
      await page.evaluate(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        const init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' };
        target?.dispatchEvent(
          new PointerEvent('pointerdown', {
            ...init,
            isPrimary: true,
            button: 0,
            ctrlKey: true,
            clientX: x,
            clientY: y,
          }),
        );
      }, at);
      await expect.poll(phase).toBe('pressed');
      await page.evaluate(({ x, y }) => {
        document.elementFromPoint(x, y)?.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 0,
            ctrlKey: true,
          }),
        );
      }, at);
      await expect.poll(phase).toBe('idle');
      await page.mouse.move(at.x + 120, at.y);
      await page.mouse.move(at.x + 160, at.y);
      expect(await phase()).toBe('idle');
      expect(await datesOf(page, 't1')).toBe('2026-03-05/2026-03-08');
    });

    test(`FR-EDIT-1: a right click on a bar leaves the chart idle (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await track(page, 't1').click({ button: 'right' });
      await expect
        .poll(() => page.evaluate(() => window.__gantt.core.getSnapshot().feedback.phase))
        .toBe('idle');
      expect(await datesOf(page, 't1')).toBe('2026-03-05/2026-03-08');
    });
  });
}
