import { describe, expect, it } from 'vitest';

import { createSkeleton, resolveTheme } from './skeleton';

describe('createSkeleton', () => {
  it('FR-API-1: returns a detached tree with the architecture §8 structure', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'light' });

    expect(skeleton.root.isConnected).toBe(false);
    expect(skeleton.root.getAttribute('data-theme')).toBe('light');
    expect(skeleton.root.firstElementChild).toBe(skeleton.scroller);
    expect(skeleton.root.lastElementChild).toBe(skeleton.popover);
    expect([...skeleton.scroller.children]).toEqual([skeleton.header, skeleton.body]);
    expect([...skeleton.body.children]).toEqual([
      skeleton.grid,
      skeleton.links,
      skeleton.bars,
      skeleton.overlay,
    ]);
  });

  it('FR-TL-2: the scroller is a labelled region that takes keyboard focus, so the arrow keys scroll it everywhere', () => {
    // Chromium and Firefox focus a scroller without focusable children by themselves, WebKit
    // does not: `tabindex="0"` makes it the same in all three, and gives it a name to announce.
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'light' });

    expect(skeleton.scroller.getAttribute('tabindex')).toBe('0');
    expect(skeleton.scroller.getAttribute('role')).toBe('region');
    expect(skeleton.scroller.getAttribute('aria-label')).toBe('Gantt chart');

    const named = createSkeleton(document, { idPrefix: 'g-8', theme: 'light', label: 'Plan' });
    expect(named.scroller.getAttribute('aria-label')).toBe('Plan');
  });

  it('FR-I18N-2: the accessible name can be changed after the skeleton is built', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'light' });

    skeleton.setLabel('Діаграма Ганта');
    expect(skeleton.scroller.getAttribute('aria-label')).toBe('Діаграма Ганта');
    skeleton.setLabel('Діаграма Ганта');
    expect(skeleton.scroller.getAttribute('aria-label')).toBe('Діаграма Ганта');
    expect(skeleton.scroller.getAttribute('role')).toBe('region');
  });

  it('FR-THEME-2: data-theme is light, dark or auto, and can be changed later', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'dark' });
    expect(skeleton.root.getAttribute('data-theme')).toBe('dark');

    skeleton.setTheme('light');
    expect(skeleton.root.getAttribute('data-theme')).toBe('light');
    skeleton.setTheme('sepia' as never);
    expect(skeleton.root.getAttribute('data-theme')).toBe('auto');
    expect(
      createSkeleton(document, { idPrefix: 'g-8', theme: 7 as never }).root.getAttribute(
        'data-theme',
      ),
    ).toBe('auto');
    expect(['light', 'dark', 'auto', 'x', undefined, null].map(resolveTheme)).toEqual([
      'light',
      'dark',
      'auto',
      'auto',
      'auto',
      'auto',
    ]);
  });

  it('FR-API-4: every id has the prefix', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'auto' });

    const ids = [skeleton.root, ...skeleton.root.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids).toEqual(['g-9', 'g-9-scroller', 'g-9-header', 'g-9-body', 'g-9-layer']);
  });

  it('creates the SVG part in the SVG namespace', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'auto' });

    for (const element of [skeleton.body, skeleton.grid, skeleton.links, skeleton.bars]) {
      expect(element.namespaceURI).toBe('http://www.w3.org/2000/svg');
    }
    expect(skeleton.header.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
  });

  it('FR-SCROLL-3: a fixed height is a custom property of the root; the header stays in the scroller', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'light' });

    skeleton.setHeight(320);

    expect(skeleton.root.style.getPropertyValue('--gantt-height')).toBe('320px');
    expect(skeleton.root.hasAttribute('data-height')).toBe(false);
    expect([...skeleton.scroller.children]).toEqual([skeleton.header, skeleton.body]);
    expect(skeleton.pin.isConnected).toBe(false);
  });

  it('FR-SCROLL-3: auto puts the header in a sticky pin in front of the scroller, outside its clipping', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'light' });

    skeleton.setHeight('auto');

    expect(skeleton.root.getAttribute('data-height')).toBe('auto');
    expect(skeleton.root.style.getPropertyValue('--gantt-height')).toBe('');
    expect([...skeleton.root.children]).toEqual([
      skeleton.pin,
      skeleton.scroller,
      skeleton.popover,
    ]);
    expect([...skeleton.pin.children]).toEqual([skeleton.header]);
    expect([...skeleton.scroller.children]).toEqual([skeleton.body]);
    expect(skeleton.pin.className).toBe('gantt__pin');
  });

  it('FR-SCROLL-3: leaving auto (or a height again) puts the header back as the scroller first child', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'light' });
    skeleton.setHeight('auto');

    skeleton.setHeight(240);
    expect([...skeleton.scroller.children]).toEqual([skeleton.header, skeleton.body]);
    expect(skeleton.root.hasAttribute('data-height')).toBe(false);
    expect(skeleton.root.style.getPropertyValue('--gantt-height')).toBe('240px');
    expect(skeleton.pin.isConnected).toBe(false);

    // Back to filling the container: nothing of either mode is left.
    skeleton.setHeight('auto');
    skeleton.setHeight(undefined);
    expect([...skeleton.root.children]).toEqual([skeleton.scroller, skeleton.popover]);
    expect(skeleton.root.hasAttribute('data-height')).toBe(false);
    expect(skeleton.root.style.getPropertyValue('--gantt-height')).toBe('');
  });

  it('FR-SCROLL-3: the same mode twice changes nothing, and an unusable height fills the container', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'light' });
    skeleton.setHeight('auto');
    const header = skeleton.header.parentElement;

    skeleton.setHeight('auto');
    expect(skeleton.header.parentElement).toBe(header);

    for (const unusable of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, 'tall', null]) {
      skeleton.setHeight(unusable as unknown as number);
      expect(skeleton.root.hasAttribute('data-height'), String(unusable)).toBe(false);
      expect(skeleton.root.style.getPropertyValue('--gantt-height'), String(unusable)).toBe('');
      expect(skeleton.header.parentElement, String(unusable)).toBe(skeleton.scroller);
    }
  });

  it('setExtent writes the three layout custom properties and only those it is given', () => {
    const skeleton = createSkeleton(document, { idPrefix: 'g-9', theme: 'auto' });

    skeleton.setExtent({ width: 1500, headerHeight: 50, bodyHeight: 320 });
    skeleton.setExtent({ width: 1800 });

    const style = skeleton.root.style;
    expect(style.getPropertyValue('--gantt-content-width')).toBe('1800px');
    expect(style.getPropertyValue('--gantt-header-height')).toBe('50px');
    expect(style.getPropertyValue('--gantt-body-height')).toBe('320px');
  });
});
