// @vitest-environment node
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import { useGantt } from './use-gantt';
import { useGanttState } from './use-gantt-state';

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];

afterEach(() => {
  vi.restoreAllMocks();
});

/** `useGantt` with a slot, and its portals next to the container, as the hook is documented. */
function Plan({
  renderTooltip,
}: {
  readonly renderTooltip: () => React.ReactElement;
}): React.ReactElement {
  const { setContainer, slots } = useGantt({ defaultTasks: TASKS, renderTooltip });
  return (
    <>
      <div ref={setContainer} />
      {slots}
    </>
  );
}

describe('server rendering (no DOM at all)', () => {
  it('FR-REACT-5: this environment has no window and no document', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('FR-REACT-5: importing the package reads no window, document or other browser global', async () => {
    const browser = [
      'window',
      'document',
      'navigator',
      'location',
      'HTMLElement',
      'Element',
      'Node',
      'ResizeObserver',
      'requestAnimationFrame',
      'matchMedia',
      'getComputedStyle',
    ];
    for (const name of browser) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new Error(`the package read the global \`${name}\` while it was imported`);
        },
      });
    }
    vi.resetModules();
    try {
      const imported = await import('./index');
      expect(Object.keys(imported).sort()).toEqual([
        'Gantt',
        'patchTasks',
        'useGantt',
        'useGanttState',
      ]);
    } finally {
      for (const name of browser) Reflect.deleteProperty(globalThis, name);
    }
  });

  it('FR-REACT-5: renderToString gives the container markup, nothing else, without a warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const html = renderToString(
      <Gantt
        defaultTasks={TASKS}
        links={[{ source: 'a', target: 'b' }]}
        viewMode="week"
        theme="dark"
        locale="uk"
        className="chart"
        style={{ height: 300 }}
        onTaskClick={() => undefined}
      />,
    );

    expect(html).toBe('<div class="chart" style="height:300px"></div>');
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('FR-REACT-5: under StrictMode, with controlled values and without tasks at all, it renders the same', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const controlled = renderToString(
      <StrictMode>
        <Gantt tasks={TASKS} selectedKeys={['a']} expandedKeys="all" viewMode="day" className="c" />
      </StrictMode>,
    );
    const empty = renderToString(
      <StrictMode>
        <Gantt />
      </StrictMode>,
    );

    expect(controlled).toBe('<div class="c"></div>');
    expect(empty).toBe('<div></div>');
    expect(error).not.toHaveBeenCalled();
  });

  it('FR-REACT-4, FR-REACT-5: slots render nothing on the server, and their functions are never called', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renderTooltip = vi.fn(() => <b>tip</b>);
    const renderLinkMenu = vi.fn(() => <b>menu</b>);
    const renderBarLabel = vi.fn(() => <b>label</b>);

    const html = renderToString(
      <Gantt
        defaultTasks={TASKS}
        className="chart"
        renderTooltip={renderTooltip}
        renderLinkMenu={renderLinkMenu}
        renderBarLabel={renderBarLabel}
      />,
    );
    const hook = renderToString(
      <StrictMode>
        <Plan renderTooltip={renderTooltip} />
      </StrictMode>,
    );

    expect(html).toBe('<div class="chart"></div>');
    expect(hook).toBe('<div></div>');
    expect(renderTooltip).not.toHaveBeenCalled();
    expect(renderLinkMenu).not.toHaveBeenCalled();
    expect(renderBarLabel).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('FR-REACT-6: useGanttState reads the snapshot on the server, from the core that the render created', () => {
    function Summary(): React.ReactElement {
      const gantt = useGantt({ defaultTasks: TASKS, defaultSelectedKeys: ['b'], viewMode: 'week' });
      const rows = useGanttState(gantt, (snapshot) => snapshot.state.tasks.length);
      const selected = useGanttState(gantt, (snapshot) => snapshot.selection.tasks.join(','));
      const mode = useGanttState(gantt, (snapshot) => snapshot.viewMode.id);
      const { setContainer } = gantt;
      return (
        <section ref={setContainer} data-rows={rows} data-selected={selected} data-mode={mode} />
      );
    }

    const html = renderToString(<Summary />);

    expect(html).toBe('<section data-rows="2" data-selected="b" data-mode="week"></section>');
  });

  it('FR-REACT-5: a chart per request: two renders share nothing', () => {
    const seen: unknown[] = [];
    function Probe({ tasks }: { tasks: typeof TASKS }): React.ReactElement {
      const gantt = useGantt({ defaultTasks: tasks });
      seen.push(gantt.core);
      return <i>{gantt.getTask('a')?.name ?? 'none'}</i>;
    }

    const first = renderToString(<Probe tasks={TASKS} />);
    const second = renderToString(<Probe tasks={[TASKS[1]!]} />);

    expect(first).toBe('<i>A</i>');
    expect(second).toBe('<i>none</i>');
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('FR-REACT-5: no effect runs on the server, so no handler is called and nothing is left running', () => {
    const onIssues = vi.fn();
    const onRangeChange = vi.fn();

    renderToString(
      <Gantt
        defaultTasks={TASKS}
        tooltip={{ trigger: 'nope' as never }}
        onIssues={onIssues}
        onRangeChange={onRangeChange}
      />,
    );

    expect(onIssues).not.toHaveBeenCalled();
    expect(onRangeChange).not.toHaveBeenCalled();
  });
});
