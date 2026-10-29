import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  boxOf,
  centre,
  changeOf,
  changesOf,
  committed,
  DAY,
  eventsOf,
  handle,
  openEdit,
  type Point,
  pxPerDay,
  scroller,
  settled,
  track,
  trackErrors,
} from './edit-harness';

/**
 * E2E of plan step 4.7 for touch (FR-EDIT-1, FR-EDIT-3): real touch input, which only Chromium
 * can send to a page from a test (through the DevTools protocol); Firefox and WebKit have no
 * touch emulation for a desktop page, and their pointer-type handling is covered by the
 * synthetic pointer events of `edit-gestures.spec.ts`.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'only Chromium can send real touch input from a test',
);

test.use({ hasTouch: true });

const CHART = {
  tasks: [
    { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
    { id: 'b', name: 'Beta', start: '2026-03-09', end: '2026-03-13' },
  ],
  viewMode: 'day',
  calendar: { weekends: [] },
  today: '2026-03-04',
  scroll: { initial: 'first-task' },
  width: 1000,
} as const;

/** A one-finger touch through the DevTools protocol: down, moves in steps, up. */
async function swipe(
  cdp: CDPSession,
  from: Point,
  to: Point,
  steps = 10,
  /** Runs while the finger is still down, after the last move. */
  held?: () => Promise<void>,
): Promise<void> {
  const at = (point: Point) => [{ x: point.x, y: point.y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from) });
  for (let step = 1; step <= steps; step++) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at({ x, y }) });
  }
  await held?.();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const open = async (page: Page, config: Record<string, unknown>): Promise<CDPSession> => {
  await openEdit(page, config);
  return page.context().newCDPSession(page);
};

test.describe('touch (FR-EDIT-1, FR-EDIT-3)', () => {
  test('FR-EDIT-1: dragging a bar by touch moves it, and the chart does not scroll instead', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const cdp = await open(page, CHART);
    const px = await pxPerDay(page);
    const from = centre(await boxOf(track(page, 'a')));
    const scrolled = await scroller(page).evaluate((element) => element.scrollLeft);

    await swipe(cdp, from, { x: from.x + 2 * px, y: from.y }, 10, async () => {
      // The touch belongs to the bar (`touch-action: none`): the browser did not take it for a
      // pan. (After the commit `scrollLeft` may change: the range follows the first task.)
      expect(await scroller(page).evaluate((element) => element.scrollLeft)).toBe(scrolled);
    });

    const changeSet = await committed(page);
    const change = changeOf(changeSet, 'a');
    expect(change.after.start - change.before.start).toBe(2 * DAY);
    expect(await eventsOf(page)).toEqual(['change:move']);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-3: a tap on a bar is a click, not a drag (the touch threshold is 8 px)', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const cdp = await open(page, CHART);
    const from = centre(await boxOf(track(page, 'b')));

    await swipe(cdp, from, { x: from.x + 3, y: from.y }, 3);

    await expect.poll(() => eventsOf(page)).toEqual(['click:b']);
    expect(await changesOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-1: a swipe on a bar that cannot be edited scrolls the chart', async ({ page }) => {
    const errors = trackErrors(page);
    const cdp = await open(page, { ...CHART, editing: false, tasks: [...CHART.tasks] });
    const from = centre(await boxOf(track(page, 'a')));
    const before = await scroller(page).evaluate((element) => element.scrollLeft);

    await swipe(cdp, from, { x: from.x - 120, y: from.y }, 12);
    await settled(page);

    await expect
      .poll(() => scroller(page).evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(before + 20);
    expect(await changesOf(page)).toEqual([]);
    // A pan is no refused drag: nothing is reported for it.
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-7: a swipe on a bar that can be resized but not moved scrolls the chart, with no refused drag', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const cdp = await open(page, { ...CHART, editing: { move: false }, tasks: [...CHART.tasks] });
    const from = centre(await boxOf(track(page, 'a')));
    const before = await scroller(page).evaluate((element) => element.scrollLeft);

    await swipe(cdp, from, { x: from.x - 120, y: from.y }, 12);
    await settled(page);

    await expect
      .poll(() => scroller(page).evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(before + 20);
    expect(await changesOf(page)).toEqual([]);
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-1: the handle of such a bar still takes the touch: dragging it resizes the bar', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const cdp = await open(page, { ...CHART, editing: { move: false }, tasks: [...CHART.tasks] });
    const px = await pxPerDay(page);
    const from = centre(await boxOf(handle(page, 'a', 'resize-end')));
    const scrolled = await scroller(page).evaluate((element) => element.scrollLeft);

    await swipe(cdp, from, { x: from.x + 2 * px, y: from.y });

    const changeSet = await committed(page);
    expect(changeSet.reason).toBe('resize-end');
    const change = changeOf(changeSet, 'a');
    expect(change.after.endExclusive - change.before.endExclusive).toBe(2 * DAY);
    expect(await scroller(page).evaluate((element) => element.scrollLeft)).toBe(scrolled);
    expect(errors).toEqual([]);
  });
});
