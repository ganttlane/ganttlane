import { describe, expect, it, vi } from 'vitest';

import { listen } from './index';

describe('listen', () => {
  it('FR-API-4: calls the listener until the signal is aborted', () => {
    const controller = new AbortController();
    const target = document.createElement('div');
    const handler = vi.fn();
    listen(target, 'click', handler, { signal: controller.signal });

    target.dispatchEvent(new Event('click'));
    controller.abort();
    target.dispatchEvent(new Event('click'));

    expect(handler).toHaveBeenCalledOnce();
  });

  it('adds nothing for a signal that is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const target = document.createElement('div');
    const handler = vi.fn();

    listen(target, 'click', handler, { signal: controller.signal });
    target.dispatchEvent(new Event('click'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('works for the window and the document', () => {
    const controller = new AbortController();
    const onResize = vi.fn();
    const onVisibility = vi.fn();
    listen(window, 'resize', onResize, { signal: controller.signal });
    listen(document, 'visibilitychange', onVisibility, { signal: controller.signal });

    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));
    controller.abort();
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onResize).toHaveBeenCalledOnce();
    expect(onVisibility).toHaveBeenCalledOnce();
  });

  it('passes the once option on', () => {
    const controller = new AbortController();
    const target = document.createElement('div');
    const handler = vi.fn();
    listen(target, 'click', handler, { signal: controller.signal, once: true });

    target.dispatchEvent(new Event('click'));
    target.dispatchEvent(new Event('click'));

    expect(handler).toHaveBeenCalledOnce();
  });
});
