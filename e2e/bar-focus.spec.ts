import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The keyboard focus of the bars and the multiple selection (plan step 7.3, FR-SEL-2, FR-SEL-3), on
 * both renderers, written once. What is checked is what a browser alone can say: where its focus
 * really is after a real Tab, key or press, that the ring shows only from the keyboard, that a bar
 * the chart scrolls away keeps the focus and one that goes away hands it on (Firefox and WebKit say
 * nothing when a focused element leaves the document), and that Firefox, which does not scroll to a
 * focused SVG group, still shows the bar. The pages' settings are in
 * `apps/playground/src/task-list-plan.ts`.
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
const row = (page: Page, id: string): Locator =>
  page.locator(`.gantt-task-list__row[data-task-id="${id}"]`);
const scroller = (page: Page): Locator => page.locator('.gantt__scroller');

/** What the page's hook says. */
interface Hook {
  core: {
    getSnapshot(): {
      scrollTop: number;
      focusedTask: unknown;
      selection: { tasks: readonly unknown[] };
      feedback: { phase: string };
      timeline: { scrollLeft: number };
      state: { derived: { graph: { linkById: Map<string, unknown> } } };
    };
  };
  focusBar(id: string): void;
  collapse(id: string): void;
  getTask(id: string): { start: Date } | undefined;
  on(name: string, handler: (record: { id: string }) => void): () => void;
}

const selected = (page: Page): Promise<readonly unknown[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __gantt: Hook }).__gantt.core.getSnapshot().selection
        .tasks as unknown[],
  );
const focusedTask = (page: Page): Promise<unknown> =>
  page.evaluate(
    () => (window as unknown as { __gantt: Hook }).__gantt.core.getSnapshot().focusedTask,
  );
/** Where the browser's focus is: a bar or a row by its task, else the tag. */
const activeTask = (page: Page): Promise<string | null | undefined> =>
  page.evaluate(() => document.activeElement?.getAttribute('data-task-id'));
const focusRingShown = (locator: Locator): Promise<boolean> =>
  locator.evaluate((node) => node.matches(':focus-visible'));

/** Whether a bar lies inside the part of the scroller that shows rows. */
async function inView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((task) => {
    const box = document
      .querySelector(`.gantt__bar[data-task-id="${task}"] .gantt__bar-track`)
      ?.getBoundingClientRect();
    const view = document.querySelector('.gantt__scroller')?.getBoundingClientRect();
    const header = document.querySelector('.gantt__header')?.getBoundingClientRect();
    if (!box || !view || !header) return false;
    return (
      box.top >= header.bottom - 1 &&
      box.bottom <= view.bottom + 1 &&
      box.left < view.right &&
      box.right > view.left
    );
  }, id);
}

