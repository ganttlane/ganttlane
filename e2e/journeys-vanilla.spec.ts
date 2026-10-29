import { JOURNEYS, runJourneys, vanillaDriver } from './journeys';

/**
 * The shared journeys on the vanilla chart (`createGantt`, the editing page `/edit/`): all of them,
 * in every engine. The same journeys run on React in `journeys-react.spec.ts`.
 */
runJourneys(JOURNEYS, {
  title: 'journeys, vanilla chart',
  driver: vanillaDriver,
  tiers: ['renderer', 'lifecycle'],
});
