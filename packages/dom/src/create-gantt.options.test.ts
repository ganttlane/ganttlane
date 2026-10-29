import type * as CoreModule from '@ganttlane/core';
import { createGanttCore, type GanttCore, type Issue, type IssuesPayload } from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { Gantt } from './create-gantt';
import { createGantt } from './create-gantt';
import { DISPLAY_DEFAULTS, DISPLAY_RULES, GROUP_RULES } from './display';
import type { GanttOptions } from './options';
import type * as RendererModule from './renderer';
import { type MountedRenderer, mountRenderer } from './renderer';
import { DEFAULT_STRINGS } from './strings';
import type { ManualFrames } from './testing';
import { createContainer, createManualFrames, stubScrollerSize } from './testing';

/** The subscriptions to the core that are alive: the renderer's `subscribe` and `on`. */
const alive = vi.hoisted(() => ({ subscribe: 0, on: 0 }));

// The real core and renderer, seen through spies: what `createGantt` gives each of them.
vi.mock('@ganttlane/core', async (importOriginal) => {
  const original = await importOriginal<typeof CoreModule>();
  /** `fn` made to count what it hands out as alive until the unsubscribe function is called. */
  const counted =
    <A extends unknown[]>(fn: (...args: A) => () => void, key: keyof typeof alive) =>
    (...args: A): (() => void) => {
      alive[key]++;
      const off = fn(...args);
      let done = false;
      return () => {
        if (!done) alive[key]--;
        done = true;
        off();
      };
    };
  // The core is frozen: a copy of it, getters and all, with spies for `setOptions` and counters
  // on its subscriptions.
  const create = ((options: Parameters<typeof original.createGanttCore>[0]) => {
    const core = original.createGanttCore(options);
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(core);
    descriptors.setOptions = { ...descriptors.setOptions, value: vi.fn(core.setOptions) };
    descriptors.subscribe = {
      ...descriptors.subscribe,
      value: counted(core.subscribe, 'subscribe'),
    };
    descriptors.on = { ...descriptors.on, value: counted(core.on, 'on') };
    return Object.defineProperties({}, descriptors) as typeof core;
  }) as typeof original.createGanttCore;
  return { ...original, createGanttCore: vi.fn(create) };
});
vi.mock('./renderer', async (importOriginal) => {
  const original = await importOriginal<typeof RendererModule>();
  return { ...original, mountRenderer: vi.fn(original.mountRenderer) };
});

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
const LINKS = [{ source: 'a', target: 'b' }];