for (const renderer of RENDERERS) {
  test.describe(`the focus of the bars (${renderer.name})`, () => {
    test(`FR-SEL-3: off by default the bars are no tab stop, and a press does not focus one (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { list: '0' });
      await expect(page.locator('.gantt__bar[tabindex]')).toHaveCount(0);
      await expect(page.locator('.gantt__bar[role]')).toHaveCount(0);
      await scroller(page).focus();
      await page.keyboard.press('Tab');
      expect(await activeTask(page)).toBeFalsy();
      await track(page, 't1').click();
      expect(await focusedTask(page)).toBeUndefined();
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-3: one tab stop, with a name and a ring from the keyboard, and Tab goes on past the bars (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { list: '0', barFocus: '1' });
      await expect(page.locator('.gantt__bar[tabindex="0"]')).toHaveCount(1);
      // The name is the task described: its name, its dates, its progress and its working days.
      await expect(page.getByRole('button', { name: /^Group 0, Mar 2, 2026 – / })).toHaveAttribute(
        'tabindex',
        '0',
      );

      await scroller(page).focus();
      await page.keyboard.press('Tab');
      await expect(bar(page, 't0')).toBeFocused();
      expect(await focusRingShown(bar(page, 't0'))).toBe(true);
      expect(await focusedTask(page)).toBe('t0');
      const ring = await track(page, 't0').evaluate((node) => getComputedStyle(node).outlineStyle);
      expect(ring).toBe('solid');

      // Past the last bar is the next thing on the page; a page with nothing there keeps the focus
      // in Firefox, which has no browser window to give it to here.
      await page.evaluate(() => {
        document.body.append(document.createElement('button'));
      });
      await page.keyboard.press('Tab');
      await expect(page.locator('body > button')).toBeFocused();
      expect(await focusedTask(page)).toBeUndefined();

      await bar(page, 't0').focus();
      await page.keyboard.press('Shift+Tab');
      await expect(scroller(page)).toBeFocused();
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-3: a press focuses the bar and shows no ring, and the bar is the next tab stop (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await track(page, 't3').click();
      await expect(bar(page, 't3')).toBeFocused();
      expect(await focusRingShown(bar(page, 't3'))).toBe(false);
      expect(await focusedTask(page)).toBe('t3');
      await expect(page.locator('.gantt__bar[tabindex="0"]')).toHaveAttribute('data-task-id', 't3');
    });

    test(`FR-SEL-3: the keys walk the bars and scroll to them, in both directions (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { list: '0', barFocus: '1' });
      await bar(page, 't0').focus();
      await page.keyboard.press('ArrowDown');
      await expect(bar(page, 't1')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(bar(page, 't2')).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(bar(page, 't1')).toBeFocused();
      await expect(page.locator('.gantt__bar[tabindex="0"]')).toHaveCount(1);

      await page.keyboard.press('End');
      await expect(bar(page, 't59')).toBeFocused();
      await expect.poll(() => inView(page, 't59')).toBe(true);
      await page.keyboard.press('ArrowDown');
      await expect(bar(page, 't59')).toBeFocused();

      await page.keyboard.press('Home');
      await expect(bar(page, 't0')).toBeFocused();
      await expect.poll(() => inView(page, 't0')).toBe(true);

      await page.keyboard.press('PageDown');
      const paged = await activeTask(page);
      expect(Number(paged?.slice(1))).toBeGreaterThan(3);
      await expect.poll(() => inView(page, paged ?? '')).toBe(true);
      await page.keyboard.press('PageUp');
      await expect(bar(page, 't0')).toBeFocused();
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-3: Left and Right scroll the chart and leave the focus where it is (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await bar(page, 't0').focus();
      // WebKit lets the first arrow after a focus go by, on the bare scroller as well.
      await expect(async () => {
        await page.keyboard.press('ArrowRight');
        expect(await scroller(page).evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      }).toPass();
      await expect(bar(page, 't0')).toBeFocused();
    });

    test(`FR-SEL-3: a bar the chart scrolls away keeps the focus, and the keys bring it back (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await bar(page, 't0').focus();
      await scroller(page).hover();
      // Firefox scrolls a page per wheel event at most.
      for (let step = 0; step < 5; step++) await page.mouse.wheel(0, 300);
      const top = (): Promise<number> => scroller(page).evaluate((node) => node.scrollTop);
      await expect.poll(top).toBeGreaterThan(1000);
      // The wheel has finished: a scroll it still animates would overtake the one the key asks for.
      await expect
        .poll(async () => {
          const before = await top();
          await page.waitForTimeout(100);
          return before === (await top());
        })
        .toBe(true);
      await expect(bar(page, 't0')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(bar(page, 't1')).toBeFocused();
      await expect.poll(() => inView(page, 't1')).toBe(true);
    });

    test(`FR-SEL-3: a bar that goes away hands the focus to the tab stop, not to the page (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { list: '0', barFocus: '1' });
      await bar(page, 't5').focus();
      await page.evaluate(() => {
        (window as never as { __gantt: Hook }).__gantt.collapse('t0');
      });
      await expect(bar(page, 't5')).toHaveCount(0);
      await expect.poll(() => activeTask(page)).toBeTruthy();
      const now = await activeTask(page);
      expect(await focusedTask(page)).toBe(now);
      await expect(bar(page, now ?? '')).toHaveAttribute('tabindex', '0');
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-3: rows that are sorted leave the focus on its bar, with no gap (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { list: '0', barFocus: '1', tasks: '9' });
      await page.evaluate(() => {
        const w = window as never as {
          __gantt: Hook & {
            getRows(): readonly {
              id: string;
              name: string;
              record: { start: Date; end: Date };
            }[];
            setTasks(tasks: readonly unknown[]): void;
          };
          __sort: () => void;
          __heard: unknown[];
        };
        let tasks = w.__gantt.getRows().map(({ id, name, record: { start, end } }) => {
          return { id, name, start, end };
        });
        w.__gantt.setTasks(tasks);
        w.__sort = () => {
          tasks = [...tasks].reverse();
          w.__gantt.setTasks(tasks);
        };
        w.__heard = [];
        w.__gantt.on('focusChange', (record) => {
          w.__heard.push((record as { id: string } | null)?.id ?? null);
        });
      });
      const ids = (): Promise<(string | null)[]> =>
        page
          .locator('.gantt__bar')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-task-id')));
      await expect.poll(ids).toHaveLength(9);
      const before = await ids();
      await bar(page, 't3').focus();
      await page.evaluate(() => {
        (window as never as { __sort: () => void }).__sort();
      });
      await expect.poll(ids).toEqual([...before].reverse());
      await expect(bar(page, 't3')).toBeFocused();
      expect(await focusedTask(page)).toBe('t3');
      expect(
        await page.evaluate(() => (window as never as { __heard: unknown[] }).__heard),
      ).toEqual(['t3']);
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-3, FR-A11Y-2: focusTask(undefined) takes the focus from the bar to the chart, and a scroll does not give it back (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await bar(page, 't0').focus();
      await expect.poll(() => focusedTask(page)).toBe('t0');
      await page.evaluate(() => {
        const gantt = (
          window as never as {
            __gantt: { focusTask(id: undefined): void; scrollTo(to: object): void };
          }
        ).__gantt;
        gantt.focusTask(undefined);
        gantt.scrollTo({ top: 1500, behavior: 'instant' });
      });
      await expect
        .poll(() => scroller(page).evaluate((node) => node.scrollTop))
        .toBeGreaterThan(1000);
      await expect(scroller(page)).toBeFocused();
      await expect.poll(() => focusedTask(page)).toBeUndefined();
    });

    test(`FR-SEL-3: the ring and the state of a bar show at once, and pressing Enter changes what is seen (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1', multiple: '1' });
      const look = (): Promise<{ stroke: string; ring: string; color: string }> =>
        track(page, 't1').evaluate((node) => {
          const style = getComputedStyle(node);
          return { stroke: style.stroke, ring: style.outlineStyle, color: style.outlineColor };
        });
      await scroller(page).focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowDown');
      await expect(bar(page, 't1')).toBeFocused();
      const plain = await look();
      expect(plain.ring).toBe('solid');

      await page.keyboard.press('Enter');
      await expect(bar(page, 't1')).toHaveAttribute('aria-pressed', 'true');
      const pressed = await look();
      expect(pressed.ring).toBe('solid');
      expect(pressed.color).toBe(plain.color);
      expect(pressed.stroke).not.toBe(plain.stroke);
      expect(pressed.stroke).not.toBe(plain.color);

      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(bar(page, 't1')).toHaveAttribute('aria-pressed', 'false');
      expect(await look()).toEqual(plain);

      // No ring without the keyboard: a press shows the state and nothing more.
      await track(page, 't2').click();
      await expect(bar(page, 't2')).toBeFocused();
      await expect(bar(page, 't2')).toHaveAttribute('aria-pressed', 'true');
      const pressedByMouse = await track(page, 't2').evaluate((node) => {
        const style = getComputedStyle(node);
        return { stroke: style.stroke, ring: style.outlineStyle };
      });
      expect(pressedByMouse.ring).toBe('none');
      expect(pressedByMouse.stroke).toBe(pressed.stroke);
    });

    test(`FR-SEL-3: focusBar moves the focus from anywhere and shows the bar, in every engine (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await page.evaluate(() => {
        (window as never as { __gantt: Hook }).__gantt.focusBar('t40');
      });
      await expect(bar(page, 't40')).toBeFocused();
      await expect.poll(() => inView(page, 't40')).toBe(true);
    });

    test(`FR-SEL-3: Enter and Space are a click, with taskClick and the selection (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { list: '0', barFocus: '1' });
      await page.evaluate(() => {
        const clicks: string[] = [];
        (window as never as { __clicks: string[] }).__clicks = clicks;
        (window as never as { __gantt: Hook }).__gantt.on('taskClick', (record) => {
          clicks.push(record.id);
        });
      });
      await bar(page, 't1').focus();
      await page.keyboard.press('Enter');
      expect(await selected(page)).toEqual(['t1']);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press(' ');
      expect(await selected(page)).toEqual(['t2']);
      expect(
        await page.evaluate(() => (window as never as { __clicks: string[] }).__clicks),
      ).toEqual(['t1', 't2']);
      // Space did not scroll the box as well.
      expect(await scroller(page).evaluate((node) => node.scrollTop)).toBe(0);
    });
  });

  test.describe(`the bars beside a list (${renderer.name})`, () => {
    test(`FR-SEL-3: the surface that holds the focus keeps it, and the other follows (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { barFocus: '1' });
      await bar(page, 't2').focus();
      await page.keyboard.press('ArrowDown');
      await expect(bar(page, 't3')).toBeFocused();
      await expect(row(page, 't3')).toHaveAttribute('tabindex', '0');

      await row(page, 't1').focus();
      await expect(bar(page, 't1')).toHaveAttribute('tabindex', '0');
      await page.keyboard.press('ArrowDown');
      await expect(row(page, 't2')).toBeFocused();
      await expect(bar(page, 't2')).toHaveAttribute('tabindex', '0');
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-3: going from a row to a bar and back reports each task with no gap (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { barFocus: '1' });
      await page.evaluate(() => {
        const heard: unknown[] = [];
        (window as never as { __heard: unknown[] }).__heard = heard;
        (window as never as { __gantt: Hook }).__gantt.on('focusChange', (record) => {
          heard.push((record as { id: string } | null)?.id ?? null);
        });
      });
      await row(page, 't1').focus();
      await bar(page, 't2').focus();
      await row(page, 't3').focus();
      expect(
        await page.evaluate(() => (window as never as { __heard: unknown[] }).__heard),
      ).toEqual(['t1', 't2', 't3']);
    });

    test(`FR-SEL-3: a press on a bar takes the focus from a row, and keeps it there (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { barFocus: '1' });
      await row(page, 't1').focus();
      await track(page, 't4').click();
      await expect(bar(page, 't4')).toBeFocused();
      expect(await focusedTask(page)).toBe('t4');
    });

    test(`FR-SEL-3: Tab from the list reaches the bar of the same task (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { barFocus: '1' });
      await row(page, 't3').focus();
      await expect(bar(page, 't3')).toHaveAttribute('tabindex', '0');
      // The splitter, then the scroller, then the tab stop of the bars.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(bar(page, 't3')).toBeFocused();
      expect(await focusRingShown(bar(page, 't3'))).toBe(true);
    });

    test(`FR-SEL-3: with the options off, a button in a bar's label takes the focus from a row, and the list does not take it back (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await page.evaluate(() => {
        (window as never as { __gantt: { setOptions(options: object): void } }).__gantt.setOptions({
          display: {
            barLabel: 'inside',
            renderBarLabel: () => {
              const button = document.createElement('button');
              button.textContent = 'Open';
              return button;
            },
          },
        });
        document.body.append(document.createElement('input'));
      });
      const button = bar(page, 't2').locator('button');
      await expect(button).toBeVisible();
      await row(page, 't1').focus();
      await button.focus();
      await expect(button).toBeFocused();
      await expect.poll(() => focusedTask(page)).toBeUndefined();

      const input = page.locator('body > input');
      await input.focus();
      await track(page, 't5').hover();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await expect(input).toBeFocused();
    });

    test(`FR-SEL-3: with bars that take the focus, a button in a label keeps it (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { barFocus: '1' });
      await page.evaluate(() => {
        (window as never as { __gantt: { setOptions(options: object): void } }).__gantt.setOptions({
          display: {
            barLabel: 'inside',
            renderBarLabel: () => {
              const button = document.createElement('button');
              button.textContent = 'Open';
              return button;
            },
          },
        });
      });
      const button = bar(page, 't2').locator('button');
      await expect(button).toBeVisible();
      await row(page, 't1').focus();
      await button.focus();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await expect(button).toBeFocused();
      expect(await focusedTask(page)).toBe('t2');
    });

    test(`FR-SEL-3: without barFocus the list works as before: a focusTask brings its row the focus (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await page.evaluate(() => {
        (window as never as { __gantt: { focusTask(id: string): void } }).__gantt.focusTask('t2');
      });
      await expect(row(page, 't2')).toBeFocused();
    });
  });

  test.describe(`selection.multiple (${renderer.name})`, () => {
    test(`FR-SEL-2: Ctrl or Cmd + click adds a bar and takes it out, and the list shows it (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { multiple: '1' });
      await track(page, 't1').click();
      await track(page, 't3').click({ modifiers: ['ControlOrMeta'] });
      await track(page, 't4').click({ modifiers: ['ControlOrMeta'] });
      expect(await selected(page)).toEqual(['t1', 't3', 't4']);
      await expect(row(page, 't3')).toHaveAttribute('aria-selected', 'true');
      await expect(bar(page, 't4')).toHaveAttribute('data-selected', /.*/);

      await track(page, 't3').click({ modifiers: ['ControlOrMeta'] });
      expect(await selected(page)).toEqual(['t1', 't4']);
      await expect(row(page, 't3')).toHaveAttribute('aria-selected', 'false');

      // A plain click selects one again.
      await track(page, 't2').click();
      expect(await selected(page)).toEqual(['t2']);
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-2: Ctrl or Cmd + click on a row does the same, and a plain click selects one (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { multiple: '1' });
      await expect(page.getByRole('treegrid')).toHaveAttribute('aria-multiselectable', 'true');
      await row(page, 't1').click();
      await row(page, 't3').click({ modifiers: ['ControlOrMeta'] });
      expect(await selected(page)).toEqual(['t1', 't3']);
      await expect(bar(page, 't3')).toHaveAttribute('data-selected', /.*/);
      await row(page, 't1').click({ modifiers: ['ControlOrMeta'] });
      expect(await selected(page)).toEqual(['t3']);
      await row(page, 't2').click();
      expect(await selected(page)).toEqual(['t2']);
    });

    test(`FR-SEL-2: off by default Ctrl or Cmd + click selects one, on a bar and on a row (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await track(page, 't1').click();
      await track(page, 't3').click({ modifiers: ['ControlOrMeta'] });
      expect(await selected(page)).toEqual(['t3']);
      await row(page, 't2').click({ modifiers: ['ControlOrMeta'] });
      expect(await selected(page)).toEqual(['t2']);
      await expect(page.getByRole('treegrid')).not.toHaveAttribute('aria-multiselectable', /.*/);
    });

    test(`FR-SEL-2: Ctrl or Cmd + click on an empty part keeps what a plain click there clears (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { multiple: '1' });
      await track(page, 't1').click();
      // Past the end of the bar, in its own row: a row has one bar.
      const box = (await track(page, 't1').boundingBox())!;
      const empty = { x: box.x + box.width + 100, y: box.y + box.height / 2 };
      await page.keyboard.down('ControlOrMeta');
      await page.mouse.click(empty.x, empty.y);
      await page.keyboard.up('ControlOrMeta');
      expect(await selected(page)).toEqual(['t1']);
      await page.mouse.click(empty.x, empty.y);
      expect(await selected(page)).toEqual([]);
    });

    test(`FR-SEL-2: Ctrl or Cmd + Enter adds from the keyboard, on a bar and on a row (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { multiple: '1', barFocus: '1' });
      await bar(page, 't1').focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ControlOrMeta+Enter');
      expect(await selected(page)).toEqual(['t1', 't2']);
      await row(page, 't3').focus();
      await page.keyboard.press('ControlOrMeta+Enter');
      expect(await selected(page)).toEqual(['t1', 't2', 't3']);
      await page.keyboard.press('Enter');
      expect(await selected(page)).toEqual(['t3']);
    });
  });

  test.describe(`bars that take the focus, and the gestures (${renderer.name})`, () => {
    /** Presses a bar, moves the mouse by `by` px and lets go. */
    async function drag(page: Page, id: string, by: number): Promise<void> {
      const box = (await track(page, id).boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + by / 2, y, { steps: 3 });
      await page.mouse.move(x + by, y, { steps: 3 });
      await page.mouse.up();
    }
    const startOf = (page: Page, id: string): Promise<number | undefined> =>
      page.evaluate(
        (task) => (window as never as { __gantt: Hook }).__gantt.getTask(task)?.start.getTime(),
        id,
      );

    test(`FR-EDIT-1: a drag moves the bar, leaves the selection, and the bar has the focus with no ring (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { barFocus: '1', multiple: '1' });
      await track(page, 't1').click();
      const before = await startOf(page, 't3');
      await drag(page, 't3', 120);
      expect(await startOf(page, 't3')).not.toBe(before);
      expect(await selected(page)).toEqual(['t1']);
      await expect(bar(page, 't3')).toBeFocused();
      expect(await focusRingShown(bar(page, 't3'))).toBe(false);
      expect(errors).toEqual([]);
    });

    test(`FR-SEL-2: a drag with Ctrl or Cmd is a drag: it moves the bar and toggles nothing (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { barFocus: '1', multiple: '1' });
      await track(page, 't1').click();
      const before = await startOf(page, 't3');
      await page.keyboard.down('ControlOrMeta');
      await drag(page, 't3', 120);
      await page.keyboard.up('ControlOrMeta');
      expect(await startOf(page, 't3')).not.toBe(before);
      expect(await selected(page)).toEqual(['t1']);
    });

    test(`FR-SEL-3: while a drag runs the keys do not walk the bars, and Escape still cancels it (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { barFocus: '1' });
      const before = await startOf(page, 't3');
      const box = (await track(page, 't3').boundingBox())!;
      await page.mouse.move(box.x + 10, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 4 });
      await page.keyboard.press('ArrowDown');
      await expect(bar(page, 't3')).toBeFocused();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect(await startOf(page, 't3')).toBe(before);
    });

    test(`FR-LINK-5: while a link is armed the keys do not walk, Escape disarms, and a finished link selects nothing (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { barFocus: '1', multiple: '1' });
      const phase = (): Promise<string> =>
        page.evaluate(
          () => (window as never as { __gantt: Hook }).__gantt.core.getSnapshot().feedback.phase,
        );
      const links = (): Promise<number> =>
        page.evaluate(
          () =>
            (window as never as { __gantt: Hook }).__gantt.core.getSnapshot().state.derived.graph
              .linkById.size,
        );
      const handle = (id: string): Locator =>
        bar(page, id).locator('.gantt__link-handle[data-side="end"]');
      await track(page, 't1').click();
      const count = await links();

      await bar(page, 't3').hover();
      await handle('t3').click();
      expect(await phase()).toBe('linking');
      await page.keyboard.press('ArrowDown');
      expect(await activeTask(page)).toBe('t3');
      await page.keyboard.press('Escape');
      expect(await phase()).toBe('idle');
      expect(await links()).toBe(count);

      await bar(page, 't3').hover();
      await handle('t3').click();
      await track(page, 't5').click();
      expect(await links()).toBe(count + 1);
      expect(await selected(page)).toEqual(['t1']);
      expect(errors).toEqual([]);
    });
  });
}
