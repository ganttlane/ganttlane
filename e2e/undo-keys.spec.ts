import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The keys of undo and redo (plan step 7.4, FR-TX-5), on both renderers, with real key presses.
 * `ControlOrMeta` is Cmd on a Mac and Ctrl elsewhere, so the Mac path runs where it can. The pages'
 * settings are in `apps/playground/src/task-list-plan.ts`.
 */
const RENDERERS = [
  { name: 'vanilla', path: '/task-list/' },
  { name: 'React', path: '/react-task-list/' },
] as const;
type Renderer = (typeof RENDERERS)[number];

interface Hook {
  getTask(id: string): { start: Date } | undefined;
}

async function open(
  page: Page,
  renderer: Renderer,
  params: Readonly<Record<string, string>>,
): Promise<void> {
  await page.goto(`${renderer.path}?${new URLSearchParams(params).toString()}`);
  await expect(page.locator('.gantt__bar').first()).toBeVisible();
  // React's page sets its hook in an effect, after the commit that draws the bars.
  await page.waitForFunction(() => '__gantt' in window);
  await page.evaluate(() => document.fonts.ready);
}

const bar = (page: Page, id: string): Locator => page.locator(`.gantt__bar[data-task-id="${id}"]`);
const live = (page: Page): Locator => page.locator('.gantt__live');
const startOf = (page: Page, id: string): Promise<string | undefined> =>
  page.evaluate(
    (task) =>
      (window as unknown as { __gantt: Hook }).__gantt
        .getTask(task)
        ?.start.toLocaleDateString('en-CA'),
    id,
  );

/** Records, for every Ctrl or Cmd + Z / Y pressed, whether the chart took the key from the page. */
async function watchKeys(page: Page): Promise<() => Promise<boolean[]>> {
  await page.evaluate(() => {
    const taken: boolean[] = [];
    (window as unknown as { __taken: boolean[] }).__taken = taken;
    // Bubbling phase of the window: after the chart has heard the key.
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
        taken.push(event.defaultPrevented);
      }
    });
  });
  return () => page.evaluate(() => (window as unknown as { __taken: boolean[] }).__taken);
}

for (const renderer of RENDERERS) {
  test.describe(`undo and redo keys (${renderer.name})`, () => {
    const settings = { barFocus: '1', edit: '1', undo: '1', announce: '1', list: '0' };

    test(`FR-TX-5: Ctrl / Cmd + Z undoes a keyboard change, Shift + Z and Ctrl + Y redo it (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, settings);
      const before = await startOf(page, 't1');
      await page.evaluate(() => {
        (window as unknown as { __gantt: { focusBar(id: string): void } }).__gantt.focusBar('t1');
      });
      await expect(bar(page, 't1')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => startOf(page, 't1')).not.toBe(before);
      const after = await startOf(page, 't1');
      await expect(live(page)).toContainText('Task 1');

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => startOf(page, 't1')).toBe(before);
      await expect(live(page)).toContainText('Undone. Task 1');

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => startOf(page, 't1')).toBe(after);
      await expect(live(page)).toContainText('Redone. Task 1');

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => startOf(page, 't1')).toBe(before);
      await page.keyboard.press('Control+y');
      await expect.poll(() => startOf(page, 't1')).toBe(after);
    });

    test(`FR-TX-5: a Cyrillic layout undoes and redoes by the physical key (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, settings);
      const before = await startOf(page, 't1');
      await page.evaluate(() => {
        (window as unknown as { __gantt: { focusBar(id: string): void } }).__gantt.focusBar('t1');
      });
      await expect(bar(page, 't1')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => startOf(page, 't1')).not.toBe(before);
      const after = await startOf(page, 't1');
      // A Ukrainian layout types "я" and "н" on the physical Z and Y keys.
      const press = (key: string, code: string): Promise<void> =>
        page.evaluate(
          ([typed, physical]) => {
            document.activeElement?.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: typed,
                code: physical,
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
              }),
            );
          },
          [key, code] as const,
        );
      await press('я', 'KeyZ');
      await expect.poll(() => startOf(page, 't1')).toBe(before);
      await press('н', 'KeyY');
      await expect.poll(() => startOf(page, 't1')).toBe(after);
    });

    test(`FR-TX-5: with nothing to undo the key stays with the browser (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, settings);
      const taken = await watchKeys(page);
      await bar(page, 't1').focus();
      await page.keyboard.press('ControlOrMeta+z');
      await page.keyboard.press('Control+y');
      await expect.poll(async () => (await taken()).length).toBe(2);
      expect(await taken()).toEqual([false, false]);
    });

    test(`FR-TX-5: an input inside the chart keeps its own undo (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, settings);
      const before = await startOf(page, 't1');
      await page.evaluate(() => {
        (window as unknown as { __gantt: { focusBar(id: string): void } }).__gantt.focusBar('t1');
      });
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => startOf(page, 't1')).not.toBe(before);
      const after = await startOf(page, 't1');
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'probe';
        document.querySelector('.gantt__scroller')?.append(input);
      });
      const taken = await watchKeys(page);
      await page.locator('#probe').focus();
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await taken()).length).toBe(1);
      expect(await taken()).toEqual([false]);
      expect(await startOf(page, 't1')).toBe(after);
    });

    test(`FR-TX-5: it is off unless asked for (${renderer.name})`, async ({ page }) => {
      await open(page, renderer, { barFocus: '1', edit: '1', list: '0' });
      const before = await startOf(page, 't1');
      await page.evaluate(() => {
        (window as unknown as { __gantt: { focusBar(id: string): void } }).__gantt.focusBar('t1');
      });
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => startOf(page, 't1')).not.toBe(before);
      const after = await startOf(page, 't1');
      const taken = await watchKeys(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await taken()).length).toBe(1);
      expect(await taken()).toEqual([false]);
      expect(await startOf(page, 't1')).toBe(after);
    });
  });
}
