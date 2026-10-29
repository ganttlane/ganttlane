import type { PointerInput, Task, TaskId, TaskTooltipContext } from '@ganttlane/dom';
import type { ReactElement, ReactNode } from 'react';
import { act, createRef, useEffect, useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import type { SlotRender, SlotReport } from './slots';
import { createSlots } from './slots';
import type { ManualFrames } from './testing';
import { cleanUpDocument, createManualFrames, renderInto, stubScrollerSize } from './testing';
import type { GanttHandle, GanttProps } from './types';

/**
 * A slot function that throws, and one that is swapped for another with other hooks (plan step 5.3
 * review, FR-REACT-4). In a file of its own: with React 18 in a DOM environment (happy-dom), an
 * error that React reports while it commits can leave its work loop in a state that fails the
 * `act` calls after it, and these tests make React report errors on purpose.
 */

// 2026-03-02 is a Monday; the day mode draws 40 px per day, and the chart is 800 px wide.
const TASKS: readonly Task[] = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
const NOW = (): string => '2026-03-04';

let frames: ManualFrames;
let reported: ReturnType<typeof vi.fn>;
/** What a chart's `onError` heard (the error only). */
let chartErrors: ReturnType<typeof vi.fn<(error: unknown) => void>>;
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  frames = createManualFrames();
  vi.useFakeTimers();
  stubScrollerSize(800, 400);
  // What React says about an error it caught is not what these tests are about.
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // The channel an error goes to when nobody listens: `reportError`.
  reported = vi.fn();
  chartErrors = vi.fn<(error: unknown) => void>();
  vi.stubGlobal('reportError', reported);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanUpDocument();
});

