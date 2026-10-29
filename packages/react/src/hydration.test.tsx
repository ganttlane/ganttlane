import type { ReactElement } from 'react';
import { act, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import type { ListenerTracker } from './testing';
import { cleanUpDocument, createManualFrames, stubScrollerSize, trackListeners } from './testing';
import { useGantt } from './use-gantt';
import { useGanttState } from './use-gantt-state';

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
const NOW = (): string => '2026-03-04';

let tracker: ListenerTracker;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

/**
 * `renderToString` as a server does it, where there is no `window` or `document`. React 18 reports
 * (`console.error`) a `useLayoutEffect` that is rendered on the server next to a `document`, which
 * only a test environment (happy-dom, jsdom) has; the package uses `useEffect` where there is
 * none (`useIsomorphicLayoutEffect`), and `ssr.test.tsx` renders with no DOM at all.
 */
function renderOnServer(element: ReactElement): string {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  try {
    return renderToString(element);
  } finally {
    vi.unstubAllGlobals();
  }
}

/** The container with the markup a server made, as a browser receives it. */
function serverContainer(markup: string): HTMLElement {
  const container = document.createElement('div');
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  container.append(
    ...Array.from(parsed.body.childNodes, (node) => document.importNode(node, true)),
  );
  document.body.append(container);
  return container;
}

const chart = (): ReactElement => (
  <Gantt
    defaultTasks={TASKS}
    now={NOW}
    renderer={{ frames: createManualFrames() }}
    className="chart"
    style={{ height: 300 }}
  />
);

describe('hydration', () => {
  it('FR-REACT-5: hydrating the server markup mounts the chart in it, without a mismatch', async () => {
    const markup = renderOnServer(chart());
    const container = serverContainer(markup);
    const server = container.firstElementChild;
    expect(markup).toBe('<div class="chart" style="height:300px"></div>');
    expect(container.querySelector('.gantt')).toBeNull();

    let root!: ReturnType<typeof hydrateRoot>;
    await act(() => {
      root = hydrateRoot(container, chart());
      return Promise.resolve();
    });

    // The element the server rendered is the one React kept, and the chart is in it now.
    expect(container.firstElementChild).toBe(server);
    expect(container.querySelectorAll('div.chart > .gantt')).toHaveLength(1);
    expect(container.querySelectorAll('.gantt__bar')).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();

    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    expect(container.childNodes).toHaveLength(0);
    expect(tracker.alive().filter((entry) => entry.target !== container)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FR-REACT-5: the same under StrictMode, with one chart and no mismatch', async () => {
    const markup = renderOnServer(<StrictMode>{chart()}</StrictMode>);
    const container = serverContainer(markup);

    let root!: ReturnType<typeof hydrateRoot>;
    await act(() => {
      root = hydrateRoot(container, <StrictMode>{chart()}</StrictMode>);
      return Promise.resolve();
    });

    expect(container.querySelectorAll('.gantt')).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FR-REACT-6: a component that reads the chart’s state hydrates to what the server drew', async () => {
    function Summary(): ReactElement {
      const gantt = useGantt({
        defaultTasks: TASKS,
        defaultSelectedKeys: ['b'],
        now: NOW,
        renderer: { frames: createManualFrames() },
      });
      const selected = useGanttState(gantt, (snapshot) => snapshot.selection.tasks.join(','));
      const { setContainer } = gantt;
      return <section ref={setContainer} data-selected={selected} />;
    }
    const markup = renderOnServer(<Summary />);
    const container = serverContainer(markup);
    expect(markup).toBe('<section data-selected="b"></section>');

    await act(() => {
      hydrateRoot(container, <Summary />);
      return Promise.resolve();
    });

    expect(container.firstElementChild?.getAttribute('data-selected')).toBe('b');
    expect(container.querySelector('section > .gantt')).not.toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('FR-REACT-4, FR-REACT-5: with slots the server markup is the same, and hydration draws the labels into portals without a mismatch', async () => {
    const slotted = (): ReactElement => (
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames: createManualFrames() }}
        className="chart"
        style={{ height: 300 }}
        display={{ barLabel: 'inside' }}
        renderTooltip={() => <b>tip</b>}
        renderBarLabel={({ name }) => <i className="slotted">{name}!</i>}
      />
    );
    const markup = renderOnServer(slotted());
    const container = serverContainer(markup);
    expect(markup).toBe('<div class="chart" style="height:300px"></div>');

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, slotted());
      await Promise.resolve();
    });

    // The labels were asked for while the chart mounted, before the portals listened: they are
    // drawn in the pass after, not lost.
    expect(
      [...container.querySelectorAll('.gantt__bar-label .slotted')].map((n) => n.textContent),
    ).toEqual(['A!', 'B!']);
    expect(error).not.toHaveBeenCalled();
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    expect(container.querySelector('.slotted')).toBeNull();
  });

  it('FR-REACT-5: after hydration the props reach the chart as they do after any mount', async () => {
    const container = serverContainer(renderOnServer(chart()));
    let root!: ReturnType<typeof hydrateRoot>;
    await act(() => {
      root = hydrateRoot(container, chart());
      return Promise.resolve();
    });

    await act(() => {
      root.render(
        <Gantt
          defaultTasks={TASKS}
          now={NOW}
          renderer={{ frames: createManualFrames() }}
          className="chart"
          style={{ height: 300 }}
          theme="dark"
        />,
      );
      return Promise.resolve();
    });

    expect(container.querySelector('.gantt')?.getAttribute('data-theme')).toBe('dark');
    expect(error).not.toHaveBeenCalled();
  });
});
