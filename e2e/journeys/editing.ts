/**
 * The editing journeys, for every renderer (plan step 6.1): a user drags a bar, resizes it, drags
 * its progress, links tasks by drag and by click-click and removes a link from its menu, edits in
 * a session that is saved or cancelled, and undoes and redoes. Each is done with the real mouse
 * on the DOM the renderer draws; what the chart reported and what its owner holds come back
 * through the driver. Under React the owner is the page, which applies every change set to its
 * own tasks (controlled), so a journey also shows that the loop closes: the bar stays where it
 * was dropped once the data has come back.
 */
import { expect, test } from '@playwright/test';

import { boxOf, centre, changeOf, DAY, drag, expectX, press, settled } from '../edit-harness';
import { clickLink, POPOVER } from '../popover-support';
import type { Journey } from './journey';
import { LINK_A_B, LINKED, PLAN } from './plans';
import {
  bar,
  committed,
  datesOf,
  dragBar,
  handle,
  linkHandle,
  linkOf,
  linkPreview,
  removeLink,
  root,
  track,
} from './support';

export const dragsBar: Journey = {
  name: 'FR-EDIT-1, FR-EDIT-5, FR-TX-1, FR-TX-3: dragging a bar moves it and the tasks linked after it (and no others), reports one change set, and the bar stays where it was dropped',
  tier: 'lifecycle',
  async run(driver) {
    const { page } = driver;
    await driver.mount(LINKED);
    const { pxPerDay } = await driver.state();
    const before = await boxOf(track(page, 'a'));
    const successor = await boxOf(track(page, 'b'));
    const from = centre(before);

    await press(page, from, { x: from.x + 2 * pxPerDay, y: from.y });
    // While the button is down the bar and what follows it show the preview, and nothing is
    // committed.
    await expect(bar(page, 'a')).toHaveAttribute('data-dragging', '');
    await expectX(track(page, 'a'), before.x + 2 * pxPerDay);
    await expectX(track(page, 'b'), successor.x + 2 * pxPerDay);
    expect(await driver.changes()).toEqual([]);
    await page.mouse.up();

    // One change set for the action: the bar dragged, and the task linked after it.
    const changeSet = await committed(driver);
    expect(changeSet.reason).toBe('move');
    expect(changeSet.changes.map(({ id }) => id).sort()).toEqual(['a', 'b']);
    const dragged = changeOf(changeSet, 'a');
    expect(dragged.cause).toBe('direct');
    expect(dragged.after.start - dragged.before.start).toBe(2 * DAY);
    expect(dragged.after.endExclusive - dragged.before.endExclusive).toBe(2 * DAY);
    const follower = changeOf(changeSet, 'b');
    expect(follower.cause).toBe('link');
    expect(follower.after.start - follower.before.start).toBe(2 * DAY);
    await expect(bar(page, 'a')).not.toHaveAttribute('data-dragging');
    await expectX(track(page, 'a'), before.x + 2 * pxPerDay);

    // The data its owner holds has the new dates (under React, the page's own tasks, which it
    // applies a render after the chart has reported) ...
    await expect
      .poll(async () => [await datesOf(driver, 'a'), await datesOf(driver, 'b')])
      .toEqual([
        { start: '2026-03-04', end: '2026-03-08' },
        { start: '2026-03-11', end: '2026-03-15' },
      ]);
    // ... and the bar stays where it was dropped when they have come back, and there was just
    // the one change.
    await settled(page);
    await settled(page);
    await expectX(track(page, 'a'), before.x + 2 * pxPerDay);
    await expectX(track(page, 'b'), successor.x + 2 * pxPerDay);
    expect(await driver.changes()).toHaveLength(1);
    expect(await driver.events()).toEqual(['change:move']);

    // On a plan without links nothing follows: the change set holds the task that was dragged and
    // no other, and the bars after it stay where they were.
    await driver.mount(PLAN);
    const first = await boxOf(track(page, 'a'));
    const second = await boxOf(track(page, 'b'));
    const third = await boxOf(track(page, 'c'));
    await dragBar(driver, 'a', 2);

    const plain = await committed(driver);
    expect(plain.reason).toBe('move');
    expect(plain.changes).toHaveLength(1);
    const alone = changeOf(plain, 'a');
    expect(alone.cause).toBe('direct');
    expect(alone.after.start - alone.before.start).toBe(2 * DAY);
    expect(alone.after.endExclusive - alone.before.endExclusive).toBe(2 * DAY);
    await expect
      .poll(async () => [
        await datesOf(driver, 'a'),
        await datesOf(driver, 'b'),
        await datesOf(driver, 'c'),
      ])
      .toEqual([
        { start: '2026-03-04', end: '2026-03-08' },
        { start: '2026-03-09', end: '2026-03-13' },
        { start: '2026-03-16', end: '2026-03-20' },
      ]);
    await settled(page);
    await settled(page);
    await expectX(track(page, 'a'), first.x + 2 * pxPerDay);
    await expectX(track(page, 'b'), second.x);
    await expectX(track(page, 'c'), third.x);
    expect(await driver.changes()).toHaveLength(1);
  },
};