const popover = (): HTMLElement | null => document.querySelector<HTMLElement>('.gantt__popover');
const probe = (label: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-probe="${label}"]`);
const hostsOf = (kind: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`[data-slot="${kind}"]`),
];

interface Handle {
  current: GanttHandle | null;
}

function chart(extra: Partial<GanttProps> = {}, handle: Handle = createRef()): ReactElement {
  return (
    <Gantt
      ref={handle}
      defaultTasks={TASKS}
      now={NOW}
      renderer={{ frames }}
      display={{ barLabel: 'inside' }}
      onError={(payload: { error: unknown }) => {
        chartErrors(payload.error);
      }}
      {...extra}
    />
  );
}

async function frame(): Promise<void> {
  await act(async () => {
    frames.step();
    await Promise.resolve();
  });
}

const pointer = (
  type: PointerInput['type'],
  at: { x: number; y: number },
  target?: PointerInput['target'],
): PointerInput => ({ type, pointerId: 1, ...at, time: 0, ...(target && { target }) });

/** A click on a bar: press and release in one place. */
async function clickBar(handle: Handle, id: TaskId): Promise<void> {
  await act(async () => {
    const bar = handle.current!.getBarRect(id)!;
    const at = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
    const target = { kind: 'task', id, part: 'body' } as const;
    handle.current!.core.send(pointer('down', at, target));
    handle.current!.core.send(pointer('up', at, target));
    frames.step();
    await Promise.resolve();
  });
}

// ---- the slots by themselves: the contract the controller relies on ----

/** What the renderer gives a tooltip's render function, as far as the slots read it. */
interface FakeContext {
  readonly n: number;
  readonly api: { readonly hide: () => void };
}

describe('a slot function that throws (FR-REACT-4)', () => {
  /** The slots, drawn in a root next to a sentinel that must survive. */
  async function mountSlots(report?: SlotReport) {
    const slots = createSlots(() => document, report);
    const view = await renderInto(
      <>
        <span data-probe="sentinel" />
        {slots.element}
      </>,
    );
    return { slots, view };
  }

  /** Acts as the renderer does for a tooltip: asks for the content, then attaches it. */
  async function open(
    slots: ReturnType<typeof createSlots>,
    id: string,
    context: FakeContext,
  ): Promise<ReturnType<typeof slots.acquire>> {
    let content: ReturnType<typeof slots.acquire>;
    await act(async () => {
      content = slots.acquire('tooltip', id, context);
      content.attached?.();
      await Promise.resolve();
    });
    return content!;
  }

  it('FR-REACT-4: is caught where it happens: the root stays, the error is reported with the kind of slot, and the popover is asked to hide', async () => {
    const report = vi.fn();
    const { slots, view } = await mountSlots(report);
    const boom = new Error('boom');
    slots.update({
      tooltip: () => {
        throw boom;
      },
    });
    const hide = vi.fn();
    const context: FakeContext = { n: 1, api: { hide } };

    const content = await open(slots, 'a', context);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(boom, 'tooltip');
    expect(hide).toHaveBeenCalledTimes(1);
    expect(content.node.textContent).toBe('');
    expect(probe('sentinel')).not.toBeNull();
    await view.unmount();
  });

  it('FR-REACT-4: a label that throws draws nothing and does not report again while nothing changes; the others are drawn', async () => {
    const report = vi.fn();
    const { slots, view } = await mountSlots(report);
    const boom = new Error('label failed');
    slots.update({
      barLabel: (context: { readonly id: string }) => {
        if (context.id === 'a') throw boom;
        return <i>{context.id}</i>;
      },
    } as never);

    let a: ReturnType<typeof slots.acquire> | undefined;
    let b: ReturnType<typeof slots.acquire> | undefined;
    await act(async () => {
      a = slots.acquire('barLabel', 'a', { id: 'a' });
      b = slots.acquire('barLabel', 'b', { id: 'b' });
      await Promise.resolve();
    });

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(boom, 'barLabel');
    expect(b!.node.textContent).toBe('b');
    expect(a!.node.textContent).toBe('');
    expect(probe('sentinel')).not.toBeNull();

    // Another label changes: the failed one is not drawn again for it.
    await act(async () => {
      slots.acquire('barLabel', 'b', { id: 'b', again: true });
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('FR-REACT-4: a slot that failed is drawn again when its function changes, and when its context does', async () => {
    const report = vi.fn();
    const { slots, view } = await mountSlots(report);
    const render = (fail: boolean): SlotRender =>
      ((context: { readonly n: number }) => {
        if (fail) throw new Error(`failed for ${String(context.n)}`);
        return <i>{context.n}</i>;
      }) as SlotRender;
    slots.update({ barLabel: render(true) });
    let label: ReturnType<typeof slots.acquire> | undefined;
    await act(async () => {
      label = slots.acquire('barLabel', 'a', { n: 1 });
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledTimes(1);
    expect(label!.node.textContent).toBe('');

    // The function is another (it works now): the slot is drawn again.
    slots.update({ barLabel: render(false) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(label!.node.textContent).toBe('1');
    expect(report).toHaveBeenCalledTimes(1);

    // It fails again: reported again, once.
    slots.update({ barLabel: render(true) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledTimes(2);
    expect(label!.node.textContent).toBe('');

    // A new context draws it again, and it fails again with it.
    await act(async () => {
      slots.acquire('barLabel', 'a', { n: 2 });
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledTimes(3);
    await view.unmount();
  });

  it('FR-REACT-4: nobody to report to: the error is not swallowed, it goes to the page (reportError)', async () => {
    const { slots, view } = await mountSlots();
    const boom = new Error('unreported');
    slots.update({
      barLabel: () => {
        throw boom;
      },
    });

    await act(async () => {
      slots.acquire('barLabel', 'a', { n: 1 });
      await Promise.resolve();
    });

    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(boom);
    expect(probe('sentinel')).not.toBeNull();
    await view.unmount();
  });
});

describe('a slot function that throws, in a chart (FR-REACT-4)', () => {
  it('FR-REACT-4: a label that throws leaves the chart and the other labels as they are', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          renderBarLabel: ({ id }) => {
            if (id === 'a') throw new Error('label a failed');
            return <i data-probe={`label ${String(id)}`}>{String(id)}</i>;
          },
        },
        handle,
      ),
    );
    await frame();

    expect(view.container.querySelector('.gantt')).not.toBeNull();
    expect(view.container.querySelectorAll('.gantt__bar')).toHaveLength(2);
    expect(probe('label b')).not.toBeNull();
    expect(probe('label a')).toBeNull();
    expect(chartErrors).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(view.container.querySelector('.gantt')).toBeNull();
  });

  it('FR-REACT-4, FR-EVT-1: a slot that throws in a chart is reported to onError, with the slot name', async () => {
    const handle: Handle = createRef();
    const onError = vi.fn();
    const view = await renderInto(
      chart(
        {
          onError,
          renderBarLabel: ({ id }) => {
            if (id === 'a') throw new Error('label a failed');
            return <i>{String(id)}</i>;
          },
        },
        handle,
      ),
    );
    await frame();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({
      error: new Error('label a failed'),
      source: 'listener',
      name: 'renderBarLabel',
    });
    expect(reported).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-4: a tooltip that throws is hidden, and the next one opens', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(
      chart(
        {
          tooltip: { trigger: 'click' },
          renderTooltip: ({ task }) => {
            if (task.id === 'a') throw new Error('tooltip a failed');
            return <i data-probe="tip">{task.name}</i>;
          },
        },
        handle,
      ),
    );
    await frame();

    await clickBar(handle, 'a');

    expect(popover()).toBeNull();
    expect(hostsOf('tooltip')).toHaveLength(0);
    expect(view.container.querySelector('.gantt')).not.toBeNull();
    expect(chartErrors).toHaveBeenCalledTimes(1);

    await clickBar(handle, 'b');

    expect(popover()).not.toBeNull();
    expect(probe('tip')?.textContent).toBe('B');
    await view.unmount();
  });
});

// ---- a function swapped for another with other hooks ----

/** Hooks of three kinds in a render function: state and an effect. */
function CounterTip(context: TaskTooltipContext): ReactNode {
  const [n, setN] = useState(0);
  useEffect(() => undefined);
  return (
    <button
      type="button"
      data-probe="counter"
      onClick={() => {
        setN((value) => value + 1);
      }}
    >
      {context.task.name} {n}
    </button>
  );
}

/** No hooks at all. */
function PlainTip(context: TaskTooltipContext): ReactNode {
  return <i data-probe="plain">{context.task.name}</i>;
}

/** One hook, of a kind that is not `CounterTip`'s first. */
function RefTip(context: TaskTooltipContext): ReactNode {
  const kind = useMemo(() => 'r', []);
  return (
    <b data-probe="ref">
      {context.task.name} {kind}
    </b>
  );
}

describe('a render function swapped for one with other hooks (FR-REACT-4)', () => {
  const tip = (render: SlotRender | undefined): Partial<GanttProps> => ({
    tooltip: { trigger: 'click' },
    ...(render && { renderTooltip: render as GanttProps['renderTooltip'] }),
  });

  it('FR-REACT-4: with the hooks of another count, React cannot call it in the same component: the slot starts it anew and shows it, with no error', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(chart(tip(CounterTip as SlotRender), handle));
    await clickBar(handle, 'a');
    await act(async () => {
      probe('counter')!.click();
      await Promise.resolve();
    });
    expect(probe('counter')?.textContent).toBe('A 1');
    const open = popover();

    await view.render(chart(tip(PlainTip as SlotRender), handle));
    await frame();

    expect(probe('plain')?.textContent).toBe('A');
    expect(probe('counter')).toBeNull();
    expect(popover()).toBe(open);
    expect(chartErrors).not.toHaveBeenCalled();

    // And back: the state it had is gone, it is a new component.
    await view.render(chart(tip(CounterTip as SlotRender), handle));
    await frame();
    expect(probe('counter')?.textContent).toBe('A 0');
    expect(chartErrors).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-4: a function that declares its own slotKey is another component: no error is raised at all, for hooks of the same count too', async () => {
    const keyed = (render: SlotRender, slotKey: string): SlotRender =>
      Object.assign((context: never) => render(context), { slotKey });
    const handle: Handle = createRef();
    const counter = keyed(CounterTip as SlotRender, 'counter');
    const ref = keyed(RefTip as SlotRender, 'ref');
    const view = await renderInto(chart(tip(counter), handle));
    await clickBar(handle, 'a');
    expect(probe('counter')?.textContent).toBe('A 0');

    await view.render(chart(tip(ref), handle));
    await frame();

    expect(probe('ref')?.textContent).toBe('A r');
    expect(probe('counter')).toBeNull();
    expect(logged).not.toHaveBeenCalled();
    expect(chartErrors).not.toHaveBeenCalled();

    await view.render(chart(tip(counter), handle));
    await frame();
    expect(probe('counter')?.textContent).toBe('A 0');
    expect(logged).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-4: a function that is new on every render and has the same hooks keeps its state', async () => {
    const handle: Handle = createRef();
    const make = (): Partial<GanttProps> =>
      tip(((context: TaskTooltipContext) => CounterTip(context)) as SlotRender);
    const view = await renderInto(chart(make(), handle));
    await clickBar(handle, 'a');
    await act(async () => {
      probe('counter')!.click();
      probe('counter')!.click();
      await Promise.resolve();
    });

    await view.render(chart(make(), handle));
    await view.render(chart(make(), handle));
    await frame();

    expect(probe('counter')?.textContent).toBe('A 2');
    expect(logged).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-4: taking the function away while its content is open, and giving one back, with hooks, raises no error', async () => {
    const handle: Handle = createRef();
    const view = await renderInto(chart(tip(CounterTip as SlotRender), handle));
    await clickBar(handle, 'a');
    expect(probe('counter')).not.toBeNull();

    await view.render(chart(tip(undefined), handle));
    await frame();
    expect(probe('counter')).toBeNull();
    expect(popover()?.querySelector('.gantt__popover-title')?.textContent).toBe('A');

    await view.render(chart(tip(CounterTip as SlotRender), handle));
    await frame();
    await clickBar(handle, 'b');
    expect(probe('counter')?.textContent).toBe('B 0');
    expect(logged).not.toHaveBeenCalled();
    expect(chartErrors).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-4: a function that really fails, after a swap, is reported once, not retried for ever', async () => {
    function Failing(): ReactNode {
      throw new Error('really');
    }
    const handle: Handle = createRef();
    const view = await renderInto(chart(tip(CounterTip as SlotRender), handle));
    await clickBar(handle, 'a');

    await view.render(chart(tip(Failing as SlotRender), handle));
    await frame();

    expect(chartErrors).toHaveBeenCalledTimes(1);
    expect(probe('counter')).toBeNull();
    expect(view.container.querySelector('.gantt')).not.toBeNull();
    await view.unmount();
  });
});
