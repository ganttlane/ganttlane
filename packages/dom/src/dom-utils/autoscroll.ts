/**
 * Where animation frames come from: a window's `requestAnimationFrame` in the browser, a manual
 * queue in tests. The renderer's frame scheduler and the autoscroll loop both take one; it lives
 * here, not with the renderer, because `dom-utils` knows nothing of the renderer.
 */
export interface FrameSource {
  /** Asks for `callback` to run once, before the next paint. */
  request(callback: () => void): unknown;
  /** Withdraws a request that has not run yet. */
  cancel(handle: unknown): void;
}

/** A frame of a 60 Hz display: what the velocity is per, and what the first frame of a run counts as. */
const FRAME_MS = 16.67;
/** The longest time a frame is taken to have lasted: a throttled tab must not throw the chart. */
const MAX_FRAME_MS = 64;

/** Options of {@link createAutoScroller}. */
export interface AutoScrollerOptions {
  /** The scroll container whose `scrollLeft` is moved. */
  readonly scroller: HTMLElement;
  /** Supplies the frames; the loop owns the requests it makes and cancels them on dispose. */
  readonly frames: FrameSource;
  /**
   * The signed speed in px per frame of a 60 Hz display, read at the start of every frame: the
   * core's `snapshot.autoScroll`. `0` (or anything that is not a finite number) ends the loop.
   * What a frame moves is scaled by the time since the previous one (see
   * {@link createAutoScroller}), so the speed is the same on any display.
   */
  readonly velocity: () => number;
  /** The clock of the frames, in ms. Default: `performance.now`. */
  readonly now?: (() => number) | undefined;
  /**
   * Called right after a write that moved the scroller, in the same frame, before it is
   * painted: report the new offset to the core and draw what that changes. Waiting for the
   * browser's `scroll` event instead would place the dragged bar for the previous offset, one
   * step (up to the velocity) behind the pointer in every painted frame. Not called when the
   * scroller did not move (it is at its end).
   */
  readonly scrolled?: (() => void) | undefined;
}

/** The drag autoscroll loop of one chart, see {@link createAutoScroller}. */
export interface AutoScroller {
  /**
   * Starts the loop if it is not running: from the next frame on it scrolls by the velocity
   * until the velocity reads `0`. Starting a running loop does nothing.
   */
  start(): void;
  /** Cancels the pending frame and ends the loop for good. Idempotent. */
  dispose(): void;
}

/**
 * The autoscroll of a drag near the edge of the viewport (FR-EDIT-6): every animation frame
 * `scrollLeft` moves by the core's current velocity, until that is `0`. It only writes
 * `scrollLeft` and says so (`scrolled`): the host reports the offset to the core like any other
 * scroll, which grows the infinite timeline (FR-TL-5) and places the dragged bar under the
 * still pointer again, all before the frame is painted.
 *
 * The velocity is px per frame of a 60 Hz display, and a frame moves `velocity * dt / 16.67`, with
 * `dt` the time since the previous frame, so that a 120 Hz or 30 Hz display scrolls as fast as a
 * 60 Hz one. `dt` is capped at 64 ms (a throttled tab must not throw the chart), and the first
 * frame of a run counts as a 60 Hz one.
 *
 * The position is kept as a float of its own, because an element rounds what it is given to its
 * pixels (a velocity of `0.4` would read back as the same pixel forever), and is taken from the
 * element again when that moved by more than a pixel from what was written: the scroll
 * compensation of an extension moved it, or the content ends there (so the loop does not wind
 * up against the end and then jump when the range grows).
 *
 * @param options - See {@link AutoScrollerOptions}.
 * @returns The loop, idle until `start`.
 */
export function createAutoScroller(options: AutoScrollerOptions): AutoScroller {
  const { scroller, frames, velocity, scrolled, now = () => performance.now() } = options;
  let handle: unknown;
  let requested = false;
  let disposed = false;
  /** Whether `position` carries on from the last frame. */
  let moving = false;
  let position = 0;
  let written = 0;
  /** When the previous frame ran. */
  let last = 0;
  /** Read through a function: `dispose` may run in the middle of a frame, from `scrollTo`. */
  const ended = (): boolean => disposed;

  const request = (): void => {
    requested = true;
    handle = frames.request(frame);
  };

  function frame(): void {
    // `requested` stays set while the frame runs: `start`, called from `scrolled` (the host
    // hears of its own scroll and may start the loop), must not ask for a second frame.
    const speed = velocity();
    if (ended() || !Number.isFinite(speed) || speed === 0) {
      requested = false;
      moving = false;
      return;
    }
    const actual = scroller.scrollLeft;
    if (!moving || Math.abs(actual - written) > 1) position = actual;
    const time = now();
    const frames60 = moving ? Math.min(time - last, MAX_FRAME_MS) / FRAME_MS : 1;
    last = time;
    moving = true;
    position += speed * frames60;
    written = position;
    scroller.scrollTo({ left: position, behavior: 'instant' });
    try {
      if (scrolled !== undefined && scroller.scrollLeft !== actual) scrolled();
    } finally {
      // A failure of the host surfaces as it is, and must not end the drag's autoscroll.
      if (!ended()) request();
    }
  }

  return {
    start(): void {
      if (!requested && !disposed) request();
    },
    dispose(): void {
      disposed = true;
      if (requested) frames.cancel(handle);
      requested = false;
    },
  };
}
