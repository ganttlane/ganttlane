import type { Dispose } from './dom-utils';

const MINUTE = 60_000;

/** Slack past the boundary, so that a timer that fires a hair early still lands in the new minute. */
const SLACK = 25;

/**
 * Calls `tick` at every wall-clock minute boundary, from one `setTimeout` at a time. The timer
 * is armed again from the clock each time it fires, never by adding a minute, so a late one (a
 * hidden tab, a sleeping laptop) catches up and does not drift. This is the renderer's one
 * low-frequency timer: it asks the core to read "now" again (`core.refreshNow()`), which
 * publishes a snapshot only when the minute changed.
 *
 * @param tick - Called once per minute; a throw is not caught but does not stop the clock.
 * @returns Stops the clock: clears the timer, and `tick` is not called again. Idempotent.
 */
export function startMinuteClock(tick: () => void): Dispose {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const arm = (): void => {
    timer = setTimeout(
      () => {
        timer = undefined;
        if (stopped) return;
        // Re-armed first: a throwing `tick` must not leave the chart without a clock.
        arm();
        tick();
      },
      MINUTE - (Date.now() % MINUTE) + SLACK,
    );
  };
  arm();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}
