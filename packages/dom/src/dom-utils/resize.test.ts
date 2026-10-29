import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeResizeObserver, stubScrollerSize } from '../testing';
import { measureSize, observeSize } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('observeSize', () => {
  it('FR-API-4: reports content-box sizes from the ResizeObserver of the element window', () => {
    const FakeObserver = installFakeResizeObserver();
    const element = document.createElement('div');
    const sizes: { width: number; height: number }[] = [];

    const observation = observeSize(element, (size) => sizes.push(size));
    const [observer] = FakeObserver.instances;
    observer?.deliver(element, 640, 480);
    observer?.deliver(element, 800, 480);

    expect(observation.supported).toBe(true);
    expect(sizes).toEqual([
      { width: 640, height: 480 },
      { width: 800, height: 480 },
    ]);
  });

  it('does not report the same size twice in a row', () => {
    const FakeObserver = installFakeResizeObserver();
    const element = document.createElement('div');
    const onSize = vi.fn();
    observeSize(element, onSize);

    FakeObserver.instances[0]?.deliver(element, 100, 50);
    FakeObserver.instances[0]?.deliver(element, 100, 50);
    FakeObserver.instances[0]?.deliver(element, 100, 60);

    expect(onSize).toHaveBeenCalledTimes(2);
  });

  it('FR-API-4: disconnect stops the observer and is idempotent', () => {
    const FakeObserver = installFakeResizeObserver();
    const element = document.createElement('div');
    const onSize = vi.fn();
    const observation = observeSize(element, onSize);

    observation.disconnect();
    observation.disconnect();
    FakeObserver.instances[0]?.deliver(element, 100, 50);

    expect(FakeObserver.instances[0]?.disconnected).toBe(true);
    expect(onSize).not.toHaveBeenCalled();
  });

  it('reports `supported: false` and never calls back where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const element = document.createElement('div');
    const onSize = vi.fn();

    const observation = observeSize(element, onSize);
    observation.disconnect();

    expect(observation.supported).toBe(false);
    expect(onSize).not.toHaveBeenCalled();
  });
});

describe('measureSize', () => {
  it('reads the client box', () => {
    stubScrollerSize(320, 200);
    const scroller = document.createElement('div');
    scroller.className = 'gantt__scroller';

    expect(measureSize(scroller)).toEqual({ width: 320, height: 200 });
  });
});
