import type { GanttCore, TaskId } from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DisplayOptions } from './display';
import { type MountedRenderer, mountRenderer } from './renderer';
import type { ListenerTracker, ManualFrames } from './testing';
import {
  countNodes,
  createContainer,
  createManualFrames,
  createTestCore,
  stubScrollerSize,
  trackListeners,
} from './testing';

/**
 * The popover layer inside the real renderer (plan step 4.8): options through `display`, the
 * core's events and snapshots, frames, and `destroy`. What the layer does with geometry and
 * input is in `layers/popover/popover-layer.test.ts`.
 */

let tracker: ListenerTracker;

beforeEach(() => {
  vi.useFakeTimers();
  stubScrollerSize(800, 400);
  tracker = trackListeners();
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Chart {
  readonly core: GanttCore;
  readonly renderer: MountedRenderer<GanttCore>;
  readonly frames: ManualFrames;
  readonly container: HTMLElement;
  popover(): HTMLElement | null;
}

function mount(
  display: DisplayOptions,
  core: GanttCore = createTestCore({ links: [{ source: 'design', target: 'build' }] }),
): Chart {
  const container = createContainer();
  const frames = createManualFrames();
  const renderer = mountRenderer(container, core, { frames, display });
  return {
    core,
    renderer,
    frames,
    container,
    popover: () => container.querySelector<HTMLElement>('.gantt__layer > .gantt__popover'),
  };
}

function hover(chart: Chart, id: TaskId): void {
  const bar = chart.core.getSnapshot().layout.getBarRect(id)!;
  chart.core.send({
    type: 'move',
    pointerId: 1,
    x: bar.x + bar.width / 2,
    y: bar.y + bar.height / 2,
    time: 0,
  });
  chart.frames.step();
}

describe('popovers in the renderer', () => {
  it('FR-TIP-1: a hovered bar gets its tooltip in the layer, from the core and display options', () => {
    const chart = mount({ tooltip: { delay: 0 } });
    expect(chart.popover()).toBeNull();

    hover(chart, 'build');

    expect(chart.popover()?.querySelector('.gantt__popover-title')?.textContent).toBe('Build');
    expect(chart.popover()?.getAttribute('role')).toBe('tooltip');
  });

  it('FR-TIP-1: the tooltip waits its delay on the renderer’s timers', () => {
    const chart = mount({});

    hover(chart, 'build');
    expect(chart.popover()).toBeNull();
    vi.advanceTimersByTime(150);

    expect(chart.popover()).not.toBeNull();
  });

  it('FR-TIP-1: setDisplay changes the options of a chart that is open', () => {
    const chart = mount({ tooltip: { delay: 0 } });
    hover(chart, 'build');
    expect(chart.popover()).not.toBeNull();

    chart.renderer.setDisplay({ tooltip: { trigger: 'none' } });
    chart.frames.step();

    expect(chart.popover()).toBeNull();
    expect(chart.renderer.display.tooltip).toEqual({ trigger: 'none' });
  });

  it('FR-TIP-1: the display keeps a group as it was given, and resets it with undefined', () => {
    const chart = mount({ tooltip: { trigger: 'click' }, linkMenu: {}, highlightTooltip: {} });

    chart.renderer.setDisplay({ tooltip: { delay: 5 } });
    expect(chart.renderer.display.tooltip).toEqual({ delay: 5 });
    chart.renderer.setDisplay({ tooltip: undefined, linkMenu: 'x' as never });
    expect(chart.renderer.display.tooltip).toEqual({});
    expect(chart.renderer.display.linkMenu).toEqual({});
  });

  it('FR-TIP-4: choosing remove on a link menu removes the link through the callback', async () => {
    const core = createTestCore({ links: [{ source: 'design', target: 'build' }] });
    const [link] = core.getSnapshot().state.derived.graph.links;
    const chart = mount({ linkMenu: { onRemove: (item) => core.removeLink(item.id) } }, core);
    chart.container
      .querySelector('.gantt__scroller')!
      .dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 100 }));
    const target = { kind: 'link', id: link!.id } as const;
    core.send({ type: 'down', pointerId: 1, x: 0, y: 0, time: 0, target });
    core.send({ type: 'up', pointerId: 1, x: 0, y: 0, time: 10, target });
    chart.frames.step();

    const menu = chart.popover()!;
    expect(menu.getAttribute('role')).toBe('menu');
    menu.querySelector<HTMLButtonElement>('button')!.click();
    await vi.advanceTimersByTimeAsync(0);
    chart.frames.step();

    expect(core.getLink(link!.id)).toBeUndefined();
    expect(chart.popover()).toBeNull();
  });

  it('FR-I18N-1: the core’s locale option reaches the header and the tooltip, in two locales and a calendar of its own', () => {
    const labels = { en: 'March 2026', uk: 'березень 2026', th: '2569' };
    for (const [locale, month, tag] of [
      ['en', labels.en, 'en'],
      ['uk', labels.uk, 'uk'],
      ['th-TH-u-ca-buddhist', labels.th, 'th'],
    ] as const) {
      const chart = mount(
        { tooltip: { delay: 0 } },
        createTestCore({ locale, links: [{ source: 'design', target: 'build' }] }),
      );

      hover(chart, 'design');

      const header = chart.container.querySelector('.gantt__header-row')!.textContent;
      expect(header, tag).toContain(month);
      const subtitle = chart.popover()!.querySelector('.gantt__popover-subtitle')!.textContent;
      expect(subtitle, tag).toBe(
        [new Date(2026, 2, 2), new Date(2026, 2, 6)]
          .map((date) => date.toLocaleString(locale, { dateStyle: 'medium' }))
          .join(' – '),
      );
      chart.renderer.destroy();
      chart.core.destroy();
      document.body.replaceChildren();
    }
  });

  it('FR-I18N-1: setOptions({ locale }) redraws the header and the open tooltip in one frame, without a remount', () => {
    const chart = mount({ tooltip: { delay: 0 } });
    hover(chart, 'design');
    const root = chart.container.firstElementChild;
    const row = (): string => chart.container.querySelector('.gantt__header-row')!.textContent;
    const subtitle = (): string | undefined =>
      chart.popover()?.querySelector('.gantt__popover-subtitle')?.textContent;
    expect(row()).toContain('February 2026');
    expect(subtitle()).toBe('Mar 2, 2026 – Mar 6, 2026');

    chart.core.setOptions({ locale: 'uk' });
    expect(chart.frames.queued).toBe(1);
    chart.frames.step();

    expect(row()).toContain('лютий 2026');
    expect(subtitle()).toMatch(/^2 бер\.? 2026.* – 6 бер\.? 2026/);
    expect(chart.container.firstElementChild).toBe(root);
    expect(chart.container.querySelectorAll('.gantt__popover')).toHaveLength(1);

    chart.core.setOptions({ locale: 'en' });
    chart.frames.step();
    expect(row()).toContain('February 2026');
    expect(subtitle()).toBe('Mar 2, 2026 – Mar 6, 2026');
  });

  it('FR-I18N-2: setStrings redraws the open tooltip and the link menu, and the chart’s name', () => {
    const core = createTestCore({ links: [{ source: 'design', target: 'build' }] });
    const [link] = core.getSnapshot().state.derived.graph.links;
    const chart = mount({ tooltip: { delay: 0 }, linkMenu: { onRemove: () => undefined } }, core);
    hover(chart, 'design');
    const details = (): string | undefined =>
      chart.popover()?.querySelector('.gantt__popover-details')?.textContent;
    expect(details()).toBe('0% done · 5 working days');

    chart.renderer.setStrings({
      chartLabel: 'Діаграма',
      progress: (percent) => `${String(percent)} %`,
      workingDays: (days, locale) => `${days.toLocaleString(locale)} р. д.`,
      removeLink: 'Видалити',
    });
    chart.frames.step();

    expect(details()).toBe('0 % · 5 р. д.');
    expect(chart.container.querySelector('.gantt__scroller')!.getAttribute('aria-label')).toBe(
      'Діаграма',
    );

    const target = { kind: 'link', id: link!.id } as const;
    core.send({ type: 'down', pointerId: 1, x: 0, y: 0, time: 0, target });
    core.send({ type: 'up', pointerId: 1, x: 0, y: 0, time: 10, target });
    chart.frames.step();
    expect(chart.popover()!.querySelector('button')!.textContent).toBe('Видалити');
  });

  it('FR-API-4: destroy removes the popover, the timers and every listener of the layer', () => {
    const chart = mount({ tooltip: { delay: 0 } });
    hover(chart, 'build');
    expect(chart.container.querySelector('.gantt__popover')).not.toBeNull();
    // A tooltip about to open, too.
    hover(chart, 'design');
    vi.advanceTimersByTime(0);

    chart.renderer.destroy();

    expect(countNodes(chart.container)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(tracker.alive()).toEqual([]);
    chart.core.destroy();
  });
});
