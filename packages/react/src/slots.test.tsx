import type { PointerInput, Task, TaskId, TaskTooltipContext } from '@ganttlane/dom';
import type { ReactElement, ReactNode } from 'react';
import * as React from 'react';
import {
  act,
  createContext,
  createRef,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import type { ListenerTracker, ManualFrames } from './testing';
import {
  cleanUpDocument,
  createManualFrames,
  renderInto,
  stubScrollerSize,
  trackListeners,
} from './testing';
import { charts, forgetCharts } from './testing/charts';
import { collect, Harness } from './testing/harness';
import type { GanttHandle, GanttProps, GanttReactOptions, GanttSlotProps } from './types';

vi.mock('@ganttlane/dom/facade', async (importOriginal) => {
  const { wrapFacade } = await import('./testing/charts');
  return wrapFacade(await importOriginal());
});

// 2026-03-02 is a Monday; the day mode draws 40 px per day, and the chart is 800 px wide.
const TASKS: readonly Task[] = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
const LINKS = [{ source: 'a', target: 'b' }];
const NOW = (): string => '2026-03-04';

let tracker: ListenerTracker;
let frames: ManualFrames;

beforeEach(() => {
  frames = createManualFrames();
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
  forgetCharts();
  live.clear();
  log.length = 0;
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

// ---- what the slot content is and does ----

/** The probes alive now, by label: what is mounted in a portal and not yet unmounted. */
const live = new Map<string, number>();
/** Mounts and unmounts, in order. */
const log: string[] = [];

/** The theme of the application: a context that the slot content must see. */
const Theme = createContext('light');

/**
 * Slot content that says when it mounts and unmounts, what context it sees, and has a state of its
 * own (a counter) that must survive the chart making its tooltip again.
 */
function Probe({ label, text = label }: { label: string; text?: string }): ReactElement {
  const theme = useContext(Theme);
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    live.set(label, (live.get(label) ?? 0) + 1);
    log.push(`mount ${label}`);
    return () => {
      live.set(label, (live.get(label) ?? 1) - 1);
      if (live.get(label) === 0) live.delete(label);
      log.push(`unmount ${label}`);
    };
  }, [label]);
  return (
    <button
      type="button"
      data-probe={label}
      onClick={() => {
        setClicks((count) => count + 1);
      }}
    >
      {text}|{theme}|{clicks}
    </button>
  );
}

const liveLabels = (): string[] => [...live.keys()].sort();

/** The hosts of a kind of slot that are in the page now. */
const hostsOf = (kind: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`[data-slot="${kind}"]`),
];
const popover = (): HTMLElement | null => document.querySelector<HTMLElement>('.gantt__popover');
const probe = (label: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-probe="${label}"]`);

/** A button outside the chart that changes the state of the parent: what the test clicks. */
function Bump({ onClick }: { readonly onClick: () => void }): ReactElement {
  return <button type="button" data-testid="bump" onClick={onClick} />;
}
const bumper = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-testid="bump"]');

// ---- driving the chart (through the core, as the dom tests do) ----

/**
 * A ref the tests read and write. Written out: `RefObject<T>` is read-only in `@types/react@18`
 * and `RefObject<T | null>` in 19, and this is a `Ref<GanttHandle>` in both.
 */
interface Handle {
  current: GanttHandle | null;
}

const barOf = (handle: Handle, id: TaskId): { x: number; y: number } => {
  const bar = handle.current!.getBarRect(id)!;
  return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
};

const pointer = (
  type: PointerInput['type'],
  at: { x: number; y: number },
  target?: PointerInput['target'],
): PointerInput => ({ type, pointerId: 1, ...at, time: 0, ...(target && { target }) });

/** The pointer moves onto a bar (hover), and the chart draws its next frame. */
async function hover(handle: Handle, id: TaskId): Promise<void> {
  await act(async () => {
    handle.current!.core.send(
      pointer('move', barOf(handle, id), { kind: 'task', id, part: 'body' }),
    );
    frames.step();
    await Promise.resolve();
  });
}

/** The pointer moves to where nothing is. */
async function leave(handle: Handle): Promise<void> {
  await act(async () => {
    handle.current!.core.send(pointer('move', { x: 1, y: 1 }, { kind: 'empty' }));
    frames.step();
    await Promise.resolve();
  });
}

/** A click on a bar: press and release in one place. */
async function clickBar(handle: Handle, id: TaskId): Promise<void> {
  await act(async () => {
    const at = barOf(handle, id);
    const target = { kind: 'task', id, part: 'body' } as const;
    handle.current!.core.send(pointer('down', at, target));
    handle.current!.core.send(pointer('up', at, target));
    frames.step();
    await Promise.resolve();
  });
}

/** A click on a link. */
async function clickLink(handle: Handle, id: string): Promise<void> {
  await act(async () => {
    const target = { kind: 'link', id } as const;
    handle.current!.core.send(pointer('down', { x: 0, y: 0 }, target));
    handle.current!.core.send(pointer('up', { x: 0, y: 0 }, target));
    frames.step();
    await Promise.resolve();
  });
}

/** Runs the chart's next frame and the microtasks after it (the labels' portals are one). */
async function frame(): Promise<void> {
  await act(async () => {
    frames.step();
    await Promise.resolve();
  });
}

const click = async (element: Element): Promise<void> => {
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
};

/** Options for `useGantt` (a `Harness`): the chart of the tests, with labels of React by default. */
function options_(extra: Partial<GanttReactOptions> = {}): GanttReactOptions {
  return {
    defaultTasks: TASKS,
    defaultLinks: LINKS,
    now: NOW,
    renderer: { frames },
    display: { barLabel: 'inside' },
    renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
    ...extra,
  };
}

function chart(extra: Partial<GanttProps> = {}, handle: Handle = createRef()): ReactElement {
  return (
    <Gantt
      ref={handle}
      defaultTasks={TASKS}
      defaultLinks={LINKS}
      now={NOW}
      renderer={{ frames }}
      {...extra}
    />
  );
}

describe('renderTooltip (FR-REACT-4, FR-TIP-1)', () => {
  it('FR-REACT-4: draws the ReactNode inside the tooltip, which is the vanilla popover with a host in it', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { delay: 0 },
          renderTooltip: ({ task }) => <Probe label={`tip ${String(task.id)}`} text={task.name} />,
        },
        handle,
      ),
    );
    expect(popover()).toBeNull();

    await hover(handle, 'a');

    const tip = popover()!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.getAttribute('data-kind')).toBe('task');
    expect(tip.parentElement?.classList.contains('gantt__layer')).toBe(true);
    const hosts = hostsOf('tooltip');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.parentElement).toBe(tip);
    expect(probe('tip a')?.textContent).toBe('A|light|0');
    expect(liveLabels()).toEqual(['tip a']);
    await view.unmount();
  });

  it('FR-REACT-4: a state change in the parent draws the tooltip again, without making the popover again', async () => {
    const handle: Handle = createRef();
    function Parent(): ReactElement {
      const [count, setCount] = useState(0);
      return (
        <>
          <Bump onClick={() => setCount((value) => value + 1)} />
          {chart(
            {
              tooltip: { trigger: 'click' },
              renderTooltip: ({ task }) => (
                <Probe label="tip" text={`${task.name} ${String(count)}`} />
              ),
            },
            handle,
          )}
        </>
      );
    }
    const view = await renderInto(<Parent />);
    await clickBar(handle, 'a');
    const tip = popover()!;
    const host = hostsOf('tooltip')[0];
    expect(probe('tip')?.textContent).toBe('A 0|light|0');
    const chartSpy = charts[0]!;

    await click(bumper()!);

    expect(probe('tip')?.textContent).toBe('A 1|light|0');
    // The popover, its host and the probe are the ones that were: nothing was made again.
    expect(popover()).toBe(tip);
    expect(hostsOf('tooltip')[0]).toBe(host);
    expect(log).toEqual(['mount tip']);
    expect(chartSpy.setOptions).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-4: the tooltip is made again from new inputs in place, and the state inside it survives', async () => {
    const handle: Handle = createRef();
    let tasks: readonly Task[] = TASKS;
    function Parent({ rows }: { rows: readonly Task[] }): ReactElement {
      return chart(
        {
          defaultTasks: undefined,
          tasks: rows,
          tooltip: { trigger: 'click' },
          renderTooltip: ({ task }) => <Probe label="tip" text={task.name} />,
        },
        handle,
      );
    }
    const view = await renderInto(<Parent rows={tasks} />);
    await clickBar(handle, 'a');
    const tip = popover()!;
    await click(probe('tip')!);
    await click(probe('tip')!);
    expect(probe('tip')?.textContent).toBe('A|light|2');

    tasks = [{ ...TASKS[0]!, name: 'A v2' }, TASKS[1]!];
    await view.render(<Parent rows={tasks} />);
    await frame();

    // New record, new content, the same popover, the same host, the same component: its counter.
    expect(popover()).toBe(tip);
    expect(probe('tip')?.textContent).toBe('A v2|light|2');
    expect(log).toEqual(['mount tip']);
    expect(hostsOf('tooltip')).toHaveLength(1);
    await view.unmount();
  });

  it('FR-REACT-4, FR-EDIT-8: while a bar is dragged the tooltip is drawn again with the previewed values, in the same host', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { delay: 0 },
          renderTooltip: ({ isDragging, preview }) => (
            <Probe
              label="tip"
              text={
                isDragging ? `drag ${preview?.start.toISOString().slice(0, 10) ?? '?'}` : 'still'
              }
            />
          ),
        },
        handle,
      ),
    );
    await hover(handle, 'a');
    expect(probe('tip')?.textContent).toBe('still|light|0');
    const host = hostsOf('tooltip')[0];
    const at = barOf(handle, 'a');
    const target = { kind: 'task', id: 'a', part: 'body' } as const;

    for (const dx of [60, 120, 200]) {
      await act(async () => {
        if (dx === 60) handle.current!.core.send(pointer('down', at, target));
        handle.current!.core.send(pointer('move', { x: at.x + dx, y: at.y }));
        frames.step();
        await Promise.resolve();
      });
    }

    expect(probe('tip')?.textContent).toMatch(/^drag 2026-03-\d\d\|light\|0$/);
    // Several previews, one host, one mount.
    expect(hostsOf('tooltip')).toEqual([host]);
    expect(log).toEqual(['mount tip']);
    await view.unmount();
  });

  it('FR-REACT-4: leaving the bar unmounts the content, and another bar gets a content of its own', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { delay: 0 },
          renderTooltip: ({ task }) => <Probe label={`tip ${String(task.id)}`} />,
        },
        handle,
      ),
    );
    await hover(handle, 'a');
    expect(liveLabels()).toEqual(['tip a']);

    await hover(handle, 'b');
    expect(liveLabels()).toEqual(['tip b']);
    // The new content is drawn when its popover is in the page, which is after the old one went.
    expect(log).toEqual(['mount tip a', 'unmount tip a', 'mount tip b']);
    expect(hostsOf('tooltip')).toHaveLength(1);

    await leave(handle);
    expect(popover()).toBeNull();
    expect(liveLabels()).toEqual([]);
    expect(hostsOf('tooltip')).toHaveLength(0);
    await view.unmount();
  });

  it('FR-REACT-4: it is called with the context of the vanilla function, and context.api works from it', async () => {
    const handle: Handle = createRef();
    const seen: unknown[] = [];
    const view = await renderInto(
      chart(
        {
          tooltip: { delay: 0 },
          renderTooltip: (context) => {
            seen.push(context);
            return (
              <button
                type="button"
                data-probe="close"
                onClick={() => {
                  context.api.hide();
                }}
              >
                close
              </button>
            );
          },
        },
        handle,
      ),
    );

    await hover(handle, 'a');

    const context = seen.at(-1) as {
      task: { id: string };
      isDragging: boolean;
      locale: string;
      successors: { target: string }[];
    };
    expect(context.task.id).toBe('a');
    expect(context.isDragging).toBe(false);
    expect(context.locale).toBe('en');
    expect(context.successors.map((link) => link.target)).toEqual(['b']);
    expect(popover()).not.toBeNull();

    // A hover tooltip is for reading: it does not take pointer events.
    expect(popover()!.hasAttribute('data-interactive')).toBe(false);
    await act(async () => {
      probe('close')!.click();
      await Promise.resolve();
    });
    expect(popover()).toBeNull();
    expect(liveLabels()).toEqual([]);
    await view.unmount();
  });

  it('FR-REACT-4: a click tooltip takes pointer events, so what is in it can be used', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { trigger: 'click' },
          renderTooltip: () => <Probe label="tip" />,
        },
        handle,
      ),
    );

    await clickBar(handle, 'a');
    expect(popover()!.hasAttribute('data-interactive')).toBe(true);
    await click(probe('tip')!);
    await click(probe('tip')!);
    await click(probe('tip')!);

    expect(probe('tip')?.textContent).toBe('tip|light|3');
    expect(popover()).not.toBeNull();
    await view.unmount();
  });

  it('FR-TIP-3: content that draws nothing shows no tooltip: null, false, an empty string, whitespace', async () => {
    const handle: Handle = createRef();
    let content: ReactNode = null;
    const view = await renderInto(
      chart(
        {
          tooltip: { delay: 0 },
          renderTooltip: () => content,
        },
        handle,
      ),
    );

    for (const blank of [null, undefined, false, '', '   ']) {
      content = blank;
      await view.render(chart({ tooltip: { delay: 0 }, renderTooltip: () => blank }, handle));
      await hover(handle, 'a');
      expect(popover(), JSON.stringify(blank)).toBeNull();
      await leave(handle);
    }
    expect(hostsOf('tooltip')).toHaveLength(0);
    expect(liveLabels()).toEqual([]);
    await view.unmount();
  });

  it('FR-TIP-3: a tooltip whose content becomes blank while it is open closes', async () => {
    const handle: Handle = createRef();
    function Parent(): ReactElement {
      const [shown, setShown] = useState(true);
      return (
        <>
          <Bump onClick={() => setShown(false)} />
          {chart(
            {
              tooltip: { trigger: 'click' },
              renderTooltip: () => (shown ? <Probe label="tip" /> : null),
            },
            handle,
          )}
        </>
      );
    }
    const view = await renderInto(<Parent />);
    await clickBar(handle, 'a');
    expect(popover()).not.toBeNull();

    await click(bumper()!);

    expect(popover()).toBeNull();
    expect(liveLabels()).toEqual([]);
    expect(hostsOf('tooltip')).toHaveLength(0);
    await view.unmount();
  });

  it('FR-REACT-4: taking the slot away gives the chart its own tooltip back and unmounts the content', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart({ tooltip: { trigger: 'click' }, renderTooltip: () => <Probe label="tip" /> }, handle),
    );
    await clickBar(handle, 'a');
    expect(liveLabels()).toEqual(['tip']);

    await view.render(chart({ tooltip: { trigger: 'click' } }, handle));
    await frame();

    expect(liveLabels()).toEqual([]);
    expect(hostsOf('tooltip')).toHaveLength(0);
    // The chart's own tooltip, with the task's name, is what is open.
    expect(popover()?.querySelector('.gantt__popover-title')?.textContent).toBe('A');
    await view.unmount();
  });

  it('FR-REACT-4: the slot is used in place of tooltip.render, with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handle: Handle = createRef();
    const vanilla = vi.fn(() => 'vanilla');
    const view = await renderInto(
      chart(
        {
          tooltip: { delay: 0, render: vanilla },
          renderTooltip: () => <Probe label="tip" />,
        },
        handle,
      ),
    );
    await view.render(
      chart(
        {
          tooltip: { delay: 0, render: vanilla },
          renderTooltip: () => <Probe label="tip" />,
        },
        handle,
      ),
    );

    await hover(handle, 'a');

    expect(vanilla).not.toHaveBeenCalled();
    expect(liveLabels()).toEqual(['tip']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('renderTooltip');
    await view.unmount();
  });
});

describe('renderLinkMenu (FR-REACT-4, FR-TIP-4)', () => {
  const linkId = (handle: Handle): string =>
    handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id;

  it('FR-REACT-4: draws the ReactNode in the menu a click on a link opens, and its buttons work', async () => {
    const handle: Handle = createRef();
    const onLinkDelete = vi.fn();
    const view = await renderInto(
      chart(
        {
          onLinkDelete,
          renderLinkMenu: (context) => (
            <div data-probe="menu">
              <span>
                {String(context.source?.name)} to {String(context.target?.name)}
              </span>
              <button
                type="button"
                data-probe="remove"
                disabled={!context.canRemove}
                onClick={() => {
                  context.remove();
                }}
              >
                Remove
              </button>
            </div>
          ),
        },
        handle,
      ),
    );

    await clickLink(handle, linkId(handle));

    const menu = popover()!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('data-kind')).toBe('link');
    expect(menu.hasAttribute('data-interactive')).toBe(true);
    expect(probe('menu')?.querySelector('span')?.textContent).toBe('A to B');
    // The menu moved the focus to its first button, which React drew before it opened.
    expect(document.activeElement).toBe(probe('remove'));
    expect(hostsOf('linkMenu')).toHaveLength(1);

    await click(probe('remove')!);

    expect(popover()).toBeNull();
    expect(hostsOf('linkMenu')).toHaveLength(0);
    expect(onLinkDelete).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('FR-REACT-4: Escape and a press outside close it and unmount the content', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(chart({ renderLinkMenu: () => <Probe label="menu" /> }, handle));

    await clickLink(handle, linkId(handle));
    expect(liveLabels()).toEqual(['menu']);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    expect(popover()).toBeNull();
    expect(liveLabels()).toEqual([]);

    await clickLink(handle, linkId(handle));
    expect(liveLabels()).toEqual(['menu']);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(popover()).toBeNull();
    expect(liveLabels()).toEqual([]);
    expect(hostsOf('linkMenu')).toHaveLength(0);
    await view.unmount();
  });

  it('FR-REACT-4: content that draws nothing shows no menu', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(chart({ renderLinkMenu: () => null }, handle));

    await clickLink(handle, linkId(handle));

    expect(popover()).toBeNull();
    expect(hostsOf('linkMenu')).toHaveLength(0);
    await view.unmount();
  });
});

describe('renderBarLabel (FR-REACT-4, FR-BAR-5)', () => {
  it('FR-REACT-4: draws the ReactNode in the label of every bar, in a foreignObject the size of the bar', async () => {
    const view = await renderInto(
      chart({
        display: { barLabel: 'inside' },
        renderBarLabel: ({ id, name }) => <Probe label={`label ${String(id)}`} text={name} />,
      }),
    );
    await frame();

    expect(liveLabels()).toEqual(['label a', 'label b']);
    const wrapper = view.container.querySelector(
      '[data-task-id="a"] .gantt__bar-label > .gantt__bar-label-content',
    )!;
    expect(wrapper.firstElementChild).toBe(hostsOf('barLabel')[0]);
    expect(wrapper.textContent).toBe('A|light|0');
    expect(view.container.querySelector('[data-task-id="a"] foreignObject')).not.toBeNull();
    // The chart's own text label is not there.
    expect(view.container.querySelector('[data-task-id="a"] text.gantt__bar-label')).toBeNull();
    await view.unmount();
  });

  it('FR-REACT-4: a state change in the parent draws the labels again, and the bars are not touched', async () => {
    function Parent(): ReactElement {
      const [count, setCount] = useState(0);
      return (
        <>
          <Bump onClick={() => setCount((value) => value + 1)} />
          {chart({
            display: { barLabel: 'inside' },
            renderBarLabel: ({ name }) => (
              <Probe label={`label ${name}`} text={`${name} ${String(count)}`} />
            ),
          })}
        </>
      );
    }
    const view = await renderInto(<Parent />);
    await frame();
    const bars = [...view.container.querySelectorAll('.gantt__bar')];
    const spy = charts[0]!;
    expect(probe('label A')?.textContent).toBe('A 0|light|0');

    await click(bumper()!);

    expect(probe('label A')?.textContent).toBe('A 1|light|0');
    expect(probe('label B')?.textContent).toBe('B 1|light|0');
    expect([...view.container.querySelectorAll('.gantt__bar')]).toEqual(bars);
    view.container.querySelectorAll('.gantt__bar').forEach((bar, i) => {
      expect(bar).toBe(bars[i]);
    });
    expect(spy.setOptions).not.toHaveBeenCalled();
    expect(log).toEqual(['mount label A', 'mount label B']);
    await view.unmount();
  });

  it('FR-REACT-4: a progress drag draws the label again for the same task, in the same host', async () => {
    const handle: Handle = createRef();
    const seen: number[] = [];
    const view = await renderInto(
      chart(
        {
          display: { barLabel: 'inside' },
          renderBarLabel: ({ id, progress }) => {
            seen.push(progress);
            return (
              <Probe label={`label ${String(id)}`} text={`${String(Math.round(progress))}%`} />
            );
          },
        },
        handle,
      ),
    );
    await frame();
    const host = hostsOf('barLabel').find((node) => node.querySelector('[data-probe="label a"]'));
    expect(probe('label a')?.textContent).toBe('10%|light|0');
    const bar = handle.current!.getBarRect('a')!;
    const y = bar.y + bar.height;
    const x = bar.x + bar.progressWidth;

    await act(async () => {
      handle.current!.core.send(
        pointer('down', { x, y }, { kind: 'task', id: 'a', part: 'progress' }),
      );
      handle.current!.core.send(pointer('move', { x: x + 100, y }));
      frames.step();
      await Promise.resolve();
    });

    expect(Math.max(...seen)).toBeGreaterThan(10);
    expect(probe('label a')?.textContent).not.toBe('10%|light|0');
    // The label is the same host, the same component, and was not mounted again.
    expect(hostsOf('barLabel').find((node) => node.querySelector('[data-probe="label a"]'))).toBe(
      host,
    );
    expect(log.filter((entry) => entry === 'mount label a')).toHaveLength(1);
    await view.unmount();
  });

  it('FR-REACT-4: the content of a bar that leaves the window is unmounted, and is mounted again when it comes back', async () => {
    const handle: Handle = createRef();
    const tasks: Task[] = [
      { id: 'early', name: 'Early', start: '2026-03-02', end: '2026-03-13' },
      { id: 'late', name: 'Late', start: '2026-08-03', end: '2026-08-14' },
    ];
    const view = await renderInto(
      chart(
        {
          defaultTasks: tasks,
          defaultLinks: undefined,
          scroll: { initial: 'start' },
          display: { barLabel: 'inside' },
          renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
        },
        handle,
      ),
    );
    await frame();
    expect(liveLabels()).toEqual(['label early']);

    await act(async () => {
      const late = handle.current!.getBarRect('late')!;
      handle.current!.core.scroll({ left: late.x - 100, top: 0 });
      frames.step();
      await Promise.resolve();
    });
    expect(liveLabels()).toEqual(['label late']);

    await act(async () => {
      handle.current!.core.scroll({ left: 0, top: 0 });
      frames.step();
      await Promise.resolve();
    });
    expect(liveLabels()).toEqual(['label early']);
    expect(log).toEqual([
      'mount label early',
      'unmount label early',
      'mount label late',
      'unmount label late',
      'mount label early',
    ]);
    expect(hostsOf('barLabel')).toHaveLength(1);
    await view.unmount();
  });

  it('FR-REACT-4: hiding the labels unmounts the content, and showing them mounts it again', async () => {
    const view = await renderInto(
      chart({
        display: { barLabel: 'inside' },
        renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
      }),
    );
    await frame();
    expect(liveLabels()).toEqual(['label a', 'label b']);

    await view.render(
      chart({
        display: { barLabel: 'none' },
        renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
      }),
    );
    await frame();
    expect(liveLabels()).toEqual([]);

    await view.render(
      chart({
        display: { barLabel: 'inside' },
        renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
      }),
    );
    await frame();
    expect(liveLabels()).toEqual(['label a', 'label b']);
    await view.unmount();
  });

  it('FR-REACT-4: the other fields of display are kept, and taking the slot away gives the text labels back', async () => {
    const view = await renderInto(
      chart({
        display: { barLabel: 'inside', gridLines: 'none' },
        renderBarLabel: () => <Probe label="label" />,
      }),
    );
    await frame();
    expect(view.container.querySelector('.gantt__gridline')).toBeNull();

    await view.render(chart({ display: { barLabel: 'inside', gridLines: 'none' } }));
    await frame();

    expect(liveLabels()).toEqual([]);
    expect(
      view.container.querySelector('[data-task-id="a"] text.gantt__bar-label')?.textContent,
    ).toBe('A');
    expect(view.container.querySelector('.gantt__gridline')).toBeNull();
    await view.unmount();
  });
});

describe('slots and the vanilla functions (FR-REACT-4)', () => {
  it('FR-REACT-4: a slot wins over the vanilla function of its group, with one warning each, and keeps the group’s other fields', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handle: Handle = createRef();
    const renderLinkMenu = vi.fn(() => 'vanilla menu');
    const renderBarLabel = vi.fn(() => 'vanilla label');
    const make = (): ReactElement =>
      chart(
        {
          linkMenu: { render: renderLinkMenu },
          display: { barLabel: 'inside', renderBarLabel, gridLines: 'none' },
          renderLinkMenu: () => <Probe label="menu" />,
          renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
        },
        handle,
      );
    const view = await renderInto(make());
    await view.render(make());
    await frame();

    const id = handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id;
    await clickLink(handle, id);

    expect(renderLinkMenu).not.toHaveBeenCalled();
    expect(renderBarLabel).not.toHaveBeenCalled();
    expect(liveLabels()).toEqual(['label a', 'label b', 'menu']);
    // `gridLines` is a field of the same group `display`: it is still set.
    expect(view.container.querySelector('.gantt__gridline')).toBeNull();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages).toHaveLength(2);
    expect(messages.some((text) => text.includes('renderLinkMenu'))).toBe(true);
    expect(messages.some((text) => text.includes('renderBarLabel'))).toBe(true);
    await view.unmount();
  });

  it('FR-REACT-4: the vanilla function is used again when the slot is taken away', async () => {
    const handle: Handle = createRef();
    const renderBarLabel = vi.fn(({ name }: { name: string }) => `vanilla ${name}`);
    const view = await renderInto(
      chart(
        {
          display: { barLabel: 'inside', renderBarLabel },
          renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
        },
        handle,
      ),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await frame();
    expect(liveLabels()).toEqual(['label a', 'label b']);

    await view.render(chart({ display: { barLabel: 'inside', renderBarLabel } }, handle));
    await frame();

    expect(liveLabels()).toEqual([]);
    expect(
      view.container.querySelector('[data-task-id="a"] text.gantt__bar-label')?.textContent,
    ).toBe('vanilla A');
    await view.unmount();
  });
});

describe('slots in a hidden <Activity> (FR-REACT-4, FR-REACT-5)', () => {
  const Activity = (
    React as unknown as {
      Activity?: (props: { mode: 'visible' | 'hidden'; children: ReactNode }) => ReactElement;
    }
  ).Activity;

  it.skipIf(Activity === undefined)(
    'FR-REACT-5: hiding unmounts the portals with the chart, and showing makes new ones',
    async () => {
      const Wrapper = Activity!;
      const make = (mode: 'visible' | 'hidden'): ReactElement => (
        <Wrapper mode={mode}>
          <Harness options={options_()} />
        </Wrapper>
      );
      const view = await renderInto(make('visible'));
      await frame();
      expect(liveLabels()).toEqual(['label a', 'label b']);

      await view.render(make('hidden'));
      await frame();
      expect(liveLabels()).toEqual([]);
      expect(hostsOf('barLabel')).toHaveLength(0);

      await view.render(make('visible'));
      await frame();
      await frame();
      expect(liveLabels()).toEqual(['label a', 'label b']);
      expect([...live.values()]).toEqual([1, 1]);
      await view.unmount();
      expect(liveLabels()).toEqual([]);
    },
  );
});

describe('slots are typed from the data (FR-API-6)', () => {
  it('FR-API-6: TData flows into the context of every slot', () => {
    interface Row {
      readonly team: string;
    }
    const rows: readonly Task<Row>[] = [
      { id: 1, name: 'x', start: '2026-03-02', end: '2026-03-03', data: { team: 'a' } },
    ];

    // A JSX expression, checked by the compiler: the task's `data` is a `Row` in the three slots.
    const element = (
      <Gantt
        defaultTasks={rows}
        renderTooltip={(context) => {
          expectTypeOf(context.task.task.data).toEqualTypeOf<Row | undefined>();
          return null;
        }}
        renderLinkMenu={(context) => {
          expectTypeOf(context.source?.task.data).toEqualTypeOf<Row | undefined>();
          return null;
        }}
        renderBarLabel={(context) => {
          expectTypeOf(context.task.data).toEqualTypeOf<Row | undefined>();
          return null;
        }}
      />
    );
    expect(element).toBeDefined();
    expectTypeOf<GanttSlotProps['renderTooltip']>().toEqualTypeOf<
      ((context: TaskTooltipContext) => ReactNode) | undefined
    >();
  });
});

describe('what slot content sees (FR-REACT-4)', () => {
  it('FR-REACT-4: content in a tooltip, a menu and a label sees the context providers above <Gantt>', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      <Theme.Provider value="midnight">
        {chart(
          {
            tooltip: { trigger: 'click' },
            display: { barLabel: 'inside' },
            renderTooltip: () => <Probe label="tip" />,
            renderLinkMenu: () => <Probe label="menu" />,
            renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
          },
          handle,
        )}
      </Theme.Provider>,
    );
    await frame();
    expect(probe('label a')?.textContent).toBe('label a|midnight|0');

    await clickBar(handle, 'a');
    expect(probe('tip')?.textContent).toBe('tip|midnight|0');

    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);
    expect(probe('menu')?.textContent).toBe('menu|midnight|0');
    await view.unmount();
  });

  it('FR-REACT-4: a change of that context reaches the content, with nothing made again', async () => {
    const handle: Handle = createRef();
    const make = (theme: string): ReactElement => (
      <Theme.Provider value={theme}>
        {chart(
          { tooltip: { trigger: 'click' }, renderTooltip: () => <Probe label="tip" /> },
          handle,
        )}
      </Theme.Provider>
    );
    const view = await renderInto(make('one'));
    await clickBar(handle, 'a');
    expect(probe('tip')?.textContent).toBe('tip|one|0');
    const tip = popover();

    await view.render(make('two'));

    expect(probe('tip')?.textContent).toBe('tip|two|0');
    expect(popover()).toBe(tip);
    expect(log).toEqual(['mount tip']);
    await view.unmount();
  });
});

describe('slots follow the latest function and do not churn the chart (FR-REACT-2, FR-REACT-4)', () => {
  it('FR-REACT-4: a function that is new on every render is no option change, and nothing is made again', async () => {
    const handle: Handle = createRef();
    const render = (): ReactElement =>
      chart(
        {
          tooltip: { trigger: 'click' },
          display: { barLabel: 'inside' },
          renderTooltip: () => <Probe label="tip" />,
          renderLinkMenu: () => <Probe label="menu" />,
          renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
        },
        handle,
      );
    const view = await renderInto(render());
    await frame();
    await clickBar(handle, 'a');
    const spy = charts[0]!;
    const tip = popover();
    const before = [...log];

    for (let i = 0; i < 3; i++) await view.render(render());

    expect(spy.setOptions).not.toHaveBeenCalled();
    expect(popover()).toBe(tip);
    expect(log).toEqual(before);
    await view.unmount();
  });

  it('FR-REACT-4: the latest function is the one that draws, also for a tooltip that is already open', async () => {
    const handle: Handle = createRef();
    const make = (word: string): ReactElement =>
      chart(
        { tooltip: { trigger: 'click' }, renderTooltip: () => <Probe label="tip" text={word} /> },
        handle,
      );
    const view = await renderInto(make('first'));
    await clickBar(handle, 'a');
    expect(probe('tip')?.textContent).toBe('first|light|0');

    await view.render(make('second'));

    expect(probe('tip')?.textContent).toBe('second|light|0');
    expect(log).toEqual(['mount tip']);
    await view.unmount();
  });
});

describe('slots do not leak (FR-REACT-4, FR-REACT-5)', () => {
  it('FR-REACT-5: unmounting the chart unmounts every portal and leaves no host', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { trigger: 'click' },
          display: { barLabel: 'inside' },
          renderTooltip: () => <Probe label="tip" />,
          renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
        },
        handle,
      ),
    );
    await frame();
    await clickBar(handle, 'a');
    expect(liveLabels()).toEqual(['label a', 'label b', 'tip']);

    await view.unmount();

    expect(liveLabels()).toEqual([]);
    expect(hostsOf('tooltip')).toHaveLength(0);
    expect(hostsOf('barLabel')).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FR-REACT-5: under StrictMode there is one portal per tooltip and label, and none is left behind', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { trigger: 'click' },
          display: { barLabel: 'inside' },
          renderTooltip: () => <Probe label="tip" />,
          renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
        },
        handle,
      ),
      { strict: true },
    );
    await frame();
    await clickBar(handle, 'a');

    expect(liveLabels()).toEqual(['label a', 'label b', 'tip']);
    expect([...live.values()]).toEqual([1, 1, 1]);
    expect(hostsOf('barLabel')).toHaveLength(2);
    expect(hostsOf('tooltip')).toHaveLength(1);

    await view.unmount();

    expect(liveLabels()).toEqual([]);
    expect(hostsOf('tooltip')).toHaveLength(0);
    expect(hostsOf('barLabel')).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
  });

  it('FR-REACT-5: a chart that is mounted again (a new key) starts with its own portals and ends the old ones', async () => {
    const make = (key: string): ReactElement => (
      <Fragment key={key}>
        {chart({
          display: { barLabel: 'inside' },
          renderBarLabel: ({ id }) => <Probe label={`label ${String(id)}`} />,
        })}
      </Fragment>
    );
    const view = await renderInto(make('one'));
    await frame();
    expect(live.get('label a')).toBe(1);

    await view.render(make('two'));
    await frame();
    await frame();

    expect(liveLabels()).toEqual(['label a', 'label b']);
    expect([...live.values()]).toEqual([1, 1]);
    expect(hostsOf('barLabel')).toHaveLength(2);
    await view.unmount();
    expect(liveLabels()).toEqual([]);
  });

  it('FR-REACT-5: the renderer being taken out of its container ends its portals, and putting it back makes new ones', async () => {
    const options = options_();
    const view = await renderInto(<Harness options={options} />);
    await frame();
    expect(liveLabels()).toEqual(['label a', 'label b']);

    await view.render(<Harness options={options} container={false} />);
    await frame();
    expect(liveLabels()).toEqual([]);
    expect(hostsOf('barLabel')).toHaveLength(0);

    await view.render(<Harness options={options} />);
    await frame();
    expect(liveLabels()).toEqual(['label a', 'label b']);
    await view.unmount();
  });
});

describe('useGantt and the slots (FR-REACT-4)', () => {
  it('FR-REACT-4: `instance.slots` is the portals, a stable element, and is all the hook needs to draw them', async () => {
    const { seen, capture } = collect();
    const options = options_({
      tooltip: { delay: 0 },
      renderBarLabel: undefined,
      renderTooltip: ({ task }) => <Probe label={`tip ${String(task.id)}`} />,
    });
    const handle: Handle = createRef();
    const view = await renderInto(<Harness options={options} capture={capture} />);
    await view.render(<Harness options={{ ...options }} capture={capture} />);
    handle.current = seen[0] as unknown as GanttHandle;

    await hover(handle, 'a');

    expect(liveLabels()).toEqual(['tip a']);
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen.map((instance) => instance.slots)).size).toBe(1);
    await view.unmount();
  });

  it('FR-REACT-4: slots that nothing draws are reported once, in development', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { seen, capture } = collect();
    const options = options_({
      tooltip: { delay: 0 },
      renderBarLabel: undefined,
      renderTooltip: () => <Probe label="tip" />,
    });
    const handle: Handle = createRef();
    const view = await renderInto(<Harness options={options} capture={capture} slots={false} />);
    handle.current = seen[0] as unknown as GanttHandle;

    await hover(handle, 'a');
    await leave(handle);
    await hover(handle, 'b');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('instance.slots');
    expect(liveLabels()).toEqual([]);
    await view.unmount();
  });
});

// ---- the review of phase 5: focus, nested portals, attachment, emptiness, auto placement ----

/** Types into an input as a user does: through the native setter, then the event React hears. */
async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await frame();
}

/** An input that renames a task: the page owns the tasks, so a keystroke is a new `tasks`. */
function Rename({
  name,
  onRename,
}: {
  readonly name: string;
  readonly onRename: (name: string) => void;
}): ReactElement {
  return (
    <input
      data-probe="rename"
      value={name}
      onChange={(event) => {
        onRename(event.target.value);
      }}
    />
  );
}

describe('slot content with an input keeps the focus while the chart goes on (FR-REACT-4, FR-TIP-1)', () => {
  /** A page whose tasks are `rows` and whose slot content renames them. */
  function renamer(
    handle: Handle,
    slots: (rename: (id: TaskId, name: string) => void) => Partial<GanttProps>,
  ): () => ReactElement {
    return function Page(): ReactElement {
      const [rows, setRows] = useState<readonly Task[]>(TASKS);
      const rename = (id: TaskId, name: string): void => {
        setRows((current) => current.map((row) => (row.id === id ? { ...row, name } : row)));
      };
      return chart({ defaultTasks: undefined, tasks: rows, ...slots(rename) }, handle);
    };
  }

  it('FR-REACT-4: typing in an input of a click tooltip that renames the task: the input and its focus stay through every keystroke', async () => {
    const handle: Handle = createRef();
    const Page = renamer(handle, (rename) => ({
      tooltip: { trigger: 'click' },
      renderTooltip: ({ task }) => (
        <Rename
          name={task.name}
          onRename={(name) => {
            rename(task.id, name);
          }}
        />
      ),
    }));
    const view = await renderInto(<Page />);
    await clickBar(handle, 'a');
    const input = probe('rename') as HTMLInputElement;
    const tip = popover()!;
    const host = hostsOf('tooltip')[0];
    await act(async () => {
      input.focus();
      await Promise.resolve();
    });
    // A browser drops the focus of a node that is taken out of the document, however fast it is
    // put back: nothing may be removed from the popover.
    const removals = new MutationObserver(() => undefined);
    removals.observe(tip, { childList: true, subtree: true });

    for (const text of ['Ax', 'Axy', 'Axyz']) {
      await typeInto(input, text);

      expect(removals.takeRecords(), text).toEqual([]);
      expect(document.activeElement, text).toBe(input);
      expect(probe('rename'), text).toBe(input);
      expect(input.value, text).toBe(text);
      expect(handle.current!.getTask('a')?.name, text).toBe(text);
    }
    // One popover, one host, and nothing was made again on the way.
    expect(popover()).toBe(tip);
    expect(hostsOf('tooltip')).toEqual([host]);
    await view.unmount();
  });

  it('FR-REACT-4: the same for a link menu', async () => {
    const handle: Handle = createRef();
    const Page = renamer(handle, (rename) => ({
      renderLinkMenu: ({ source }) => (
        <Rename
          name={source?.name ?? ''}
          onRename={(name) => {
            rename('a', name);
          }}
        />
      ),
    }));
    const view = await renderInto(<Page />);
    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);
    const input = probe('rename') as HTMLInputElement;
    await act(async () => {
      input.focus();
      await Promise.resolve();
    });
    const removals = new MutationObserver(() => undefined);
    removals.observe(popover()!, { childList: true, subtree: true });

    for (const text of ['Ax', 'Axy']) {
      await typeInto(input, text);

      expect(removals.takeRecords(), text).toEqual([]);
      expect(document.activeElement, text).toBe(input);
      expect(probe('rename'), text).toBe(input);
    }
    await view.unmount();
  });

  it('FR-REACT-4: the same for a bar label', async () => {
    const handle: Handle = createRef();
    const Page = renamer(handle, (rename) => ({
      display: { barLabel: 'inside' },
      renderBarLabel: ({ id, name }) => (
        <Rename
          name={name}
          onRename={(next) => {
            rename(id, next);
          }}
        />
      ),
    }));
    const view = await renderInto(<Page />);
    await frame();
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-probe="rename"]');
    const input = inputs[0]!;
    await act(async () => {
      input.focus();
      await Promise.resolve();
    });
    const label = input.closest('.gantt__bar-label-content')!;
    const removals = new MutationObserver(() => undefined);
    removals.observe(label, { childList: true, subtree: true });

    for (const text of ['Ax', 'Axy', 'Axyz']) {
      await typeInto(input, text);

      expect(removals.takeRecords(), text).toEqual([]);
      expect(document.activeElement, text).toBe(input);
      expect(document.querySelectorAll('[data-probe="rename"]')[0], text).toBe(input);
    }
    await view.unmount();
  });
});

/** Slot content that opens a menu in a portal of the page, with a portal in it. */
function NestedMenu({ onNested }: { readonly onNested: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div data-probe="owner">
      <button
        type="button"
        data-probe="open"
        onClick={() => {
          setOpen(true);
        }}
      >
        open
      </button>
      {open &&
        createPortal(
          <div data-probe="portal">
            <button type="button" data-probe="nested" onClick={onNested}>
              nested
            </button>
            {createPortal(
              <button type="button" data-probe="deeper" onClick={onNested}>
                deeper
              </button>,
              document.body,
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

describe('nested portals count as inside (FR-REACT-4, FR-TIP-4)', () => {
  /** A press as the browser makes it: pointerdown on the target, then the click. */
  async function press(target: Element): Promise<void> {
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 3, clientY: 3 }),
      );
      await Promise.resolve();
    });
    await click(target);
  }

  it('FR-REACT-4: a press on a button of a portal in a link menu, and on one in a portal in that portal, is not a press outside', async () => {
    const handle: Handle = createRef();
    const onNested = vi.fn();
    const view = await renderInto(
      chart({ renderLinkMenu: () => <NestedMenu onNested={onNested} /> }, handle),
    );
    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);
    await click(probe('open')!);
    expect(document.body.contains(document.querySelector('[data-probe="nested"]'))).toBe(true);
    // They are outside the popover, in the page.
    expect(popover()!.contains(probe('nested'))).toBe(false);

    await press(probe('nested')!);
    await press(probe('deeper')!);
    await press(document.querySelector('[data-probe="portal"]')!);

    expect(popover()).not.toBeNull();
    // The click landed: the portal was not unmounted by the press.
    expect(onNested).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it('FR-REACT-4: the same in a click tooltip', async () => {
    const handle: Handle = createRef();
    const onNested = vi.fn();
    const view = await renderInto(
      chart(
        { tooltip: { trigger: 'click' }, renderTooltip: () => <NestedMenu onNested={onNested} /> },
        handle,
      ),
    );
    await clickBar(handle, 'a');
    await click(probe('open')!);

    await press(probe('deeper')!);

    expect(popover()).not.toBeNull();
    expect(onNested).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('FR-REACT-4: a press anywhere else still closes the popover, with the portals in it', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart({ renderLinkMenu: () => <NestedMenu onNested={vi.fn()} /> }, handle),
    );
    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);
    await click(probe('open')!);

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });

    expect(popover()).toBeNull();
    expect(document.querySelector('[data-probe="nested"]')).toBeNull();
    await view.unmount();
  });

  it('FR-REACT-4: a portal of another page component, or of the next tooltip, is not owned', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      <>
        {chart({ renderLinkMenu: () => <Probe label="menu" /> }, handle)}
        {createPortal(<button type="button" data-probe="elsewhere" />, document.body)}
      </>,
    );
    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);
    expect(popover()).not.toBeNull();

    await act(async () => {
      probe('elsewhere')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });

    expect(popover()).toBeNull();
    await view.unmount();
  });
});

describe('content that needs the document (FR-REACT-4, FR-TIP-4)', () => {
  it('FR-REACT-4: an input with autoFocus in a link menu is focused when the menu opens', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          renderLinkMenu: () => (
            <>
              <button type="button">first</button>
              {/* eslint-disable-next-line jsx-a11y-x/no-autofocus -- what the test is about */}
              <input data-probe="field" autoFocus />
            </>
          ),
        },
        handle,
      ),
    );

    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);

    expect(document.activeElement).toBe(probe('field'));
    await view.unmount();
  });

  it('FR-REACT-4: an input with autoFocus in a click tooltip is focused', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { trigger: 'click' },
          // eslint-disable-next-line jsx-a11y-x/no-autofocus -- what the test is about
          renderTooltip: () => <input data-probe="field" autoFocus />,
        },
        handle,
      ),
    );

    await clickBar(handle, 'a');

    expect(document.activeElement).toBe(probe('field'));
    await view.unmount();
  });

  /** Content that measures itself in a layout effect, as a placement or a truncation would. */
  function Measured({ seen }: { readonly seen: { connected: boolean; width: number }[] }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const element = ref.current!;
      seen.push({ connected: element.isConnected, width: element.getBoundingClientRect().width });
    }, [seen]);
    return (
      <div ref={ref} data-measure="">
        measured
      </div>
    );
  }

  /** A layout: elements in the document that ask to be measured have a width, the others none. */
  function stubLayout(): void {
    const real = Element.prototype.getBoundingClientRect;
    const box = (width: number, height: number): DOMRect => ({
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (!this.hasAttribute('data-measure')) return real.call(this);
      return this.isConnected ? box(120, 40) : box(0, 0);
    });
  }

  it('FR-REACT-4: a layout effect of a tooltip measures content that is in the document, with a size', async () => {
    stubLayout();
    const handle: Handle = createRef();
    const seen: { connected: boolean; width: number }[] = [];
    const view = await renderInto(
      chart(
        { tooltip: { trigger: 'click' }, renderTooltip: () => <Measured seen={seen} /> },
        handle,
      ),
    );

    await clickBar(handle, 'a');

    expect(seen).toEqual([{ connected: true, width: 120 }]);
    await view.unmount();
  });

  it('FR-REACT-4: and a layout effect of a link menu', async () => {
    stubLayout();
    const handle: Handle = createRef();
    const seen: { connected: boolean; width: number }[] = [];
    const view = await renderInto(
      chart({ renderLinkMenu: () => <Measured seen={seen} /> }, handle),
    );

    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);

    expect(seen).toEqual([{ connected: true, width: 120 }]);
    await view.unmount();
  });
});

describe('content that draws an empty element shows no popover (FR-TIP-3, FR-REACT-4)', () => {
  it.each([
    ['an empty div', () => <div />],
    [
      'nested empty elements',
      () => (
        <div>
          <span />
        </div>
      ),
    ],
    [
      'elements around whitespace',
      () => (
        <p>
          {' '}
          <b>{'\n'}</b>{' '}
        </p>
      ),
    ],
    [
      'a fragment of empty elements',
      () => (
        <>
          <i />
          <u />
        </>
      ),
    ],
  ])('FR-TIP-3: %s', async (_name, content) => {
    const handle: Handle = createRef();
    const view = await renderInto(chart({ tooltip: { delay: 0 }, renderTooltip: content }, handle));

    await hover(handle, 'a');

    expect(popover()).toBeNull();
    expect(hostsOf('tooltip')).toHaveLength(0);
    await view.unmount();
  });

  it('FR-TIP-3: and a menu', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(chart({ renderLinkMenu: () => <div /> }, handle));

    await clickLink(handle, handle.current!.core.getSnapshot().state.derived.graph.links[0]!.id);

    expect(popover()).toBeNull();
    expect(hostsOf('linkMenu')).toHaveLength(0);
    await view.unmount();
  });

  it.each([
    ['an image', () => <img alt="" src="data:," />],
    ['a control', () => <input />],
    ['an svg', () => <svg width="8" height="8" />],
    ['text', () => <span>x</span>],
  ])('FR-TIP-3: %s shows the popover', async (_name, content) => {
    const handle: Handle = createRef();
    const view = await renderInto(chart({ tooltip: { delay: 0 }, renderTooltip: content }, handle));

    await hover(handle, 'a');

    expect(popover()).not.toBeNull();
    await view.unmount();
  });

  it('FR-TIP-3: a tooltip made again from a new record with content that draws nothing closes, with no host and no portal left', async () => {
    const handle: Handle = createRef();
    function Parent(): ReactElement {
      const [rows, setRows] = useState<readonly Task[]>(TASKS);
      return (
        <>
          <Bump
            onClick={() => {
              setRows((current) =>
                current.map((row) => (row.id === 'a' ? { ...row, name: 'gone' } : row)),
              );
            }}
          />
          {chart(
            {
              defaultTasks: undefined,
              tasks: rows,
              tooltip: { trigger: 'click' },
              renderTooltip: ({ task }) =>
                task.name === 'gone' ? <div /> : <Probe label="tip" text={task.name} />,
            },
            handle,
          )}
        </>
      );
    }
    const view = await renderInto(<Parent />);
    await clickBar(handle, 'a');
    expect(popover()).not.toBeNull();

    await click(bumper()!);
    await frame();

    expect(popover()).toBeNull();
    expect(hostsOf('tooltip')).toHaveLength(0);
    expect(liveLabels()).toEqual([]);
    // Nothing is stuck: the next click opens a tooltip.
    await clickBar(handle, 'b');
    expect(probe('tip')?.textContent).toBe('B|light|0');
    await view.unmount();
  });

  it('FR-TIP-3: a tooltip whose content becomes an empty element while it is open closes', async () => {
    const handle: Handle = createRef();
    function Parent(): ReactElement {
      const [shown, setShown] = useState(true);
      return (
        <>
          <Bump onClick={() => setShown(false)} />
          {chart(
            {
              tooltip: { trigger: 'click' },
              renderTooltip: () => (shown ? <Probe label="tip" /> : <div />),
            },
            handle,
          )}
        </>
      );
    }
    const view = await renderInto(<Parent />);
    await clickBar(handle, 'a');
    expect(popover()).not.toBeNull();

    await click(bumper()!);

    expect(popover()).toBeNull();
    expect(hostsOf('tooltip')).toHaveLength(0);
    await view.unmount();
  });
});

describe('the placement of a label that is React (FR-REACT-4, FR-BAR-5)', () => {
  // Two days: a bar of about 80 px, which a name of this length does not fit in.
  const NARROW: readonly Task[] = [
    { id: 'n', name: 'Narrow', start: '2026-03-02', end: '2026-03-04' },
  ];
  const LONG = 'a name that is much too long for the bar it is in, '.repeat(3);
  const placement = (): string | null | undefined =>
    document.querySelector('[data-task-id="n"] .gantt__bar-label')?.getAttribute('data-placement');

  it('FR-BAR-5: auto puts it inside, whatever its text is now or was: the width of a React label is not known', async () => {
    const handle: Handle = createRef();
    function Page({ name }: { readonly name: string }): ReactElement {
      return chart(
        {
          defaultTasks: undefined,
          tasks: [{ ...NARROW[0]!, name }],
          defaultLinks: undefined,
          display: { barLabel: 'auto' },
          // The host holds the text of the draw before when the renderer asks for the next.
          renderBarLabel: ({ name: shown }) => <Probe label="label" text={shown} />,
        },
        handle,
      );
    }
    const view = await renderInto(<Page name={LONG} />);
    await frame();
    expect(placement()).toBe('inside');

    await view.render(<Page name="x" />);
    await frame();
    expect(placement()).toBe('inside');

    await view.render(<Page name={LONG} />);
    await frame();
    expect(placement()).toBe('inside');

    await view.render(<Page name="y" />);
    await frame();
    expect(placement()).toBe('inside');
    await view.unmount();
  });

  it('FR-BAR-5: a text label of the same name is placed by its width, outside (the contrast)', async () => {
    const view = await renderInto(
      chart({
        defaultTasks: [{ ...NARROW[0]!, name: LONG }],
        defaultLinks: undefined,
        display: { barLabel: 'auto' },
      }),
    );
    await frame();

    expect(
      view.container
        .querySelector('[data-task-id="n"] .gantt__bar-label')
        ?.getAttribute('data-placement'),
    ).toBe('outside');
    await view.unmount();
  });
});
