import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFrameScheduler, frameSourceOf } from './scheduler';
import { createManualFrames } from './testing';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createFrameScheduler', () => {
  it('NFR-PERF-2: runs a task once per frame however often it was scheduled', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const task = vi.fn();

    scheduler.schedule(task);
    scheduler.schedule(task);
    scheduler.schedule(task);

    expect(frames.requested).toBe(1);
    expect(scheduler.pending).toBe(true);
    expect(task).not.toHaveBeenCalled();

    frames.step();

    expect(task).toHaveBeenCalledOnce();
    expect(scheduler.pending).toBe(false);
  });

  it('runs different tasks in scheduling order within one frame', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const order: string[] = [];

    scheduler.schedule(() => order.push('a'));
    scheduler.schedule(() => order.push('b'));
    frames.step();

    expect(order).toEqual(['a', 'b']);
    expect(frames.requested).toBe(1);
  });

  it('flush runs pending tasks synchronously and cancels their frame', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const task = vi.fn();
    scheduler.schedule(task);

    scheduler.flush();

    expect(task).toHaveBeenCalledOnce();
    expect(frames.queued).toBe(0);
    expect(scheduler.pending).toBe(false);
    frames.step();
    expect(task).toHaveBeenCalledOnce();
  });

  it('flush does nothing when nothing is pending', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);

    scheduler.flush();

    expect(frames.requested).toBe(0);
  });

  it('a task scheduled while a frame runs waits for the next frame', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const later = vi.fn();
    scheduler.schedule(() => {
      scheduler.schedule(later);
    });

    frames.step();
    expect(later).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(true);

    frames.step();
    expect(later).toHaveBeenCalledOnce();
  });

  it('NFR-PERF-2: work scheduled after a flush in the same turn gets one new frame, the cancelled one never runs', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const render = vi.fn();
    // A publish waits for the frame; then the scroll handler compensates and flushes ...
    scheduler.schedule(render);
    scheduler.flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(frames.queued).toBe(0);

    // ... and a burst of publishes after it shares one frame.
    scheduler.schedule(render);
    scheduler.schedule(render);
    scheduler.schedule(render);
    expect(frames.requested).toBe(2);
    expect(frames.queued).toBe(1);
    frames.step();
    expect(render).toHaveBeenCalledTimes(2);
    expect(frames.queued).toBe(0);
  });

  it('a flush from inside a running task does not run the tasks scheduled meanwhile', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const later = vi.fn();
    const order: string[] = [];
    scheduler.schedule(() => {
      order.push('first');
      scheduler.schedule(later);
      // A render that triggers a synchronous flush must not re-enter the frame it runs in.
      scheduler.flush();
      order.push('first done');
    });

    frames.step();

    expect(order).toEqual(['first', 'first done']);
    expect(later).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(true);
    frames.step();
    expect(later).toHaveBeenCalledOnce();
  });

  it('a flush after a failed frame still works', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    scheduler.schedule(() => {
      throw new Error('boom');
    });
    expect(() => {
      frames.step();
    }).toThrow('boom');

    const task = vi.fn();
    scheduler.schedule(task);
    scheduler.flush();

    expect(task).toHaveBeenCalledOnce();
  });

  it('cancel withdraws a task and the frame when nothing else waits', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const kept = vi.fn();
    const dropped = vi.fn();
    scheduler.schedule(kept);
    scheduler.schedule(dropped);

    scheduler.cancel(dropped);
    expect(scheduler.pending).toBe(true);
    scheduler.cancel(kept);

    expect(scheduler.pending).toBe(false);
    expect(frames.queued).toBe(0);
    frames.step();
    expect(kept).not.toHaveBeenCalled();
    expect(dropped).not.toHaveBeenCalled();
  });

  it('FR-API-4: dispose cancels the frame, drops the tasks and ignores later work', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const task = vi.fn();
    scheduler.schedule(task);

    scheduler.dispose();
    scheduler.dispose();
    scheduler.schedule(task);
    scheduler.flush();
    frames.step();

    expect(task).not.toHaveBeenCalled();
    expect(frames.queued).toBe(0);
    expect(scheduler.pending).toBe(false);
  });

  it('a throwing task does not stop the others; its error is rethrown afterwards', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    const after = vi.fn();
    const failure = new Error('task failed');
    scheduler.schedule(() => {
      throw failure;
    });
    scheduler.schedule(after);

    expect(() => {
      scheduler.flush();
    }).toThrow(failure);
    expect(after).toHaveBeenCalledOnce();
    expect(scheduler.pending).toBe(false);
  });

  it('several failures become an AggregateError', () => {
    const frames = createManualFrames();
    const scheduler = createFrameScheduler(frames);
    scheduler.schedule(() => {
      throw new Error('a');
    });
    scheduler.schedule(() => {
      throw new Error('b');
    });

    expect(() => {
      scheduler.flush();
    }).toThrow(AggregateError);
  });
});

describe('frameSourceOf', () => {
  it('NFR-PERF-2: uses requestAnimationFrame of the document window', () => {
    const request = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 7;
      });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const source = frameSourceOf(document);
    const callback = vi.fn();

    const handle = source.request(callback);
    source.cancel(handle);

    expect(request).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    expect(handle).toBe(7);
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to a timer for a document without a window', () => {
    vi.useFakeTimers();
    const detached = document.implementation.createHTMLDocument('detached');
    const source = frameSourceOf(detached);
    const callback = vi.fn();
    const cancelled = vi.fn();

    source.request(callback);
    source.cancel(source.request(cancelled));
    vi.advanceTimersByTime(20);

    expect(callback).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
  });
});
