/**
 * The shared journeys (plan step 6.1, NFR-QUAL-2): the key user journeys, written once and run on
 * every renderer by `e2e/journeys-vanilla.spec.ts` and `e2e/journeys-react.spec.ts`. A journey
 * talks to the chart through a {@link ChartDriver} (`driver.ts`) and to its DOM with the real
 * mouse and keyboard, so what holds for one renderer is asserted for the other in the same words.
 *
 * | Journey | Requirements | Tier |
 * | --- | --- | --- |
 * | mounts | FR-API-1, FR-REACT-1 | lifecycle |
 * | view mode | FR-API-3, FR-SCALE-3 | lifecycle |
 * | scrolls to a task | FR-API-3, FR-SCROLL-2 | renderer |
 * | drags a bar | FR-EDIT-1, FR-EDIT-5, FR-TX-1, FR-TX-3 | lifecycle |
 * | resizes a bar | FR-EDIT-1 | renderer |
 * | drags the progress | FR-PROG-3 | renderer |
 * | links tasks (drag, click-click, menu) | FR-LINK-4, FR-LINK-5, FR-SEL-1 | renderer |
 * | edit session (Save, Cancel) | FR-TX-4, FR-TX-6 | lifecycle |
 * | undo and redo | FR-TX-5 | lifecycle |
 * | theme and locale at runtime | FR-API-2, FR-THEME-2, FR-I18N-1, FR-I18N-2 | lifecycle |
 * | read-only, and editing at runtime | FR-EDIT-7 | lifecycle |
 * | infinite timeline | FR-TL-2, FR-TL-3 | renderer |
 * | hover tooltip | FR-TIP-1, FR-TIP-2 | renderer |
 *
 * The tier says where a journey runs besides the vanilla chart: see `Tier` in `journey.ts`, and
 * the matrix in `playwright.config.ts`.
 */
import {
  hoverTooltip,
  infiniteTimeline,
  mounts,
  readOnly,
  scrollsToTask,
  themeAndLocale,
  viewMode,
} from './chart';
import { dragsBar, dragsProgress, editSession, linksTasks, resizesBar, undoRedo } from './editing';
import type { Journey } from './journey';

export type { ChartDriver } from './driver';
export { reactDriver, vanillaDriver } from './driver';
export type { Journey, Tier } from './journey';
export { runJourneys } from './journey';

/** The journeys, in the order of the table above. */
export const JOURNEYS: readonly Journey[] = [
  mounts,
  viewMode,
  scrollsToTask,
  dragsBar,
  resizesBar,
  dragsProgress,
  linksTasks,
  editSession,
  undoRedo,
  themeAndLocale,
  readOnly,
  infiniteTimeline,
  hoverTooltip,
];