beforeEach(() => {
  vi.useFakeTimers();
  stubScrollerSize(800, 400);
  vi.mocked(createGanttCore).mockClear();
  vi.mocked(mountRenderer).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Chart {
  readonly gantt: Gantt;
  readonly frames: ManualFrames;
  readonly container: HTMLElement;
  readonly mounted: MountedRenderer<GanttCore>;
  /** The options `createGanttCore` and `mountRenderer` were given. */
  readonly coreOptions: Record<string, unknown>;
  readonly rendererOptions: Record<string, unknown>;
  /** What each setter was called with from now on. */
  readonly calls: {
    readonly core: Mock<GanttCore['setOptions']>;
    readonly setDisplay: Mock<MountedRenderer['setDisplay']>;
    readonly setStrings: Mock<MountedRenderer['setStrings']>;
    readonly setHeight: Mock<MountedRenderer['setHeight']>;
    readonly setTheme: Mock<MountedRenderer['setTheme']>;
  };
}

/** A spy for the issues handler. */
const issuesSpy = (): Mock<(payload: IssuesPayload) => void> =>
  vi.fn<(payload: IssuesPayload) => void>();

function chart(options: Partial<GanttOptions> = {}): Chart {
  const frames = createManualFrames();
  const container = createContainer();
  const gantt = createGantt(container, {
    tasks: TASKS,
    links: LINKS,
    now: () => '2026-03-04',
    renderer: { frames },
    ...options,
  });
  const mounted = vi.mocked(mountRenderer).mock.results.at(-1)?.value as MountedRenderer<GanttCore>;
  return {
    gantt,
    frames,
    container,
    mounted,
    coreOptions: vi.mocked(createGanttCore).mock.calls.at(-1)?.[0] as unknown as Record<
      string,
      unknown
    >,
    rendererOptions: vi.mocked(mountRenderer).mock.calls.at(-1)?.[2] as unknown as Record<
      string,
      unknown
    >,
    calls: {
      core: vi.mocked(gantt.core.setOptions),
      setDisplay: vi.spyOn(mounted, 'setDisplay'),
      setStrings: vi.spyOn(mounted, 'setStrings'),
      setHeight: vi.spyOn(mounted, 'setHeight'),
      setTheme: vi.spyOn(mounted, 'setTheme'),
    },
  };
}

const paths = (issues: readonly Issue[]): (string | undefined)[] => issues.map((i) => i.path);

describe('createGantt: what each part is given (FR-API-1)', () => {
  it('FR-API-1: the core gets the core options without the renderer’s, and `layout` without `height`', () => {
    const onTasksChange = vi.fn();
    const { coreOptions } = chart({
      locale: 'uk',
      layout: { rowHeight: 30, height: 300 },
      theme: 'dark',
      strings: { chartLabel: 'Plan' },
      display: { today: false },
      highlights: [{ id: 'h', dates: ['2026-03-04'] }],
      tooltip: { delay: 0 },
      linkMenu: { render: () => null },
      highlightTooltip: { followCursor: true },
      toolbar: false,
      onTasksChange,
      onIssues: issuesSpy(),
    });

    expect(Object.keys(coreOptions).sort()).toEqual(
      ['layout', 'links', 'locale', 'now', 'onIssues', 'onTasksChange', 'tasks'].sort(),
    );
    expect(coreOptions.layout).toEqual({ rowHeight: 30 });
    expect(coreOptions.onTasksChange).toBe(onTasksChange);
  });

  it('FR-API-1: a layout with only a height is no layout for the core', () => {
    const { coreOptions } = chart({ layout: { height: 300 } });

    expect('layout' in coreOptions).toBe(false);
  });

  it('FR-API-1: the renderer gets theme, strings, height, mount options and the lifted display options', () => {
    const frames = createManualFrames();
    const highlights = [{ id: 'h', dates: ['2026-03-04'] }];
    const render = (): string => 'x';

    const { rendererOptions } = chart({
      layout: { height: 300 },
      theme: 'dark',
      strings: { chartLabel: 'Plan' },
      display: { today: false, gridLines: 'none' },
      highlights,
      tooltip: { delay: 0, render },
      highlightTooltip: { followCursor: true },
      renderer: { frames, idPrefix: 'mine' },
    });

    expect(rendererOptions).toMatchObject({
      theme: 'dark',
      strings: { chartLabel: 'Plan' },
      height: 300,
      idPrefix: 'mine',
      frames,
      display: {
        today: false,
        gridLines: 'none',
        highlightDays: highlights,
        tooltip: { delay: 0, render },
        highlightTooltip: { followCursor: true },
        linkMenu: { onRemove: expect.any(Function) as unknown },
      },
    });
  });

  it('FR-API-1, FR-THEME-2: the defaults are the renderer’s: theme auto, fill the container, English', () => {
    const { container, gantt, mounted, coreOptions } = chart();

    const root = container.querySelector('.gantt')!;
    expect(root.getAttribute('data-theme')).toBe('auto');
    expect(root.getAttribute('data-height')).toBeNull();
    expect(root.getAttribute('style') ?? '').not.toContain('--gantt-height');
    expect(mounted.strings).toBe(DEFAULT_STRINGS);
    expect(gantt.core.getSnapshot().header.locale).toBe('en');
    // The facade adds no default of its own: `timeline.infinite` is off because the core's is.
    expect('timeline' in coreOptions).toBe(false);
  });

  it('FR-API-1: the options show in the chart: theme, name, height, display, highlights', () => {
    const { container, frames } = chart({
      theme: 'light',
      strings: { chartLabel: 'Plan' },
      layout: { height: 250 },
      display: { today: false },
      highlights: [{ id: 'launch', dates: ['2026-03-04'] }],
    });

    const root = container.querySelector('.gantt')!;
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(container.querySelector('.gantt__scroller')?.getAttribute('aria-label')).toBe('Plan');
    expect(root.getAttribute('style')).toContain('--gantt-height: 250px');
    expect(container.querySelector('.gantt__today')).toBeNull();
    expect(container.querySelector('[data-highlight="launch"]')).not.toBeNull();
    expect(frames.queued).toBe(0);
  });

  it('FR-API-1: keys nobody knows are ignored, with no issue', () => {
    const { gantt } = chart({
      nothing: 1,
      tooltip: { nothing: 2 },
      display: { nothing: 3 },
      strings: { nothing: 'x' },
    } as never);

    expect(gantt.getIssues().options).toEqual([]);
    expect(gantt.setOptions({ alsoNothing: 1 } as never)).toEqual([]);
  });
});

describe('createGantt: setOptions routes each key (FR-API-2)', () => {
  it('FR-API-2: a core option goes to the core only', () => {
    const { gantt, calls } = chart();

    for (const patch of [
      { locale: 'uk' },
      { viewMode: 'week' },
      { editing: false },
      { scheduling: { snap: '1d' as const } },
      { hierarchy: { expandedKeys: [] } },
      { layout: { rowHeight: 40 } },
      { timeline: { padding: '1w' } },
      { direction: 'ltr' as const },
    ]) {
      calls.core.mockClear();
      gantt.setOptions(patch);
      expect(calls.core).toHaveBeenCalledTimes(1);
      expect(calls.core).toHaveBeenCalledWith(patch);
    }
    expect(calls.setDisplay).not.toHaveBeenCalled();
    expect(calls.setStrings).not.toHaveBeenCalled();
    expect(calls.setHeight).not.toHaveBeenCalled();
    expect(calls.setTheme).not.toHaveBeenCalled();
  });

  it('FR-API-2: a renderer option goes to the renderer only, and only to its own part', () => {
    const { gantt, calls } = chart();

    gantt.setOptions({ theme: 'dark' });
    expect(calls.setTheme).toHaveBeenCalledExactlyOnceWith('dark');
    gantt.setOptions({ strings: { removeLink: 'Delete' } });
    expect(calls.setStrings).toHaveBeenCalledExactlyOnceWith({ removeLink: 'Delete' });
    gantt.setOptions({ layout: { height: 300 } });
    expect(calls.setHeight).toHaveBeenCalledExactlyOnceWith(300);
    gantt.setOptions({ display: { today: false } });
    gantt.setOptions({ highlights: [{ id: 'h', dates: ['2026-03-04'] }] });
    gantt.setOptions({ tooltip: { delay: 0 } });
    gantt.setOptions({ highlightTooltip: { followCursor: true } });
    expect(calls.setDisplay.mock.calls).toEqual([
      [{ today: false }],
      [{ highlightDays: [{ id: 'h', dates: ['2026-03-04'] }] }],
      [{ tooltip: { delay: 0 } }],
      [{ highlightTooltip: { followCursor: true } }],
    ]);
    expect(calls.core).not.toHaveBeenCalled();
    expect(calls.setTheme).toHaveBeenCalledTimes(1);
    expect(calls.setStrings).toHaveBeenCalledTimes(1);
    expect(calls.setHeight).toHaveBeenCalledTimes(1);
  });

  it('FR-API-2: a patch with both kinds of keys is split between the core and the renderer', () => {
    const { gantt, calls } = chart();

    gantt.setOptions({ locale: 'uk', theme: 'dark', layout: { rowHeight: 40, height: 300 } });

    expect(calls.core).toHaveBeenCalledExactlyOnceWith({ locale: 'uk', layout: { rowHeight: 40 } });
    expect(calls.setTheme).toHaveBeenCalledExactlyOnceWith('dark');
    expect(calls.setHeight).toHaveBeenCalledExactlyOnceWith(300);
    expect(calls.setDisplay).not.toHaveBeenCalled();
    expect(calls.setStrings).not.toHaveBeenCalled();
  });

  it('FR-API-2: a height is no business of the core’s layout: the core is not called for it', () => {
    const { gantt, calls } = chart({ layout: { rowHeight: 30 } });
    const layout = gantt.core.getSnapshot().layout;

    gantt.setOptions({ layout: { height: 'auto' } });

    // The renderer tells the core its new viewport, but `setOptions` never reaches the core.
    expect(calls.core).not.toHaveBeenCalled();
    expect(calls.setHeight).toHaveBeenCalledExactlyOnceWith('auto');
    expect(gantt.core.getSnapshot().layout).toBe(layout);
  });

  it('FR-EVT-2: a handler swap is O(1): no recreation, no redraw, the core’s snapshot stays', () => {
    const { gantt, calls, frames, container } = chart({ onTasksChange: vi.fn() });
    const snapshot = gantt.core.getSnapshot();
    const subscriber = vi.fn();
    gantt.core.subscribe(subscriber);
    const root = container.querySelector('.gantt');
    const requested = frames.requested;

    for (let i = 0; i < 20; i++) {
      gantt.setOptions({
        onTasksChange: vi.fn(),
        onSelectionChange: vi.fn(),
        onIssues: issuesSpy(),
      });
    }

    // The core hears of the two it owns, to swap them; nothing else is touched.
    expect(calls.core).toHaveBeenCalledTimes(20);
    for (const [patch] of calls.core.mock.calls) {
      expect(Object.keys(patch as object).sort()).toEqual(['onSelectionChange', 'onTasksChange']);
    }
    expect(calls.setDisplay).not.toHaveBeenCalled();
    expect(calls.setStrings).not.toHaveBeenCalled();
    expect(calls.setHeight).not.toHaveBeenCalled();
    expect(calls.setTheme).not.toHaveBeenCalled();
    expect(gantt.core.getSnapshot()).toBe(snapshot);
    expect(subscriber).not.toHaveBeenCalled();
    expect(frames.requested).toBe(requested);
    expect(vi.mocked(mountRenderer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createGanttCore)).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.gantt')).toBe(root);
  });

  it('FR-EVT-2: the issues handler is swapped without touching the core at all', () => {
    const { gantt, calls } = chart({ onIssues: issuesSpy() });

    gantt.setOptions({ onIssues: issuesSpy() });
    gantt.setOptions({ onIssues: undefined });

    expect(calls.core).not.toHaveBeenCalled();
  });

  it('FR-API-2: an empty patch, a toolbar and the mount options touch nothing', () => {
    const { gantt, calls, frames } = chart();
    const requested = frames.requested;

    gantt.setOptions({});
    gantt.setOptions({ toolbar: false });
    gantt.setOptions({ renderer: { idPrefix: 'late' } } as never);

    expect(calls.core).not.toHaveBeenCalled();
    expect(calls.setDisplay).not.toHaveBeenCalled();
    expect(frames.requested).toBe(requested);
    expect(gantt.getIssues().options).toEqual([]);
  });

  it('FR-API-2: a patch that is not an object reaches the core, which reports it', () => {
    const { gantt } = chart();

    const issues = gantt.setOptions(null as never);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'invalid-option' });
  });

  it('FR-API-2: the data goes to the core: tasks and links in a patch replace them', () => {
    const { gantt, calls } = chart();

    gantt.setOptions({ tasks: [{ id: 'z', name: 'Z', start: '2026-03-02', end: '2026-03-03' }] });

    expect(calls.core).toHaveBeenCalledTimes(1);
    expect(gantt.getTask('z')?.name).toBe('Z');
    expect(gantt.getTask('a')).toBeUndefined();
  });

  it('FR-THEME-2: the theme changes at runtime on the root, with no frame and nothing redrawn', () => {
    const { gantt, container, frames } = chart();
    const root = container.querySelector('.gantt')!;
    const requested = frames.requested;

    gantt.setOptions({ theme: 'dark' });
    expect(root.getAttribute('data-theme')).toBe('dark');
    gantt.setOptions({ theme: 'light' });
    expect(root.getAttribute('data-theme')).toBe('light');
    gantt.setOptions({ theme: undefined });
    expect(root.getAttribute('data-theme')).toBe('auto');

    expect(frames.requested).toBe(requested);
  });

  it('FR-I18N-1, FR-I18N-2: the locale and the strings change at runtime without a remount', () => {
    const { gantt, container, frames } = chart();
    const root = container.querySelector('.gantt');

    gantt.setOptions({ locale: 'uk', strings: { chartLabel: 'Діаграма Ганта' } });
    frames.step();

    expect(container.querySelector('.gantt')).toBe(root);
    expect(gantt.core.getSnapshot().header.locale).toBe('uk');
    expect(container.querySelector('.gantt__scroller')?.getAttribute('aria-label')).toBe(
      'Діаграма Ганта',
    );
    expect(container.querySelector('.gantt__header')?.textContent).toContain('березень');
  });

  it('FR-SCROLL-3: the height changes at runtime and tells the core the new viewport', () => {
    const { gantt, container } = chart();
    const root = container.querySelector('.gantt')!;

    gantt.setOptions({ layout: { height: 'auto' } });
    expect(root.getAttribute('data-height')).toBe('auto');
    gantt.setOptions({ layout: { height: 320 } });
    expect(root.getAttribute('data-height')).toBeNull();
    expect(root.getAttribute('style')).toContain('--gantt-height: 320px');
    gantt.setOptions({ layout: { height: undefined } });
    expect(root.getAttribute('style') ?? '').not.toContain('--gantt-height');
  });
});

