import { JOURNEYS, reactDriver, runJourneys } from './journeys';
import { BUILDS } from './react-support';

/**
 * The shared journeys on `<Gantt>` (the editing page `/react-edit/`, whose data is controlled), in
 * every engine. The matrix:
 *
 * - the production build runs every journey, as what an application ships;
 * - the development builds, React 19 with StrictMode and React 18.3 with StrictMode, run the
 *   `lifecycle` journeys only: the ones that depend on what React does around the renderer (props
 *   that become options, controlled data, handlers, effects that run twice), where React's own
 *   warnings are reported too. The gestures, scrolling and popovers of the `renderer` journeys are
 *   the vanilla renderer's, which React only wraps, so they gain nothing from running again.
 *
 * The same journeys run on the vanilla chart in `journeys-vanilla.spec.ts`.
 */
for (const build of BUILDS) {
  runJourneys(JOURNEYS, {
    title: `journeys, React, ${build.name}`,
    driver: (page) => reactDriver(page, build),
    tiers: build.base === '' ? ['renderer', 'lifecycle'] : ['lifecycle'],
  });
}