export const resizesBar: Journey = {
  name: 'FR-EDIT-1: the start handle resizes the start edge and the end handle the end edge, each keeping the other',
  tier: 'renderer',
  async run(driver) {
    const { page } = driver;
    await driver.mount(PLAN);
    const { pxPerDay } = await driver.state();

    // The start handle, a day to the left: the end stays.
    const start = centre(await boxOf(handle(page, 'b', 'resize-start')));
    await press(page, start, { x: start.x - pxPerDay, y: start.y });
    await expect(bar(page, 'b')).toHaveAttribute('data-resizing', '');
    await page.mouse.up();
    const first = await committed(driver);
    expect(first.reason).toBe('resize-start');
    const resizedStart = changeOf(first, 'b');
    expect(resizedStart.before.start - resizedStart.after.start).toBe(DAY);
    expect(resizedStart.after.endExclusive).toBe(resizedStart.before.endExclusive);
    await expect
      .poll(() => datesOf(driver, 'b'))
      .toEqual({ start: '2026-03-08', end: '2026-03-13' });

    // The end handle, two days to the right: the start stays.
    const end = centre(await boxOf(handle(page, 'b', 'resize-end')));
    await drag(page, end, { x: end.x + 2 * pxPerDay, y: end.y });
    const second = await committed(driver, 2);
    expect(second.reason).toBe('resize-end');
    const resizedEnd = changeOf(second, 'b');
    expect(resizedEnd.after.endExclusive - resizedEnd.before.endExclusive).toBe(2 * DAY);
    expect(resizedEnd.after.start).toBe(resizedEnd.before.start);
    await expect
      .poll(() => datesOf(driver, 'b'))
      .toEqual({ start: '2026-03-08', end: '2026-03-15' });
    // The bar is as wide as its new dates: eight days.
    await settled(page);
    expect((await boxOf(track(page, 'b'))).width).toBeCloseTo(8 * pxPerDay, -1);
  },
};

export const dragsProgress: Journey = {
  name: 'FR-PROG-3: the progress handle changes the progress, and nothing else',
  tier: 'renderer',
  async run(driver) {
    const { page } = driver;
    await driver.mount(PLAN);
    const { pxPerDay } = await driver.state();
    const from = centre(await boxOf(handle(page, 'c', 'progress')));

    // Two of the five days: 40 %.
    await drag(page, from, { x: from.x + 2 * pxPerDay, y: from.y });

    const changeSet = await committed(driver);
    expect(changeSet.reason).toBe('progress');
    const change = changeOf(changeSet, 'c');
    expect(change.before.progress).toBe(0);
    expect(change.after.progress).toBeCloseTo(40, 0);
    expect(change.after.start).toBe(change.before.start);
    expect(change.after.endExclusive).toBe(change.before.endExclusive);
    // The owner of the data has the progress too (under React, the page applies it a render after
    // the chart has reported it) ...
    await expect
      .poll(async () => (await driver.owned('c'))?.progress ?? Number.NaN)
      .toBeCloseTo(40, 0);
    // ... and, now that the data has arrived, the dates in it are the ones it had: only the
    // progress was written.
    expect(await datesOf(driver, 'c')).toEqual({ start: '2026-03-16', end: '2026-03-20' });
  },
};