describe('createGantt: how an option object is merged (FR-API-2)', () => {
  it('FR-API-2: display is merged field by field; a field set to undefined is back to its default', () => {
    const { gantt, mounted } = chart({ display: { today: false, gridLines: 'none' } });

    gantt.setOptions({ display: { barLabel: 'inside' } });
    expect(mounted.display).toMatchObject({ today: false, gridLines: 'none', barLabel: 'inside' });
    gantt.setOptions({ display: { today: undefined } });
    expect(mounted.display).toMatchObject({ today: true, gridLines: 'none', barLabel: 'inside' });
  });

  it('FR-API-2: display set to undefined puts every plain option back, and leaves the popover groups', () => {
    const { gantt, mounted } = chart({
      display: { today: false, gridLines: 'none', barLabel: 'inside' },
      tooltip: { delay: 0 },
      highlights: [{ id: 'h' }],
    });

    gantt.setOptions({ display: undefined });

    expect(mounted.display).toMatchObject({
      today: DISPLAY_DEFAULTS.today,
      gridLines: DISPLAY_DEFAULTS.gridLines,
      barLabel: DISPLAY_DEFAULTS.barLabel,
      tooltip: { delay: 0 },
      highlightDays: [{ id: 'h' }],
    });
  });

  it('FR-API-2: tooltip, linkMenu and highlightTooltip are taken whole', () => {
    const { gantt, mounted } = chart({
      tooltip: { trigger: 'click', delay: 10 },
      highlightTooltip: { followCursor: true },
    });
    const render = (): null => null;

    gantt.setOptions({ tooltip: { placement: 'bottom' } });
    expect(mounted.display.tooltip).toEqual({ placement: 'bottom' });
    gantt.setOptions({ highlightTooltip: {} });
    expect(mounted.display.highlightTooltip).toEqual({});
    gantt.setOptions({ linkMenu: { render } });
    expect(mounted.display.linkMenu).toEqual({ render, onRemove: expect.any(Function) as unknown });
    gantt.setOptions({ tooltip: undefined });
    expect(mounted.display.tooltip).toEqual({});
  });

  it('FR-API-2: the highlights are a list that replaces the one before', () => {
    const { gantt, mounted } = chart({ highlights: [{ id: 'one' }] });

    gantt.setOptions({ highlights: [{ id: 'two' }, { id: 'three' }] });
    expect(mounted.display.highlightDays.map((item) => item.id)).toEqual(['two', 'three']);
    gantt.setOptions({ highlights: undefined });
    expect(mounted.display.highlightDays).toEqual([]);
  });

  it('FR-API-2: strings are merged by key and put back with undefined, as a whole too', () => {
    const { gantt, mounted } = chart({ strings: { chartLabel: 'Plan' } });

    gantt.setOptions({ strings: { removeLink: 'Delete' } });
    expect(mounted.strings).toMatchObject({ chartLabel: 'Plan', removeLink: 'Delete' });
    gantt.setOptions({ strings: { chartLabel: undefined } });
    expect(mounted.strings).toMatchObject({ chartLabel: 'Gantt chart', removeLink: 'Delete' });
    gantt.setOptions({ strings: undefined });
    expect(mounted.strings).toEqual(DEFAULT_STRINGS);
  });

  it('FR-API-2: layout is merged field by field: the core’s fields and the height apart', () => {
    const { gantt, calls } = chart({ layout: { rowHeight: 30, height: 300 } });

    gantt.setOptions({ layout: { barHeight: 12 } });
    expect(calls.setHeight).not.toHaveBeenCalled();
    expect(gantt.core.getSnapshot().layoutOptions).toMatchObject({ rowHeight: 30, barHeight: 12 });
    gantt.setOptions({ layout: { height: undefined } });
    expect(calls.setHeight).toHaveBeenLastCalledWith(undefined);
    expect(gantt.core.getSnapshot().layoutOptions).toMatchObject({ rowHeight: 30, barHeight: 12 });
    gantt.setOptions({ layout: undefined });
    expect(calls.setHeight).toHaveBeenCalledTimes(2);
    expect(gantt.core.getSnapshot().layoutOptions.rowHeight).toBe(
      chart().gantt.core.getSnapshot().layoutOptions.rowHeight,
    );
  });
});

