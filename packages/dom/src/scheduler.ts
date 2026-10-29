import type { FrameSource } from './dom-utils';
import { throwCollected } from './dom-utils/errors';

/**
 * Where frames come from: `requestAnimationFrame` in browsers, a manual queue in tests. The
 * handle is opaque to the scheduler. Declared in `dom-utils`, where the autoscroll loop takes the
 * same source.
 */
export type { FrameSource };

/** A unit of work run in a frame. */
export type FrameTask = () => void;

/**
 * Collects work and runs it once per frame, newest information last: scheduling the same task
 * twice before the frame runs it once, however many core publishes, display changes and
 * resizes come before the frame. That is the renderer's whole batching story: one
 * render per frame, and a `flush` (the scroll compensation, which must land before paint) takes
 * the pending render with it and cancels its frame, so a publish and a compensation in the same
 * turn render once.
 */
export interface FrameScheduler {
  /**
   * Runs `task` in the next frame, once even if scheduled repeatedly before then. A task
   * scheduled while a frame runs waits for the following frame. Does nothing after `dispose`.
   *
   * @param task - The work; identity is the key, so pass the same function to coalesce.
   */
  readonly schedule: (task: FrameTask) => void;
  /**
   * Withdraws a scheduled task.
   *
   * @param task - The function that was scheduled.
   */
  readonly cancel: (task: FrameTask) => void;
  /**
   * Runs the pending tasks now, synchronously, and cancels their frame (for tests, and for
   * work that must land before paint, such as scroll compensation). Tasks scheduled by the
   * running tasks stay pending, and so does everything when `flush` is called by a task that
   * is running (a frame never re-enters itself). A throwing task does not stop the others; the
   * errors are rethrown afterwards (one as is, several as an `AggregateError`).
   */
  readonly flush: () => void;
  /** Whether a frame is requested: some task is waiting. */
  readonly pending: boolean;
  /** Cancels the requested frame and drops the tasks. Idempotent; the scheduler stays inert. */
  readonly dispose: () => void;
}

/**
 * The subset of {@link FrameScheduler} layers see: they may schedule work, not drive or end the
 * loop.
 */
export type LayerScheduler = Pick<FrameScheduler, 'schedule' | 'cancel' | 'pending'>;

/**
 * Creates a scheduler on top of a frame source.
 *
 * @param source - Supplies frames.
 * @returns A new scheduler, owned by one renderer instance.
 */
export function createFrameScheduler(source: FrameSource): FrameScheduler {
  let tasks = new Set<FrameTask>();
  let handle: unknown;
  let requested = false;
  let disposed = false;
  let running = false;

  const run = (): void => {
    requested = false;
    handle = undefined;
    const batch = tasks;
    tasks = new Set();
    const errors: unknown[] = [];
    running = true;
    try {
      for (const task of batch) {
        if (disposed) return;
        try {
          task();
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      running = false;
    }
    throwCollected(errors, 'Several frame tasks failed');
  };

  const stop = (): void => {
    if (!requested) return;
    source.cancel(handle);
    requested = false;
    handle = undefined;
  };

  return {
    schedule(task): void {
      if (disposed) return;
      tasks.add(task);
      if (requested) return;
      requested = true;
      handle = source.request(run);
    },
    cancel(task): void {
      tasks.delete(task);
      if (tasks.size === 0) stop();
    },
    flush(): void {
      if (disposed || running || tasks.size === 0) return;
      stop();
      run();
    },
    get pending(): boolean {
      return requested;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stop();
      tasks.clear();
    },
  };
}

/** The frame source of a document: its window's `requestAnimationFrame`. */
type FrameHost = Partial<Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'>>;

/**
 * The frame source of a document: its window's `requestAnimationFrame` (so a chart inside an
 * iframe is paced by that frame), or a 16 ms timer where there is none (a window-less document,
 * minimal DOM implementations).
 *
 * @param document - The document the chart lives in.
 * @returns A source for {@link createFrameScheduler}.
 */
export function frameSourceOf(document: Document): FrameSource {
  const host: FrameHost | null = document.defaultView;
  const request = host?.requestAnimationFrame;
  const cancel = host?.cancelAnimationFrame;
  if (host && request && cancel) {
    return {
      request: (callback) => request.call(host, () => callback()),
      cancel: (handle) => {
        cancel.call(host, handle as number);
      },
    };
  }
  return {
    request: (callback) => setTimeout(callback, 16),
    cancel: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}