export const linksTasks: Journey = {
  name: 'FR-LINK-4, FR-LINK-5, FR-SEL-1: a link is made by drag and by click-click, and removed from its menu',
  tier: 'renderer',
  async run(driver) {
    const { page } = driver;
    await driver.mount(PLAN);

    await test.step('by drag, with a preview that follows the pointer', async () => {
      const from = centre(await boxOf(linkHandle(page, 'a', 'end')));
      const target = centre(await boxOf(track(page, 'c')));

      await press(page, from, { x: from.x + 40, y: from.y + 4 });
      // Free space: a valid line to the pointer, a crosshair for the whole chart.
      await expect(linkPreview(page)).toBeAttached();
      await expect(linkPreview(page)).toHaveAttribute('data-valid', '');
      await expect(root(page)).toHaveAttribute('data-cursor', 'crosshair');
      await page.mouse.move(target.x, target.y, { steps: 10 });
      await expect.poll(() => driver.snapshot('feedback.link.target')).toBe('c');
      await expect(linkPreview(page)).toHaveAttribute('data-valid', '');
      await page.mouse.up();

      await expect.poll(() => driver.events()).toEqual(['linkCreate:a>c']);
      await expect(linkPreview(page)).toHaveCount(0);
      await expect(root(page)).not.toHaveAttribute('data-cursor');
      await expect(linkOf(page, 'a:FS:c')).toBeAttached();
      expect(await driver.changes()).toEqual([]);
    });

    await test.step('by click-click, with the preview between the clicks', async () => {
      const from = centre(await boxOf(linkHandle(page, 'b', 'end')));
      const target = centre(await boxOf(track(page, 'c')));

      await page.mouse.click(from.x, from.y);
      // Armed: the line follows the pointer without a button.
      await expect(linkPreview(page)).toBeAttached();
      await expect(root(page)).toHaveAttribute('data-cursor', 'crosshair');
      const armed = await linkPreview(page).getAttribute('d');
      await page.mouse.move(target.x, target.y, { steps: 8 });
      await expect.poll(() => linkPreview(page).getAttribute('d')).not.toBe(armed);
      await page.mouse.click(target.x, target.y);

      await expect.poll(() => driver.events()).toEqual(['linkCreate:a>c', 'linkCreate:b>c']);
      await expect(linkPreview(page)).toHaveCount(0);
      await expect(root(page)).not.toHaveAttribute('data-cursor');
      await expect(linkOf(page, 'b:FS:c')).toBeAttached();
    });

    await test.step('a click on a link selects it and opens its menu, which Escape closes', async () => {
      await clickLink(page, 'a:FS:c');

      const menu = page.locator(POPOVER);
      await expect(menu).toHaveAttribute('role', 'menu');
      await expect(menu).toHaveAttribute('data-kind', 'link');
      await expect(linkOf(page, 'a:FS:c')).toHaveAttribute('data-selected', '');
      await expect(menu.getByRole('menuitem', { name: 'Remove dependency' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect
        .poll(async () => (await driver.events()).filter((event) => event.startsWith('linkClick:')))
        .toEqual(['linkClick:a:FS:c']);
    });

    await test.step('"Remove dependency" removes the link, and only that one', async () => {
      await removeLink(page, 'a:FS:c');

      await expect(linkOf(page, 'a:FS:c')).toHaveCount(0);
      await expect(linkOf(page, 'b:FS:c')).toBeAttached();
      await expect.poll(() => driver.events()).toContain('linkDelete:a>c');
      expect(await driver.changes()).toEqual([]);
    });
  },
};

export const editSession: Journey = {
  name: 'FR-TX-4, FR-TX-6: an edit session is cancelled to put everything back, or saved to keep it, links included',
  tier: 'lifecycle',
  async run(driver) {
    const { page } = driver;
    await driver.mount(LINKED);
    const { pxPerDay } = await driver.state();
    const start = (await boxOf(track(page, 'a'))).x;
    expect(await driver.read('edit.isOpen')).toBe(false);

    await test.step('Cancel puts back what the session changed', async () => {
      expect((await driver.call('edit.begin')).status).toBe('begun');
      expect(await driver.read('edit.isOpen')).toBe(true);
      expect(await driver.read('edit.isDirty')).toBe(false);

      await dragBar(driver, 'a', 2);

      await expectX(track(page, 'a'), start + 2 * pxPerDay);
      await expect.poll(() => driver.read('edit.isDirty')).toBe(true);
      // `getChanges()`: the dates the session started with, and the ones it has now.
      const pending = await driver.call('edit.getChanges');
      const task = changeOf(pending!, 'a');
      expect(task.after.start - task.before.start).toBe(2 * DAY);
      expect(pending?.links).toEqual({ added: [], removed: [] });

      const answer = await driver.call('edit.rollback');

      expect(answer.status).toBe('rolled-back');
      expect(changeOf(answer.changes!, 'a').after.start).toBe(task.before.start);
      expect(await driver.read('edit.isOpen')).toBe(false);
      expect(await driver.read('edit.isDirty')).toBe(false);
      // The bar is back, and so are the dates of its owner (under React, the page's tasks: the
      // inverse arrives as `onEditRollback`).
      await expectX(track(page, 'a'), start);
      await expect
        .poll(() => datesOf(driver, 'a'))
        .toEqual({ start: '2026-03-02', end: '2026-03-06' });
      await settled(page);
      await expectX(track(page, 'a'), start);
      await expect
        .poll(async () => (await driver.events()).slice(-2))
        .toEqual(['dirty:false', 'rollback:2']);
      expect(await driver.events()).toContain('dirty:true');
    });

    await test.step('Cancel brings back a link that the session removed', async () => {
      await driver.call('edit.begin');
      await removeLink(page, LINK_A_B);
      await expect(linkOf(page, LINK_A_B)).toHaveCount(0);
      expect((await driver.call('edit.getChanges'))?.links.removed).toHaveLength(1);

      const answer = await driver.call('edit.rollback');

      expect(answer.changes?.links.added).toHaveLength(1);
      await expect(linkOf(page, LINK_A_B)).toBeAttached();
    });

    await test.step('Save keeps the changes, and a session can be begun again', async () => {
      expect((await driver.call('edit.begin')).status).toBe('begun');
      await dragBar(driver, 'a', 2);
      // The link is drawn from the new place of the bar before it is clicked.
      await expectX(track(page, 'a'), start + 2 * pxPerDay);
      await settled(page);
      await removeLink(page, LINK_A_B);

      const answer = await driver.call('edit.commit');

      expect(answer.status).toBe('committed');
      expect(answer.changes?.changes.map(({ id }) => id)).toContain('a');
      expect(answer.changes?.links.removed).toHaveLength(1);
      expect(await driver.read('edit.isOpen')).toBe(false);
      await expectX(track(page, 'a'), start + 2 * pxPerDay);
      await expect
        .poll(() => datesOf(driver, 'a'))
        .toEqual({ start: '2026-03-04', end: '2026-03-08' });
      await expect(linkOf(page, LINK_A_B)).toHaveCount(0);
      await settled(page);
      await expectX(track(page, 'a'), start + 2 * pxPerDay);
      // Nothing is left of the session: the next drag is an ordinary one.
      expect((await driver.call('edit.begin')).status).toBe('begun');
    });
  },
};

export const undoRedo: Journey = {
  name: 'FR-TX-5: with history on, undo and redo step back and forth through the actions, one drag one step',
  tier: 'lifecycle',
  async run(driver) {
    const { page } = driver;
    await driver.mount({ ...LINKED, history: true });
    const { pxPerDay } = await driver.state();
    const start = (await boxOf(track(page, 'a'))).x;
    const end = (await boxOf(track(page, 'c'))).x + (await boxOf(track(page, 'c'))).width;
    expect(await driver.read('canUndo')).toBe(false);
    expect(await driver.read('canRedo')).toBe(false);

    // Two actions: a bar is moved (and the task linked after it with it), then another resized.
    await dragBar(driver, 'a', 2);
    await committed(driver);
    expect(await driver.read('canUndo')).toBe(true);
    const handleOfC = centre(await boxOf(handle(page, 'c', 'resize-end')));
    await drag(page, handleOfC, { x: handleOfC.x + pxPerDay, y: handleOfC.y });
    await committed(driver, 2);
    await expectX(track(page, 'a'), start + 2 * pxPerDay);
    await expect
      .poll(async () => {
        const box = await boxOf(track(page, 'c'));
        return box.x + box.width;
      })
      .toBeCloseTo(end + pxPerDay, -1);

    // Undo the last action: the resize. The move stays.
    expect((await driver.call('undo')).status).toBe('undone');
    const undone = await committed(driver, 3);
    expect(undone.reason).toBe('undo');
    await expect
      .poll(() => datesOf(driver, 'c'))
      .toEqual({ start: '2026-03-16', end: '2026-03-20' });
    await expectX(track(page, 'a'), start + 2 * pxPerDay);
    expect(await driver.read('canUndo')).toBe(true);
    expect(await driver.read('canRedo')).toBe(true);

    // And the move, the bar and the task after it.
    expect((await driver.call('undo')).status).toBe('undone');
    await committed(driver, 4);
    await expectX(track(page, 'a'), start);
    await expect
      .poll(async () => [await datesOf(driver, 'a'), await datesOf(driver, 'b')])
      .toEqual([
        { start: '2026-03-02', end: '2026-03-06' },
        { start: '2026-03-09', end: '2026-03-13' },
      ]);
    expect(await driver.read('canUndo')).toBe(false);
    expect((await driver.call('undo')).status).toBe('empty');

    // Redo goes forward in the same order.
    expect((await driver.call('redo')).status).toBe('redone');
    const redone = await committed(driver, 5);
    expect(redone.reason).toBe('redo');
    await expectX(track(page, 'a'), start + 2 * pxPerDay);
    await expect
      .poll(() => datesOf(driver, 'a'))
      .toEqual({ start: '2026-03-04', end: '2026-03-08' });
    expect(await driver.read('canRedo')).toBe(true);
    expect((await driver.call('redo')).status).toBe('redone');
    await committed(driver, 6);
    await expect
      .poll(() => datesOf(driver, 'c'))
      .toEqual({ start: '2026-03-16', end: '2026-03-21' });
    expect(await driver.read('canRedo')).toBe(false);
    expect((await driver.call('redo')).status).toBe('empty');

    // What the chart said about its history on the way.
    const history = async (): Promise<string[]> =>
      (await driver.events()).filter((event) => event.startsWith('history:'));
    await expect.poll(async () => (await history()).at(-1)).toBe('history:true:false');
    expect((await history())[0]).toBe('history:true:false');
    await settled(page);
    await expectX(track(page, 'a'), start + 2 * pxPerDay);
  },
};
