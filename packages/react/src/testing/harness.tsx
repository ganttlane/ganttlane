import type { ReactElement } from 'react';

import type { GanttInstance, GanttReactOptions } from '../types';
import { useGantt } from '../use-gantt';

/** Props of {@link Harness}. */
export interface HarnessProps<TData = unknown> {
  /** The options passed to `useGantt`. */
  readonly options: GanttReactOptions<TData>;
  /** Called on every render with the instance `useGantt` returned. */
  readonly capture?: (instance: GanttInstance<TData>) => void;
  /** Whether the container is rendered; default `true`. */
  readonly container?: boolean;
  /** Whether the portals of the slots (`instance.slots`) are rendered; default `true`. */
  readonly slots?: boolean;
}

/**
 * A component that is only `useGantt`, a container and the portals of its slots, the way an
 * application would write it, with the instance handed to the test.
 *
 * @param props - See {@link HarnessProps}.
 * @returns The container.
 */
export function Harness<TData = unknown>({
  options,
  capture,
  container = true,
  slots = true,
}: HarnessProps<TData>): ReactElement {
  const gantt = useGantt<TData>(options);
  const { setContainer, slots: portals } = gantt;
  capture?.(gantt);
  return (
    <>
      {container ? <div data-testid="harness" ref={setContainer} /> : null}
      {slots ? portals : null}
    </>
  );
}

/**
 * Collects the instances a {@link Harness} renders with.
 *
 * @returns The list and the function to pass as `capture`.
 */
export function collect<TData = unknown>(): {
  readonly seen: GanttInstance<TData>[];
  readonly capture: (instance: GanttInstance<TData>) => void;
  /** The instance of the latest render. */
  latest(): GanttInstance<TData>;
} {
  const seen: GanttInstance<TData>[] = [];
  return {
    seen,
    capture: (instance) => {
      seen.push(instance);
    },
    latest: () => {
      const last = seen.at(-1);
      if (last === undefined) throw new Error('nothing was rendered');
      return last;
    },
  };
}
