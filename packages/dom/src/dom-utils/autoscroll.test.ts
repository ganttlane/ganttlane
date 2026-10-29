import { afterEach, describe, expect, it, vi } from 'vitest';

import { createManualFrames } from '../testing';
import { createAutoScroller } from './autoscroll';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A scroller like a browser's: `scrollLeft` is clamped to `[0, max()]` and rounded to whole
 * pixels (what a 1x display does), whichever way it is written.
 */
function scroller(max: () => number = () => 10_000): HTMLElement {
  let left = 0;
  const element = document.createElement('div');
  const place = (value: number): void => {
    left = Math.round(Math.min(Math.max(value, 0), max()));
  };
  Object.defineProperty(element, 'scrollLeft', { get: () => left, set: place });
  element.scrollTo = ((options?: ScrollToOptions) => {
    if (options?.left !== undefined) place(options.left);
  }) as typeof element.scrollTo;
  return element;
}

/** One frame of a 60 Hz display, in ms: the unit of the velocity. */
const FRAME_MS = 16.67;

/** A clock that reads one 60 Hz frame later every time it is read, as frames that are on time. */
function steadyClock(): () => number {
  let time = 0;
  return () => (time += FRAME_MS);
}

function setup(
  velocity: { value: number },
  max?: () => number,
  scrolled?: () => void,
  now: () => number = steadyClock(),
) {
  const element = scroller(max);
  const frames = createManualFrames();
  const autoscroll = createAutoScroller({
    scroller: element,
    frames,
    velocity: () => velocity.value,
    scrolled,
    now,
  });
  return { element, frames, autoscroll };
}