describe('createGantt: linkMenu.onRemove (FR-TIP-4)', () => {
  const onRemoveOf = (mounted: MountedRenderer<GanttCore>) =>
    mounted.display.linkMenu.onRemove as (link: { id: string }) => unknown;

  it('FR-TIP-4: defaults to the chart’s removeLink', async () => {
    const { gantt, mounted } = chart();

    expect(gantt.getLink('a:FS:b')).toBeDefined();
    await onRemoveOf(mounted)({ id: 'a:FS:b' });

    expect(gantt.getLink('a:FS:b')).toBeUndefined();
  });

  it('FR-TIP-4: the caller’s own onRemove wins, at creation and in setOptions', () => {
    const mine = vi.fn();
    const later = vi.fn();
    const { gantt, mounted } = chart({ linkMenu: { onRemove: mine } });

    expect(mounted.display.linkMenu.onRemove).toBe(mine);
    gantt.setOptions({ linkMenu: { onRemove: later } });
    expect(mounted.display.linkMenu.onRemove).toBe(later);
    gantt.setOptions({ linkMenu: { render: () => null } });
    // Taken whole: the group has no onRemove of its own now, so the default is back.
    expect(mounted.display.linkMenu.onRemove).not.toBe(later);
    expect(typeof mounted.display.linkMenu.onRemove).toBe('function');
  });

  it('FR-TIP-4: a link menu with no onRemove of its own still has the default', () => {
    const { gantt, mounted } = chart({ linkMenu: { render: () => 'x' } });

    expect(typeof mounted.display.linkMenu.onRemove).toBe('function');
    gantt.setOptions({ linkMenu: undefined });
    expect(typeof mounted.display.linkMenu.onRemove).toBe('function');
  });

  it('FR-TIP-4: choosing remove on the menu of a link removes it, with no option set', async () => {
    const { gantt, container, frames } = chart();
    container
      .querySelector('.gantt__scroller')!
      .dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 100 }));
    const target = { kind: 'link', id: 'a:FS:b' } as const;
    gantt.core.send({ type: 'down', pointerId: 1, x: 0, y: 0, time: 0, target });
    gantt.core.send({ type: 'up', pointerId: 1, x: 0, y: 0, time: 10, target });
    frames.step();

    const menu = container.querySelector<HTMLElement>('.gantt__layer > .gantt__popover')!;
    expect(menu.getAttribute('role')).toBe('menu');
    menu.querySelector('button')!.click();
    await vi.advanceTimersByTimeAsync(0);
    frames.step();

    expect(gantt.getLink('a:FS:b')).toBeUndefined();
    expect(container.querySelector('.gantt__layer > .gantt__popover')).toBeNull();
  });
});

