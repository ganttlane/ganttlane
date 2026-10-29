import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { ChartDriver } from './driver';

/**
 * Which builds a journey runs on, besides the vanilla chart and the production build of React.
 *
 * - `'renderer'`: the journey exercises the renderer (gestures, scrolling, popovers, the DOM it
 *   draws), which React only wraps. It runs on the vanilla chart and on the production build of
 *   React.
 * - `'lifecycle'`: the journey also depends on what React does around the renderer (props that
 *   become options, controlled data, handlers that are always the latest, effects that
 *   StrictMode runs twice). It runs on all of those builds as well: the development build of
 *   React 19 and the one of React 18.3.
 */
export type Tier = 'renderer' | 'lifecycle';

/** One user journey, written once for every renderer. */
export interface Journey {
  /** The title of the test: the requirements it covers, then what happens. */
  readonly name: string;
  readonly tier: Tier;
  /** Runs the journey on a chart; throws (or fails an `expect`) when it does not hold. */
  run(driver: ChartDriver): Promise<void>;
}

/** What `runJourneys` takes. */
export interface RunOptions {
  /** The title of the group of tests. */
  readonly title: string;
  /** Makes the driver of the renderer for a page. */
  readonly driver: (page: Page) => ChartDriver;
  /** The tiers to run: a journey of another tier is left out. */
  readonly tiers: readonly Tier[];
}

/**
 * Registers the journeys as tests, one per journey. Each ends by asserting that the page reported
 * nothing: no uncaught error, no `console.error` or `console.warn` (React reports its
 * development warnings that way).
 *
 * @param journeys - The journeys.
 * @param options - Which renderer, and which tiers of the journeys.
 */
export function runJourneys(journeys: readonly Journey[], options: RunOptions): void {
  test.describe(options.title, () => {
    for (const journey of journeys.filter(({ tier }) => options.tiers.includes(tier))) {
      test(journey.name, async ({ page }) => {
        const driver = options.driver(page);
        await journey.run(driver);
        expect(driver.problems.list).toEqual([]);
      });
    }
  });
}
