import { expect, test } from '@playwright/test';

import {
  bar,
  boxOf,
  centre,
  changeOf,
  changesOf,
  committed,
  DAY,
  drag,
  eventsOf,
  expectX,
  handle,
  linkHandle,
  linkPreview,
  openEdit,
  press,
  pxPerDay,
  root,
  scroller,
  track,
  trackErrors,
} from './edit-harness';
import { LINKED, PLAN } from './journeys/plans';

/**
 * E2E of plan step 4.7 (FR-EDIT-1 … FR-EDIT-8, FR-LINK-4, FR-PROG-3): the gestures of the vanilla
 * renderer with the real mouse in Chromium, Firefox and WebKit, on the editing page of the
 * playground. What the chart reports comes back through the page's test hook.
 *
 * The main path of each gesture (drag a bar, resize either edge, drag the progress, make a link by
 * drag and by click-click) is a journey shared with React (`journeys/editing.ts`), which runs on
 * this page too (`journeys-vanilla.spec.ts`). What is left here are the details of the input:
 * cancelling, releasing outside, clicks, hover, refused links, touch.
 */

test.describe('gestures: cancel, release outside, clicks (FR-EDIT-1, FR-EDIT-3, FR-EDIT-4)', () => {
  test('FR-EDIT-4: Escape mid-drag restores the bar and the rest of the press does nothing', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, LINKED);
    const px = await pxPerDay(page);
    const original = await boxOf(track(page, 'a'));
    const successor = await boxOf(track(page, 'b'));
    const from = centre(original);

    await press(page, from, { x: from.x + 3 * px, y: from.y });
    await expectX(track(page, 'a'), original.x + 3 * px);
    await expect(root(page)).toHaveAttribute('data-cursor', 'grabbing');
    await page.keyboard.press('Escape');

    await expectX(track(page, 'a'), original.x);
    await expectX(track(page, 'b'), successor.x);
    await expect(root(page)).not.toHaveAttribute('data-cursor');
    await expect(bar(page, 'a')).not.toHaveAttribute('data-dragging');
    // Moving on and releasing neither commits nor clicks.
    await page.mouse.move(from.x + 5 * px, from.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(await changesOf(page)).toEqual([]);
    expect(await eventsOf(page)).toEqual([]);
    await expectX(track(page, 'a'), original.x);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-1: releasing outside the chart still commits (pointer capture)', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const px = await pxPerDay(page);
    const from = centre(await boxOf(track(page, 'a')));
    const chart = await boxOf(page.locator('#gantt'));
    const below = Math.min(chart.y + chart.height + 120, (page.viewportSize()?.height ?? 720) - 4);
    expect(below).toBeGreaterThan(chart.y + chart.height);

    await press(page, from, { x: from.x + px, y: from.y });
    // Out of the chart, over the page: only the capture sends the release to the chart.
    await page.mouse.move(from.x + 3 * px, below, { steps: 6 });
    await page.mouse.up();

    const changeSet = await committed(page);
    const change = changeOf(changeSet, 'a');
    expect(change.after.start - change.before.start).toBe(3 * DAY);
    await expect(root(page)).not.toHaveAttribute('data-cursor');
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-3: no click follows a drag, a plain click is a click', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const px = await pxPerDay(page);
    const from = centre(await boxOf(track(page, 'a')));

    await drag(page, from, { x: from.x + px, y: from.y });
    await committed(page);
    expect(await eventsOf(page)).toEqual(['change:move']);

    const moved = centre(await boxOf(track(page, 'a')));
    await page.mouse.click(moved.x, moved.y);
    await expect.poll(() => eventsOf(page)).toEqual(['change:move', 'click:a']);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-3: a double click is two clicks and a double click, with no delay on the first', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const at = centre(await boxOf(track(page, 'b')));

    await page.mouse.dblclick(at.x, at.y);

    await expect.poll(() => eventsOf(page)).toEqual(['click:b', 'click:b', 'dblclick:b']);
    expect(await changesOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-8: hovering marks the bar and its part, leaving the chart clears it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const hovered = (): Promise<string> =>
      page.evaluate(() => {
        const core = (window as unknown as { __ganttEdit: { core: unknown } }).__ganttEdit.core as {
          getSnapshot(): { feedback: { hover: { kind: string; id?: string; part?: string } } };
        };
        const { hover } = core.getSnapshot().feedback;
        return hover.kind === 'task' ? `${String(hover.id)}:${String(hover.part)}` : hover.kind;
      });
    const body = centre(await boxOf(track(page, 'a')));
    const end = centre(await boxOf(handle(page, 'a', 'resize-end')));

    await page.mouse.move(body.x, body.y, { steps: 3 });
    await expect(bar(page, 'a')).toHaveAttribute('data-hovered', '');
    expect(await hovered()).toBe('a:body');
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await expect.poll(hovered).toBe('a:resize-end');
    await page.mouse.move(body.x, body.y + 120, { steps: 3 });
    await expect.poll(hovered).toBe('empty');
    await expect(bar(page, 'a')).not.toHaveAttribute('data-hovered');

    // Out of the chart altogether: the hover goes with the pointer.
    await page.mouse.move(body.x, body.y, { steps: 3 });
    await expect(bar(page, 'a')).toHaveAttribute('data-hovered', '');
    await page.mouse.move(2, 2, { steps: 3 });
    await expect(bar(page, 'a')).not.toHaveAttribute('data-hovered');
    expect(await hovered()).toBe('empty');
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-3: a click on a bar with the other mouse button is nothing', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const at = centre(await boxOf(track(page, 'b')));

    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.waitForTimeout(50);

    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-1: a press on the sticky header never starts a gesture on a bar scrolled under it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const header = await boxOf(page.locator('#gantt .gantt__header'));
    const x = centre(await boxOf(track(page, 'a'))).x;
    const y = Math.round(header.y + header.height / 2);

    await press(page, { x, y }, { x: x + 80, y }, 4);
    await page.mouse.up();

    await page.waitForTimeout(50);
    expect(await changesOf(page)).toEqual([]);
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('links (FR-LINK-4, FR-LINK-6)', () => {
  test('FR-LINK-4: Escape cancels an armed click-click link', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const from = centre(await boxOf(linkHandle(page, 'b', 'end')));

    await page.mouse.click(from.x, from.y);
    await expect(linkPreview(page)).toBeAttached();
    await page.keyboard.press('Escape');

    await expect(linkPreview(page)).toHaveCount(0);
    await expect(root(page)).not.toHaveAttribute('data-cursor');
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-LINK-6: a refused target (the source itself) draws an invalid line and creates nothing', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const from = centre(await boxOf(linkHandle(page, 'a', 'end')));
    const own = centre(await boxOf(track(page, 'a')));

    await press(page, from, { x: from.x + 40, y: from.y + 4 });
    await page.mouse.move(own.x, own.y, { steps: 6 });
    await expect(linkPreview(page)).toBeAttached();
    await expect(linkPreview(page)).not.toHaveAttribute('data-valid');
    await expect(root(page)).toHaveAttribute('data-cursor', 'not-allowed');
    await page.mouse.up();

    await expect(linkPreview(page)).toHaveCount(0);
    await expect.poll(() => eventsOf(page)).toEqual(['refused:link-create:self']);
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: a link that would close a cycle is refused', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, LINKED);
    // The link runs a → b already: b → a would close a cycle.
    const from = centre(await boxOf(linkHandle(page, 'b', 'end')));
    const target = centre(await boxOf(track(page, 'a')));

    await press(page, from, { x: from.x + 40, y: from.y + 4 });
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await expect(linkPreview(page)).not.toHaveAttribute('data-valid');
    await page.mouse.up();

    await expect.poll(() => eventsOf(page)).toEqual(['refused:link-create:cycle']);
    expect(errors).toEqual([]);
  });

  test('FR-SEL-1: a click on a link selects it and reports linkClick', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, LINKED);
    const link = page.locator('#gantt .gantt__link[data-link-id="a:FS:b"]');
    // A point on the route itself, in page pixels: the wide hit path around it takes the press.
    const onRoute = await link.locator('.gantt__link-path').evaluate((path) => {
      const geometry = path as unknown as SVGGeometryElement;
      const point = geometry.getPointAtLength(geometry.getTotalLength() / 2);
      const matrix = geometry.getScreenCTM();
      if (matrix === null) throw new Error('the link is not rendered');
      return {
        x: Math.round(point.x * matrix.a + point.y * matrix.c + matrix.e),
        y: Math.round(point.x * matrix.b + point.y * matrix.d + matrix.f),
      };
    });

    await page.mouse.click(onRoute.x, onRoute.y);

    await expect.poll(() => eventsOf(page)).toEqual(['linkClick:a:FS:b']);
    await expect(link).toHaveAttribute('data-selected', '');
    expect(errors).toEqual([]);
  });
});

test.describe('touch (synthetic pointer events: no engine can drag by touch from a test)', () => {
  test('FR-EDIT-3: a touch has its own drag threshold: 5 px is a tap, 12 px moves the bar', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const px = await pxPerDay(page);
    const trackA = track(page, 'a');
    const from = centre(await boxOf(trackA));
    const touch = { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0 } as const;
    const surface = scroller(page);

    // Pointer events made by hand: the browser has no such pointer, so the capture request
    // fails, which must not stop the gesture.
    await trackA.dispatchEvent('pointerdown', { ...touch, clientX: from.x, clientY: from.y });
    await surface.dispatchEvent('pointermove', { ...touch, clientX: from.x + 5, clientY: from.y });
    await surface.dispatchEvent('pointerup', { ...touch, clientX: from.x + 5, clientY: from.y });
    await expect.poll(() => eventsOf(page)).toEqual(['click:a']);
    expect(await changesOf(page)).toEqual([]);

    await trackA.dispatchEvent('pointerdown', { ...touch, clientX: from.x, clientY: from.y });
    await surface.dispatchEvent('pointermove', { ...touch, clientX: from.x + 12, clientY: from.y });
    await surface.dispatchEvent('pointermove', { ...touch, clientX: from.x + px, clientY: from.y });
    await surface.dispatchEvent('pointerup', { ...touch, clientX: from.x + px, clientY: from.y });
    const changeSet = await committed(page);
    expect(changeOf(changeSet, 'a').after.start - changeOf(changeSet, 'a').before.start).toBe(DAY);
    expect(await eventsOf(page)).toEqual(['click:a', 'change:move']);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-1: a bar that can be edited takes the touch, a read-only one leaves it to scrolling', async ({
    page,
  }) => {
    await openEdit(page, { ...PLAN, editing: true, tasks: [...PLAN.tasks] });
    await expect(bar(page, 'a')).toHaveCSS('touch-action', 'none');
    await expect(handle(page, 'a', 'resize-end')).toHaveCSS('touch-action', 'none');

    await openEdit(page, { ...PLAN, editing: false, tasks: [...PLAN.tasks] });
    await expect(bar(page, 'a')).toHaveAttribute('data-readonly', '');
    await expect(bar(page, 'a')).not.toHaveCSS('touch-action', 'none');
  });
});