describe('createGantt: destroy (FR-API-4)', () => {
  it('FR-API-4: the renderer’s subscriptions to the core are all ended by destroy', () => {
    alive.subscribe = 0;
    alive.on = 0;
    const { gantt } = chart({ tooltip: { delay: 0 } });
    expect(alive.subscribe).toBeGreaterThan(0);
    expect(alive.on).toBeGreaterThan(0);

    gantt.destroy();
    gantt.destroy();

    expect(alive).toEqual({ subscribe: 0, on: 0 });
  });
});

describe('createGantt: hideTooltip', () => {
  it('FR-TIP-1: closes the tooltip that is open', () => {
    const { gantt, container, frames } = chart({ tooltip: { delay: 0 } });
    const bar = gantt.core.getSnapshot().layout.getBarRect('b')!;
    gantt.core.send({
      type: 'move',
      pointerId: 1,
      x: bar.x + bar.width / 2,
      y: bar.y + bar.height / 2,
      time: 0,
    });
    frames.step();
    expect(container.querySelector('.gantt__popover')).not.toBeNull();

    gantt.hideTooltip();

    expect(container.querySelector('.gantt__popover')).toBeNull();
    gantt.hideTooltip();
  });
});

describe('createGantt: the renderer’s options are validated (FR-DATA-4)', () => {
  const invalid = (gantt: Gantt): Issue[] => [...gantt.getIssues().options];

  it('FR-DATA-4: a bad theme is an invalid-option with its path and default, and the chart is auto', () => {
    const { gantt, container } = chart({ theme: 'sepia' as never });

    expect(invalid(gantt)).toMatchObject([
      {
        code: 'invalid-option',
        severity: 'error',
        path: 'theme',
        value: 'sepia',
        suggested: 'auto',
      },
    ]);
    expect(container.querySelector('.gantt')?.getAttribute('data-theme')).toBe('auto');
  });

  it('FR-DATA-4: display fields are reported with their full paths and their defaults', () => {
    const { gantt } = chart({
      display: {
        gridLines: 'diagonal',
        today: 'yes',
        nonWorkingDays: true,
        highlights: 1,
        rowStripes: 'zebra',
        barLabel: 7,
        renderBarLabel: 'x',
        headerRangeHighlight: null,
        linkCurveRadius: -1,
        stickyBarLabels: 'no',
        expectedProgress: 0,
      } as never,
    });

    const found = invalid(gantt);
    expect(paths(found)).toEqual([
      'display.gridLines',
      'display.today',
      'display.nonWorkingDays',
      'display.highlights',
      'display.rowStripes',
      'display.barLabel',
      'display.renderBarLabel',
      'display.headerRangeHighlight',
      'display.linkCurveRadius',
      'display.stickyBarLabels',
      'display.expectedProgress',
    ]);
    expect(found.every((item) => item.code === 'invalid-option')).toBe(true);
    expect(found.find((item) => item.path === 'display.gridLines')).toMatchObject({
      value: 'diagonal',
      suggested: 'both',
    });
    expect(found.find((item) => item.path === 'display.linkCurveRadius')).toMatchObject({
      value: -1,
      suggested: 5,
    });
  });

  it('FR-DATA-4: the fields of the popover groups are reported, and the renderer never gets a bad one', () => {
    const { gantt, mounted } = chart({
      tooltip: {
        trigger: 'drag',
        followCursor: 1,
        showWhileDragging: 'x',
        render: 'text',
        delay: -5,
        placement: 'left',
        valid: 'kept',
      } as never,
      linkMenu: { render: 5, onRemove: 'x' } as never,
      highlightTooltip: { followCursor: 'x' } as never,
    });

    expect(paths(gantt.getIssues().options)).toEqual([
      'tooltip.trigger',
      'tooltip.followCursor',
      'tooltip.showWhileDragging',
      'tooltip.render',
      'tooltip.delay',
      'tooltip.placement',
      'linkMenu.render',
      'linkMenu.onRemove',
      'highlightTooltip.followCursor',
    ]);
    expect(gantt.getIssues().options.find((item) => item.path === 'tooltip.delay')).toMatchObject({
      suggested: 150,
    });
    // Each group is the usable part of what was given.
    expect(mounted.display.tooltip).toEqual({ valid: 'kept' });
    expect(mounted.display.highlightTooltip).toEqual({});
    expect(mounted.display.linkMenu).toEqual({ onRemove: expect.any(Function) as unknown });
  });

  it('FR-DATA-4: layout.height, strings, highlights and a group that is no object', () => {
    const { gantt, mounted } = chart({
      layout: { height: -1 },
      strings: { chartLabel: '', removeLink: 5, progress: 'x', today: 'ok' } as never,
      highlights: [null, { id: 1 }, { id: 'good' }, 'x'] as never,
      display: 'x' as never,
      tooltip: 5 as never,
      linkMenu: null as never,
      highlightTooltip: [] as never,
    });

    expect(paths(gantt.getIssues().options)).toEqual([
      'strings.chartLabel',
      'strings.progress',
      'strings.removeLink',
      'layout.height',
      'display',
      'highlights[0]',
      'highlights[1]',
      'highlights[3]',
      'tooltip',
      'linkMenu',
      'highlightTooltip',
    ]);
    expect(mounted.display.highlightDays).toEqual([{ id: 'good' }]);
    expect(mounted.strings).toMatchObject({ chartLabel: 'Gantt chart', today: 'ok' });
    for (const bad of [{ height: 'tall' }, { height: 0 }, { height: Number.NaN }]) {
      const again = chart({ layout: bad as never });
      expect(paths(again.gantt.getIssues().options)).toEqual(['layout.height']);
    }
    expect(paths(chart({ strings: 'x' as never }).gantt.getIssues().options)).toEqual(['strings']);
    expect(paths(chart({ highlights: 'x' as never }).gantt.getIssues().options)).toEqual([
      'highlights',
    ]);
  });

  it('FR-DATA-4: an undefined value is the default, not a problem', () => {
    const { gantt } = chart({
      theme: undefined,
      strings: { chartLabel: undefined },
      display: { today: undefined },
      tooltip: { trigger: undefined },
      layout: { height: undefined },
      highlights: undefined,
      linkMenu: undefined,
    });

    expect(gantt.getIssues().options).toEqual([]);
  });

  it('FR-DATA-4: values planned for a later release are unsupported-option issues', () => {
    const { gantt, mounted } = chart({
      toolbar: { todayButton: true },
      direction: 'rtl',
      tooltip: { trigger: 'focus' },
    });

    const found = gantt.getIssues().options;
    expect(found.map((item) => [item.code, item.path])).toEqual([
      ['unsupported-option', 'tooltip.trigger'],
      ['unsupported-option', 'toolbar'],
      ['unsupported-option', 'direction'],
    ]);
    // Accepted all the same: 'rtl' is stored (drawn left to right) and 'focus' opens nothing.
    expect(gantt.core.getSnapshot().timeline.scale.direction).toBe('rtl');
    expect(mounted.display.tooltip).toEqual({ trigger: 'focus' });
    expect(chart({ toolbar: false, direction: 'ltr' }).gantt.getIssues().options).toEqual([]);
  });

  it('FR-DATA-4: an invalid direction is reported once, by the core', () => {
    const { gantt } = chart({ direction: 'up' as never });

    expect(paths(gantt.getIssues().options)).toEqual(['direction']);
  });

  it('FR-DATA-4: issues are frozen records with the path in the message', () => {
    const { gantt } = chart({ theme: 'sepia' as never, tooltip: { delay: -1 } });

    for (const item of gantt.getIssues().options) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(item.message.startsWith(`${item.path ?? ''}: `)).toBe(true);
    }
  });

  it('FR-DATA-4: what a rule suggests is the default the renderer uses', () => {
    for (const [key, rule] of Object.entries(DISPLAY_RULES)) {
      expect(rule[1], key).toBe(DISPLAY_DEFAULTS[key as keyof typeof DISPLAY_DEFAULTS]);
    }
    expect(GROUP_RULES.tooltip.trigger?.[1]).toBe('hover');
    expect(GROUP_RULES.tooltip.showWhileDragging?.[1]).toBe(true);
    expect(GROUP_RULES.tooltip.delay?.[1]).toBe(150);
    expect(GROUP_RULES.tooltip.placement?.[1]).toBe('top');
  });
});