describe('createAutoScroller (FR-EDIT-6)', () => {
  it('FR-EDIT-6: adds the velocity to scrollLeft every frame while it is not 0', () => {
    const velocity = { value: 10 };
    const { element, frames, autoscroll } = setup(velocity);

    autoscroll.start();
    expect(element.scrollLeft).toBe(0);
    frames.step();
    expect(element.scrollLeft).toBe(10);
    frames.step();
    frames.step();
    expect(element.scrollLeft).toBe(30);
  });

  it('FR-EDIT-6: scrolls instantly, whatever the CSS scroll-behavior of the scroller', () => {
    const velocity = { value: 7 };
    const { element, frames, autoscroll } = setup(velocity);
    const scrollTo = vi.spyOn(element, 'scrollTo');

    autoscroll.start();
    frames.step();

    expect(scrollTo).toHaveBeenCalledWith({ left: 7, behavior: 'instant' });
  });

  it('FR-EDIT-6: a negative velocity scrolls left', () => {
    const velocity = { value: -5 };
    const { element, frames, autoscroll } = setup(velocity);
    element.scrollLeft = 100;

    autoscroll.start();
    frames.step();
    frames.step();

    expect(element.scrollLeft).toBe(90);
  });

  it('FR-EDIT-6: reads the velocity again every frame and stops when it is 0', () => {
    const velocity = { value: 10 };
    const { element, frames, autoscroll } = setup(velocity);

    autoscroll.start();
    frames.step();
    velocity.value = 4;
    frames.step();
    expect(element.scrollLeft).toBe(14);
    velocity.value = 0;
    frames.step();

    expect(element.scrollLeft).toBe(14);
    expect(frames.queued).toBe(0);
  });

  it('FR-EDIT-6: start is idempotent: a running loop asks for one frame at a time', () => {
    const velocity = { value: 10 };
    const { frames, autoscroll } = setup(velocity);

    autoscroll.start();
    autoscroll.start();
    expect(frames.queued).toBe(1);
    frames.step();
    autoscroll.start();

    expect(frames.queued).toBe(1);
  });

  it('FR-EDIT-6: a stopped loop starts again from the element, where it is now', () => {
    const velocity = { value: 10 };
    const { element, frames, autoscroll } = setup(velocity);
    autoscroll.start();
    frames.step();
    velocity.value = 0;
    frames.step();

    element.scrollLeft = 500;
    velocity.value = 10;
    autoscroll.start();
    frames.step();

    expect(element.scrollLeft).toBe(510);
  });

  it('FR-EDIT-6: a velocity of 0 or one that is not a number never starts a frame', () => {
    const velocity = { value: 0 };
    const { element, frames, autoscroll } = setup(velocity);

    autoscroll.start();
    frames.step();
    velocity.value = Number.NaN;
    autoscroll.start();
    frames.step();

    expect(element.scrollLeft).toBe(0);
    expect(frames.queued).toBe(0);
  });

  it('FR-EDIT-6: sub-pixel velocities add up although the element keeps whole pixels', () => {
    const velocity = { value: 0.4 };
    const { element, frames, autoscroll } = setup(velocity);

    autoscroll.start();
    for (let frame = 0; frame < 10; frame++) frames.step();

    // Reading the element back every frame would round 0.4 to 0 and never move.
    expect(element.scrollLeft).toBe(4);
  });

  it('FR-TL-5: follows the element when something else moved it, e.g. the scroll compensation', () => {
    const velocity = { value: 10 };
    const { element, frames, autoscroll } = setup(velocity);
    autoscroll.start();
    frames.step();
    frames.step();

    // The infinite timeline grew at the start: scrollLeft += shift, in the same frame.
    element.scrollLeft += 1200;
    frames.step();

    expect(element.scrollLeft).toBe(1230);
  });

  it('FR-TL-5: at the end of the content it does not wind up: it goes on from where it stopped', () => {
    const velocity = { value: 20 };
    let max = 500;
    const { element, frames, autoscroll } = setup(velocity, () => max);
    element.scrollLeft = 480;

    autoscroll.start();
    for (let frame = 0; frame < 30; frame++) frames.step();
    expect(element.scrollLeft).toBe(500);

    // The range was extended: the content is wider now.
    max = 5000;
    frames.step();

    expect(element.scrollLeft).toBe(520);
  });

  it('FR-TL-5: says so right after each write that moved the scroller, before the next frame', () => {
    const velocity = { value: 10 };
    const seen: number[] = [];
    const place = { current: undefined as HTMLElement | undefined };
    const { element, frames, autoscroll } = setup(velocity, undefined, () => {
      seen.push(place.current?.scrollLeft ?? -1);
    });
    place.current = element;

    autoscroll.start();
    frames.step();
    frames.step();

    // Called with the new position already in place, once per frame.
    expect(seen).toEqual([10, 20]);
    expect(frames.queued).toBe(1);
  });

  it('FR-TL-5: says nothing while the scroller is at its end, and when a sub-pixel step moved nothing', () => {
    const velocity = { value: 20 };
    const scrolled = vi.fn();
    const { element, frames, autoscroll } = setup(velocity, () => 100, scrolled);
    element.scrollLeft = 90;

    autoscroll.start();
    frames.step();
    expect(scrolled).toHaveBeenCalledTimes(1);
    frames.step();
    frames.step();
    // Held at 100 by the end of the content: nothing moved, nothing to report.
    expect(element.scrollLeft).toBe(100);
    expect(scrolled).toHaveBeenCalledTimes(1);

    velocity.value = 0.3;
    element.scrollLeft = 0;
    frames.step();
    // 0.3 px rounds to the same pixel.
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('FR-EDIT-6: a host that throws from `scrolled` is reported, and the loop goes on', () => {
    const velocity = { value: 10 };
    let calls = 0;
    const { element, frames, autoscroll } = setup(velocity, undefined, () => {
      calls++;
      if (calls === 1) throw new Error('the host failed');
    });

    autoscroll.start();
    expect(() => {
      frames.step();
    }).toThrow('the host failed');
    // The write happened and the next frame is already asked for.
    expect(element.scrollLeft).toBe(10);
    expect(frames.queued).toBe(1);
    frames.step();

    expect(element.scrollLeft).toBe(20);
    expect(calls).toBe(2);
  });

  it('FR-EDIT-6: a host that starts the loop from `scrolled` (it heard of its own scroll) does not get a second frame', () => {
    const velocity = { value: 10 };
    const hold: { autoscroll?: ReturnType<typeof createAutoScroller> } = {};
    const { element, frames, autoscroll } = setup(velocity, undefined, () => {
      hold.autoscroll?.start();
    });
    hold.autoscroll = autoscroll;

    autoscroll.start();
    frames.step();
    expect(frames.queued).toBe(1);
    frames.step();
    frames.step();

    // One step per frame, however often the host says start.
    expect(element.scrollLeft).toBe(30);
    expect(frames.queued).toBe(1);
  });

  it('FR-API-4: a loop disposed by `scrolled` asks for no further frame', () => {
    const velocity = { value: 10 };
    const hold: { autoscroll?: ReturnType<typeof createAutoScroller> } = {};
    const { frames, autoscroll } = setup(velocity, undefined, () => {
      hold.autoscroll?.dispose();
    });
    hold.autoscroll = autoscroll;

    autoscroll.start();
    frames.step();

    expect(frames.queued).toBe(0);
  });

  it('FR-API-4: dispose cancels the frame and the loop never comes back', () => {
    const velocity = { value: 10 };
    const { element, frames, autoscroll } = setup(velocity);
    autoscroll.start();
    frames.step();
    expect(frames.queued).toBe(1);

    autoscroll.dispose();
    expect(frames.queued).toBe(0);
    autoscroll.start();
    frames.step();

    expect(frames.queued).toBe(0);
    expect(element.scrollLeft).toBe(10);
    autoscroll.dispose();
  });

  it('FR-API-4: a frame already running when it is disposed does not scroll or ask for another', () => {
    const velocity = { value: 10 };
    const { element, frames, autoscroll } = setup(velocity);
    autoscroll.start();
    // Disposed from inside the velocity read, like a destroy during the frame.
    velocity.value = 10;
    const step = (): void => {
      autoscroll.dispose();
    };
    vi.spyOn(element, 'scrollTo').mockImplementation(step);
    frames.step();

    expect(frames.queued).toBe(0);
  });
});

describe('createAutoScroller: speed does not depend on the display (FR-EDIT-6)', () => {
  /** A clock the test sets by hand. */
  const clock = (): { now: () => number; at: number } => {
    const state = { at: 0, now: () => state.at };
    return state;
  };

  it('FR-EDIT-6: the velocity is px per 60 Hz frame: a 120 Hz display scrolls half as far per frame', () => {
    const velocity = { value: 12 };
    const time = clock();
    const { element, frames, autoscroll } = setup(velocity, undefined, undefined, time.now);

    autoscroll.start();
    // The first frame has nothing to measure against: it counts as a 60 Hz frame.
    time.at = 1000;
    frames.step();
    expect(element.scrollLeft).toBe(12);
    for (let frame = 0; frame < 120; frame++) {
      time.at += 1000 / 120;
      frames.step();
    }

    // 120 frames in one second at 12 px per 60th of a second: 720 px, as at 60 Hz.
    expect(element.scrollLeft).toBeCloseTo(12 + 720, 0);
  });

  it('FR-EDIT-6: a 30 Hz display scrolls twice as far per frame, so that a second is a second', () => {
    const velocity = { value: 12 };
    const time = clock();
    const { element, frames, autoscroll } = setup(velocity, undefined, undefined, time.now);

    autoscroll.start();
    time.at = 1000;
    frames.step();
    for (let frame = 0; frame < 30; frame++) {
      time.at += 1000 / 30;
      frames.step();
    }

    expect(element.scrollLeft).toBeCloseTo(12 + 720, 0);
  });

  it('FR-EDIT-6: a long gap (a throttled tab) is capped, so that the chart does not jump', () => {
    const velocity = { value: 10 };
    const time = clock();
    const { element, frames, autoscroll } = setup(velocity, undefined, undefined, time.now);
    autoscroll.start();
    time.at = 1000;
    frames.step();
    const before = element.scrollLeft;

    time.at += 5000;
    frames.step();

    // At most 64 ms count: 64 / 16.67 frames of 10 px.
    expect(element.scrollLeft - before).toBeCloseTo((10 * 64) / FRAME_MS, 0);
    expect(element.scrollLeft - before).toBeLessThan(10 * 4);
  });

  it('FR-EDIT-6: a frame in the same instant as the last (a clock of low resolution) moves nothing, and costs nothing', () => {
    const velocity = { value: 10 };
    const time = clock();
    const { element, frames, autoscroll } = setup(velocity, undefined, undefined, time.now);
    autoscroll.start();
    time.at = 1000;
    frames.step();
    const before = element.scrollLeft;

    frames.step();
    expect(element.scrollLeft).toBe(before);
    time.at += FRAME_MS;
    frames.step();

    // The next frame is a normal one: nothing was lost or doubled.
    expect(element.scrollLeft).toBe(before + 10);
    expect(frames.queued).toBe(1);
  });

  it('FR-EDIT-6: a loop that starts again counts its first frame as a 60 Hz frame, not the time it was off', () => {
    const velocity = { value: 10 };
    const time = clock();
    const { element, frames, autoscroll } = setup(velocity, undefined, undefined, time.now);
    autoscroll.start();
    time.at = 1000;
    frames.step();
    velocity.value = 0;
    time.at += 16;
    frames.step();
    const stopped = element.scrollLeft;

    time.at += 60_000;
    velocity.value = 10;
    autoscroll.start();
    time.at += 30;
    frames.step();

    expect(element.scrollLeft - stopped).toBe(10);
  });

  it('FR-EDIT-6: without a clock of its own it reads performance.now', () => {
    const read = vi.spyOn(performance, 'now').mockReturnValue(5000);
    const velocity = { value: 10 };
    const element = scroller();
    const frames = createManualFrames();
    const autoscroll = createAutoScroller({
      scroller: element,
      frames,
      velocity: () => velocity.value,
    });

    autoscroll.start();
    frames.step();
    read.mockReturnValue(5000 + 2 * FRAME_MS);
    frames.step();

    expect(read).toHaveBeenCalled();
    expect(element.scrollLeft).toBe(10 + 20);
  });
});
