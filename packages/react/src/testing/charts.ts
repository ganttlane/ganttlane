import type * as Facade from '@ganttlane/dom/facade';
import type { GanttChart } from '@ganttlane/dom/facade';
import { vi } from 'vitest';

/** A chart `createChart` made, with spies on the calls the tests count. */
export interface SpiedChart extends GanttChart {
  /** The `setOptions` of the chart's facade: what `useGantt` sent the chart. */
  readonly setOptions: ReturnType<typeof vi.fn>;
  /** The `destroy` of the chart's facade. */
  readonly destroy: ReturnType<typeof vi.fn>;
}

/** Every chart made since the last {@link forgetCharts}, in order. */
export const charts: SpiedChart[] = [];

/** Empties {@link charts}; call it in `beforeEach`. */
export function forgetCharts(): void {
  charts.length = 0;
}

/**
 * For `vi.mock('@ganttlane/dom/facade', async (original) => wrapFacade(await original()))`: the
 * real facade, whose charts are recorded in {@link charts} with their `setOptions` and `destroy`
 * spied (they still do their work).
 *
 * @param actual - The real module.
 * @returns The module to mock it with.
 */
export function wrapFacade(actual: unknown): typeof Facade {
  const real = actual as typeof Facade;
  return {
    ...real,
    createChart: (...args) => {
      const chart = real.createChart(...args);
      const spied = Object.assign(chart, {
        setOptions: vi.spyOn(chart.gantt, 'setOptions'),
        destroy: vi.spyOn(chart.gantt, 'destroy'),
      });
      charts.push(spied as unknown as SpiedChart);
      return spied;
    },
  };
}

/**
 * The chart that an instance is using, found by its core. `instance.core` is one object for the
 * life of the instance, whichever core is behind it (a chart made again after `<Activity>` hid
 * it), so the chart is the one whose core has the snapshot that `core.getSnapshot()` answers now.
 *
 * @param core - `instance.core`.
 * @returns The recorded chart.
 */
export function chartOf(core: unknown): SpiedChart {
  const { getSnapshot } = core as { readonly getSnapshot: () => unknown };
  const snapshot = getSnapshot();
  const found = charts.find((chart) => chart.gantt.core.getSnapshot() === snapshot);
  if (found === undefined) throw new Error('no chart made for this core');
  return found;
}