describe('createGantt: one list of issues for the core and the renderer (FR-DATA-4)', () => {
  const bothBad = {
    scheduling: { propagation: 'sideways' as never },
    tooltip: { trigger: 'drag' as never },
  };

  it('FR-DATA-4: getIssues().options has the core’s issues, then the renderer’s', () => {
    const { gantt } = chart(bothBad);

    expect(paths(gantt.getIssues().options)).toEqual(['scheduling.propagation', 'tooltip.trigger']);
    expect(gantt.getIssues().options).toBe(gantt.getIssues().options);
    expect(gantt.getIssues().data).toEqual([]);
  });

  it('FR-DATA-4: without renderer issues the list is the core’s own', () => {
    const { gantt } = chart({ scheduling: { propagation: 'sideways' as never } });

    expect(gantt.getIssues().options).toBe(gantt.core.getIssues().options);
  });

  it('FR-DATA-4: at creation one event of the options carries both, and one of the data its own', () => {
    const events: IssuesPayload[] = [];
    chart({
      ...bothBad,
      tasks: [...TASKS, { id: 'a', name: 'Again', start: '2026-03-02', end: '2026-03-03' }],
      onIssues: (payload) => events.push(payload),
    });

    expect(events.map((event) => event.source).sort()).toEqual(['data', 'options']);
    const options = events.find((event) => event.source === 'options')!;
    expect(paths(options.issues)).toEqual(['scheduling.propagation', 'tooltip.trigger']);
  });

  it('FR-DATA-4: with only a renderer issue the event comes at creation too', () => {
    const onIssues = issuesSpy();

    const { gantt } = chart({ theme: 'sepia' as never, onIssues });

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onIssues.mock.calls[0]?.[0]).toMatchObject({ source: 'options' });
    expect(paths(onIssues.mock.calls[0]?.[0].issues as Issue[])).toEqual(['theme']);
    expect(onIssues.mock.calls[0]?.[0].issues).toBe(gantt.getIssues().options);
  });

  it('FR-DATA-4: no issue, no event', () => {
    const onIssues = issuesSpy();

    chart({ onIssues, tooltip: { delay: 5 } });

    expect(onIssues).not.toHaveBeenCalled();
  });

  it('FR-DATA-4: setOptions returns the merged list and sends one event when the renderer’s issues change', () => {
    const onIssues = issuesSpy();
    const { gantt } = chart({ onIssues });
    const listener = vi.fn();
    gantt.on('issues', listener);

    const issues = gantt.setOptions({ tooltip: { trigger: 'drag' as never } });

    expect(paths(issues)).toEqual(['tooltip.trigger']);
    expect(issues).toBe(gantt.getIssues().options);
    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(onIssues.mock.calls[0]?.[0]).toBe(listener.mock.calls[0]?.[0]);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ source: 'options', issues });
    expect(Object.isFrozen(listener.mock.calls[0]?.[0])).toBe(true);
  });

  it('FR-DATA-4: the same problem again is no news; a different value is', () => {
    const onIssues = issuesSpy();
    const { gantt } = chart({ onIssues });

    gantt.setOptions({ tooltip: { delay: -1 } });
    gantt.setOptions({ tooltip: { delay: -1 } });
    expect(onIssues).toHaveBeenCalledTimes(1);
    gantt.setOptions({ tooltip: { delay: -2 } });
    expect(onIssues).toHaveBeenCalledTimes(2);
  });

  it('FR-DATA-4: fixing an option sends the shorter list, and the others stay', () => {
    const onIssues = issuesSpy();
    const { gantt } = chart({ onIssues });
    gantt.setOptions({ tooltip: { delay: -1 }, theme: 'sepia' as never });
    onIssues.mockClear();

    gantt.setOptions({ tooltip: { delay: 1 } });
    expect(paths(onIssues.mock.calls[0]?.[0].issues as Issue[])).toEqual(['theme']);
    gantt.setOptions({ theme: 'dark' });
    expect(onIssues.mock.calls[1]?.[0].issues).toEqual([]);
    expect(gantt.getIssues().options).toEqual([]);
  });

  it('FR-DATA-4: the core and the renderer changing together make one event', () => {
    const onIssues = issuesSpy();
    const { gantt } = chart({ onIssues });

    gantt.setOptions(bothBad);

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(paths(onIssues.mock.calls[0]?.[0].issues as Issue[])).toEqual([
      'scheduling.propagation',
      'tooltip.trigger',
    ]);
  });

  it('FR-DATA-4: a change of the core’s issues alone carries the renderer’s along', () => {
    const onIssues = issuesSpy();
    const { gantt } = chart({ tooltip: { delay: -1 }, onIssues });
    onIssues.mockClear();

    gantt.setOptions({ scheduling: { propagation: 'sideways' as never } });

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(paths(onIssues.mock.calls[0]?.[0].issues as Issue[])).toEqual([
      'scheduling.propagation',
      'tooltip.delay',
    ]);
  });

  it('FR-DATA-4: the data issues are the core’s, as they are', () => {
    const onIssues = issuesSpy();
    const { gantt } = chart({ onIssues, theme: 'sepia' as never });
    onIssues.mockClear();

    gantt.setTasks([...TASKS, { id: 'a', name: 'Again', start: '2026-03-02', end: '2026-03-03' }]);

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onIssues.mock.calls[0]?.[0]).toMatchObject({ source: 'data' });
    expect(onIssues.mock.calls[0]?.[0].issues).toBe(gantt.getIssues().data);
  });

  it('FR-EVT-3: on(issues) returns an unsubscribe; listeners run in subscription order after onIssues', () => {
    const order: string[] = [];
    const { gantt } = chart({ onIssues: () => order.push('option') });
    const off = gantt.on('issues', () => order.push('first'));
    gantt.on('issues', () => order.push('second'));

    gantt.setOptions({ theme: 'sepia' as never });
    off();
    off();
    gantt.setOptions({ theme: 'night' as never });

    expect(order).toEqual(['option', 'first', 'second', 'option', 'second']);
  });

  it('FR-EVT-1: an issues listener that throws on a change of the core’s issues goes to onError, as for any event', () => {
    const onError = vi.fn();
    const failure = new Error('listener');
    const other = vi.fn();
    const { gantt } = chart({ onError });
    gantt.on('issues', () => {
      throw failure;
    });
    gantt.on('issues', other);

    expect(() =>
      gantt.setOptions({ scheduling: { propagation: 'sideways' as never } }),
    ).not.toThrow();

    expect(other).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      error: failure,
      source: 'listener',
      name: 'issues',
    });
  });

  it('FR-EVT-1: one that throws on a change of the renderer’s issues alone is rethrown after the others ran', () => {
    const failure = new Error('listener');
    const other = vi.fn();
    const { gantt } = chart();
    gantt.on('issues', () => {
      throw failure;
    });
    gantt.on('issues', other);

    expect(() => gantt.setOptions({ theme: 'sepia' as never })).toThrow(failure);

    expect(other).toHaveBeenCalledTimes(1);
    // The options were applied, and the news is not sent twice.
    expect(paths(gantt.getIssues().options)).toEqual(['theme']);
    expect(() => gantt.setOptions({ theme: 'sepia' as never })).not.toThrow();
  });

  it('FR-EVT-1: the renderer’s issues are sent even when a listener of the core throws in the same setOptions', () => {
    const failure = new Error('view mode listener');
    const onIssues = issuesSpy();
    const { gantt } = chart({
      onIssues,
      onViewModeChange: () => {
        throw failure;
      },
    });

    expect(() => gantt.setOptions({ viewMode: 'week', theme: 'sepia' as never })).toThrow(failure);

    expect(gantt.core.getSnapshot().viewMode.id).toBe('week');
    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(paths(onIssues.mock.calls[0]?.[0].issues ?? [])).toEqual(['theme']);
  });

  it('FR-EVT-1: several throwing listeners are rethrown together', () => {
    const { gantt } = chart();
    for (const message of ['one', 'two']) {
      gantt.on('issues', () => {
        throw new Error(message);
      });
    }

    let thrown: unknown;
    try {
      gantt.setOptions({ theme: 'sepia' as never });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toHaveLength(2);
  });
});

