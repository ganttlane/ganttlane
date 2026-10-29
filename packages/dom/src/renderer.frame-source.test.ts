import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduler from './scheduler';
import { frameSourceOf } from './scheduler';
import { createContainer, createFakeCore } from './testing';

// A spy on the real function: the renderer must ask the document for its frames once.
vi.mock('./scheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof Scheduler>();
  return { ...actual, frameSourceOf: vi.fn(actual.frameSourceOf) };
});

const { mountRenderer } = await import('./renderer');

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('the frame source of a renderer', () => {
  it('FR-API-4, NFR-PERF-2: is built once from the document and shared by the scheduler and the input', () => {
    const container = createContainer();
    const renderer = mountRenderer(container, createFakeCore());

    expect(frameSourceOf).toHaveBeenCalledTimes(1);
    expect(frameSourceOf).toHaveBeenCalledWith(document);
    renderer.destroy();
  });

  it('FR-API-1: is not built at all when the caller passes frames', () => {
    const frames = { request: vi.fn(() => 1), cancel: vi.fn() };
    const renderer = mountRenderer(createContainer(), createFakeCore(), { frames });

    expect(frameSourceOf).not.toHaveBeenCalled();
    renderer.destroy();
  });
});
