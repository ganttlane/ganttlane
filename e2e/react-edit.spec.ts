import { expect, test } from '@playwright/test';

import {
  BUILDS,
  button,
  changesPanel,
  dragBar,
  eventLog,
  expectX,
  openReact,
  pageDates,
  settled,
  trackOf,
  watchPage,
} from './react-support';

/**
 * Editing on the React demo page (plan step 5.4, FR-REACT-1, FR-REACT-3, FR-REACT-5): the page owns
 * the `tasks` and `links` of the chart (controlled), `onTasksChange` writes every committed change
 * into them with `patchTasks`, and "Begin editing", "Save" and "Cancel" are `edit.begin()`,
 * `edit.commit()` and `edit.rollback()` on the `ref` handle, whose state the page follows with
 * `useGanttState`. Everything is driven through the page: the real mouse on the bars, the page's
 * buttons and selects, and what the page shows (its debug table is its own `tasks`, the panel is
 * `edit.getChanges()`).
 *
 * What a drag, a session (Save, Cancel, a link removed in it) and the editing flag do to a chart
 * with controlled data is a journey of its own, shared with the vanilla chart and run on this
 * component too (`journeys-react.spec.ts`). What is left here is the demo page itself: its
 * controls and its panel, and the page's own rule that leaving edit mode ends a session.
 *
 * The task is `task-9` of the sample project: a leaf with no anchors and no successors,
 * 2026-04-30 to 2026-05-06 (working days), so one day to the right is one working day.
 *
 * Every spec runs on all the builds of `BUILDS` (production, development, and development with
 * React 18.3): the development ones run StrictMode's effects twice and make React report its
 * warnings, and nothing may be reported.
 */

const TASK = 'task-9';
const START = '2026-04-30';
const END = '2026-05-06';
/** One working day later (the task keeps its five working days). */
const MOVED = { start: '2026-05-01', end: '2026-05-07' };

for (const build of BUILDS) {
  test.describe(`React page, editing, ${build.name}`, () => {
    test('the page’s buttons begin, cancel and save a session, and its panel says what changed', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build);
      await expect(changesPanel(page)).toContainText('No edit session');
      await expect(button(page, 'Save')).toBeDisabled();
      await expect(button(page, 'Cancel')).toBeDisabled();

      // Cancel puts back what the session changed: the page's tasks, and the bar.
      await button(page, 'Begin editing').click();
      await expect(changesPanel(page)).toContainText('Editing, not changed yet');
      await expect(button(page, 'Begin editing')).toBeDisabled();
      const { before } = await dragBar(page, TASK, 1);
      await expect.poll(async () => pageDates(page, TASK)).toEqual(MOVED);
      // `edit.getChanges()`: one line for the task, from where it was to where it is.
      await expect(changesPanel(page)).toContainText('Editing, changed:');
      await expect(changesPanel(page)).toContainText(
        `${TASK}: 2026-04-30 00:00 – 2026-05-07 00:00 0% → 2026-05-01 00:00 – 2026-05-08 00:00 0%`,
      );
      await button(page, 'Cancel').click();
      // The inverse arrives as `onEditRollback`, which the page writes into its tasks.
      await expect(eventLog(page)).toContainText('editRollback: 1 tasks');
      await expect(eventLog(page)).toContainText('edit.rollback: rolled-back');
      await expect.poll(async () => pageDates(page, TASK)).toEqual({ start: START, end: END });
      await expectX(trackOf(page, TASK), before, 1);
      await expect(changesPanel(page)).toContainText('Cancelled:');
      await expect(button(page, 'Begin editing')).toBeEnabled();

      // Save keeps it.
      await button(page, 'Begin editing').click();
      const moved = await dragBar(page, TASK, 1);
      await button(page, 'Save').click();
      await expect(changesPanel(page)).toContainText('Saved:');
      await expect(changesPanel(page)).toContainText(TASK);
      await expect(eventLog(page)).toContainText('edit.commit: committed');
      await expect(button(page, 'Begin editing')).toBeEnabled();
      await expect(button(page, 'Save')).toBeDisabled();
      expect(await pageDates(page, TASK)).toEqual(MOVED);
      await settled(page);
      await expectX(trackOf(page, TASK), moved.before + moved.distance, 1);
      expect(problems.list).toEqual([]);
    });

    test('a drag that is dragged back leaves the page’s tasks as they were', async ({ page }) => {
      const problems = watchPage(page);
      await openReact(page, build);

      await dragBar(page, TASK, 1);
      await expect.poll(async () => pageDates(page, TASK)).toEqual(MOVED);
      // Back by a day: the working days are Thursday and Friday either way, so it is symmetric.
      await dragBar(page, TASK, -1);

      await expect.poll(async () => pageDates(page, TASK)).toEqual({ start: START, end: END });
      expect(problems.list).toEqual([]);
    });

    test('leaving edit mode with a session open cancels it', async ({ page }) => {
      const problems = watchPage(page);
      await openReact(page, build);
      await button(page, 'Begin editing').click();
      const { before } = await dragBar(page, TASK, 1);
      await expect.poll(async () => pageDates(page, TASK)).toEqual(MOVED);

      await page.getByLabel('Mode').selectOption('view');

      await expect(eventLog(page)).toContainText('edit.rollback: rolled-back');
      await expect.poll(async () => pageDates(page, TASK)).toEqual({ start: START, end: END });
      await expectX(trackOf(page, TASK), before, 1);
      await expect(button(page, 'Save')).toBeDisabled();
      expect(problems.list).toEqual([]);
    });
  });
}