describe('createGantt: the fields of a highlight are validated (FR-DATA-4, FR-UI-3)', () => {
  const good = {
    id: 'good',
    dates: ['2026-03-04'],
    range: { start: '2026-03-02', end: '2026-03-03' },
    match: (): boolean => true,
    label: 'Label',
    className: 'extra',
    color: 'red',
  };

  it('FR-DATA-4: a field of the wrong kind is reported at highlights[i].<field> and dropped, the highlight stays', () => {
    const bad = {
      id: 'bad',
      dates: '2026-03-04',
      range: { start: '2026-03-02' },
      match: 'yes',
      label: 5,
      className: 7,
      color: null,
    };
    const given = [good, bad] as never;

    const { gantt, mounted } = chart({ highlights: given });

    expect(paths(gantt.getIssues().options)).toEqual([
      'highlights[1].dates',
      'highlights[1].range',
      'highlights[1].match',
      'highlights[1].label',
      'highlights[1].className',
      'highlights[1].color',
    ]);
    expect(gantt.getIssues().options.every((item) => item.code === 'invalid-option')).toBe(true);
    expect(gantt.getIssues().options[0]).toMatchObject({ value: '2026-03-04' });
    // The renderer gets the highlight without its bad fields; the caller's object is untouched.
    expect(mounted.display.highlightDays).toEqual([good, { id: 'bad' }]);
    expect(bad).toMatchObject({ dates: '2026-03-04', match: 'yes', color: null });
  });

  it('FR-DATA-4: a label may be a string or a function, a range needs both ends, dates an array', () => {
    const label = (): string => 'day';
    const { gantt, mounted } = chart({
      highlights: [
        { id: 'a', label },
        { id: 'b', label: 'text' },
        { id: 'c', range: { start: '2026-03-02', end: '2026-03-03' }, dates: [] },
        { id: 'd', range: { start: '2026-03-02', end: undefined } as never },
        { id: 'e', range: [] as never },
      ],
    });

    expect(paths(gantt.getIssues().options)).toEqual([
      'highlights[3].range',
      'highlights[4].range',
    ]);
    expect(mounted.display.highlightDays.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(mounted.display.highlightDays[3]).toEqual({ id: 'd' });
  });

  it('FR-DATA-4: a list of valid highlights reaches the renderer as it is, with no issue', () => {
    const list = [good, { id: 'other' }];

    const { gantt, mounted } = chart({ highlights: list });

    expect(gantt.getIssues().options).toEqual([]);
    expect(mounted.display.highlightDays).toBe(list);
  });

  it('FR-DATA-4: a repeated id is reported at highlights[i].id and the first highlight keeps it', () => {
    const { gantt, mounted } = chart({
      highlights: [
        { id: 'same', label: 'first' },
        { id: 'other' },
        { id: 'same', label: 'second' },
      ],
    });

    expect(gantt.getIssues().options).toMatchObject([
      { code: 'invalid-option', path: 'highlights[2].id', value: 'same' },
    ]);
    expect(mounted.display.highlightDays).toEqual([
      { id: 'same', label: 'first' },
      { id: 'other' },
    ]);
  });

  it('FR-DATA-4: setOptions checks the same way, and fixing the list clears the issues', () => {
    const { gantt, mounted } = chart();

    gantt.setOptions({ highlights: [{ id: 'x', match: 1 as never }] });
    expect(paths(gantt.getIssues().options)).toEqual(['highlights[0].match']);
    expect(mounted.display.highlightDays).toEqual([{ id: 'x' }]);
    gantt.setOptions({ highlights: [{ id: 'x', match: () => true }] });
    expect(gantt.getIssues().options).toEqual([]);
  });

  it('FR-DATA-4: an item that is no object or has no id is still reported as a whole and dropped', () => {
    const { gantt, mounted } = chart({
      highlights: [null, { id: 1 }, { id: 'good', dates: 5 }, 'x'] as never,
    });

    expect(paths(gantt.getIssues().options)).toEqual([
      'highlights[0]',
      'highlights[1]',
      'highlights[2].dates',
      'highlights[3]',
    ]);
    expect(mounted.display.highlightDays).toEqual([{ id: 'good' }]);
  });
});

describe('createGantt: onIssues is validated (FR-DATA-4, FR-EVT-1)', () => {
  it('FR-DATA-4: a value that is no function is an invalid-option and no handler; nothing throws', () => {
    for (const bad of ['handler', 5, {}, null, true]) {
      const { gantt } = chart({ onIssues: bad as never });

      expect(gantt.getIssues().options).toMatchObject([
        { code: 'invalid-option', path: 'onIssues', value: bad },
      ]);
      // The next change of the issues reaches no handler and breaks nothing.
      expect(() => gantt.setOptions({ theme: 'sepia' as never })).not.toThrow();
    }
  });

  it('FR-DATA-4: a function or undefined is fine, and setOptions reports a bad one and drops the handler', () => {
    const first = issuesSpy();
    const { gantt } = chart({ onIssues: first });
    expect(gantt.getIssues().options).toEqual([]);

    gantt.setOptions({ onIssues: 'x' as never });
    expect(paths(gantt.getIssues().options)).toEqual(['onIssues']);
    first.mockClear();
    gantt.setOptions({ theme: 'sepia' as never });
    expect(first).not.toHaveBeenCalled();

    const second = issuesSpy();
    gantt.setOptions({ onIssues: second });
    expect(gantt.getIssues().options.map((item) => item.path)).toEqual(['theme']);
    gantt.setOptions({ onIssues: undefined });
    expect(gantt.getIssues().options.map((item) => item.path)).toEqual(['theme']);
  });
});

describe('createGantt: options of a later release are reported (FR-DATA-4)', () => {
  it('FR-DATA-4: display.stickyBarLabels and display.expectedProgress are unsupported-option when true', () => {
    const { gantt } = chart({ display: { stickyBarLabels: true, expectedProgress: true } });

    expect(gantt.getIssues().options.map((item) => [item.code, item.path, item.value])).toEqual([
      ['unsupported-option', 'display.stickyBarLabels', true],
      ['unsupported-option', 'display.expectedProgress', true],
    ]);
  });

  it('FR-DATA-4: false and undefined are fine, and a value of the wrong kind is still invalid', () => {
    expect(
      chart({ display: { stickyBarLabels: false, expectedProgress: undefined } }).gantt.getIssues()
        .options,
    ).toEqual([]);
    const { gantt } = chart({ display: { stickyBarLabels: 'yes' as never } });
    expect(gantt.getIssues().options.map((item) => [item.code, item.path])).toEqual([
      ['invalid-option', 'display.stickyBarLabels'],
    ]);
    gantt.setOptions({ display: { expectedProgress: true } });
    expect(gantt.getIssues().options.map((item) => [item.code, item.path])).toEqual([
      ['unsupported-option', 'display.expectedProgress'],
    ]);
  });
});
