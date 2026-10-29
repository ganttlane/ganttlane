const number = new Intl.NumberFormat('en');

/**
 * Calls `report` with the time from `since` until the first bar of the chart in `host` is on the
 * screen: when it has been drawn, and the browser has had a frame to paint it. The chart draws its
 * bars in an animation frame of its own, so this watches `host` for the first one.
 *
 * @param host - The element the chart is drawn in.
 * @param since - A `performance.now()` reading from just before the chart was asked for.
 * @param report - Called once, with the milliseconds.
 * @returns A function that stops watching (call it when the chart goes first).
 */
export function onFirstPaint(
  host: HTMLElement,
  since: number,
  report: (milliseconds: number) => void,
): () => void {
  let frame = 0;
  const observer = new MutationObserver(() => {
    check();
  });
  const check = (): void => {
    if (!host.querySelector('.gantt__bar')) return;
    observer.disconnect();
    frame = requestAnimationFrame(() => {
      report(performance.now() - since);
    });
  };
  observer.observe(host, { childList: true, subtree: true });
  check();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

/**
 * Says what was drawn, and how long it took.
 *
 * @param tasks - How many tasks the plan has.
 * @param links - How many links.
 * @param milliseconds - The time to the first bars, or `undefined` while it is not known yet.
 * @returns A sentence.
 */
export function describe(tasks: number, links: number, milliseconds?: number): string {
  const plan = `${number.format(tasks)} tasks and ${number.format(links)} links`;
  return milliseconds === undefined
    ? `${plan}: drawing …`
    : `${plan}: the first bars were on screen ${String(Math.round(milliseconds))} ms after the chart was asked for (on this machine, in this browser)`;
}
