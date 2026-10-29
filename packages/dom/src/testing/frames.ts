import type { FrameSource } from '../scheduler';

/** A frame source driven by hand: requests queue up until `step()` runs them. */
export interface ManualFrames extends FrameSource {
  /** Runs the queued callbacks, as one frame would. Callbacks queued meanwhile wait. */
  step(): void;
  /** How many callbacks wait for a frame. */
  readonly queued: number;
  /** How many frames were requested in total (cancelled ones included). */
  readonly requested: number;
}

/**
 * Creates a {@link ManualFrames}.
 *
 * @returns A fresh queue.
 */
export function createManualFrames(): ManualFrames {
  let next = 1;
  let requested = 0;
  const queue = new Map<number, () => void>();
  return {
    request(callback) {
      const handle = next++;
      requested++;
      queue.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle as number);
    },
    step() {
      const batch = [...queue.values()];
      queue.clear();
      for (const callback of batch) callback();
    },
    get queued() {
      return queue.size;
    },
    get requested() {
      return requested;
    },
  };
}
