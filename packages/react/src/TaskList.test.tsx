import { act, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskList, type TaskListProps } from './TaskList';
import type { ManualFrames } from './testing';
import { cleanUpDocument, createManualFrames, renderInto, stubScrollerSize } from './testing';
import type { GanttInstance, GanttReactOptions } from './types';
import { useGantt } from './use-gantt';

const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'g', name: 'Group', start: '2026-03-09', end: '2026-03-20' },
  { id: 'g1', name: 'Child one', parentId: 'g', start: '2026-03-09', end: '2026-03-11' },
  { id: 'g2', name: 'Child two', parentId: 'g', start: '2026-03-12', end: '2026-03-13' },
  { id: 'z', name: 'Zulu', start: '2026-09-01', end: '2026-09-04', rowClassName: 'late' },
];

let frames: ManualFrames;

beforeEach(() => {
  frames = createManualFrames();
  vi.useFakeTimers();
  stubScrollerSize(600, 200);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

interface PlanProps {
  readonly options?: Partial<GanttReactOptions> | undefined;
  /** The props of the list; `false` draws none. */
  readonly list?: Partial<TaskListProps> | false | undefined;
  readonly capture?: ((gantt: GanttInstance) => void) | undefined;
}

/** A chart and its list, the way an application writes them. */
function Plan({ options, list, capture }: PlanProps): ReactElement {
  const gantt = useGantt({
    defaultTasks: TASKS,
    calendar: { weekends: [] },
    scroll: { initial: 'start', behavior: 'instant' },
    layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25 },
    renderer: { frames },
    ...options,
  });
  const { setContainer, slots } = gantt;
  capture?.(gantt);
  return (
    <>
      {list === false ? null : <TaskList gantt={gantt} {...list} />}
      <div ref={setContainer} />
      {slots}
    </>
  );
}

const row = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.gantt-task-list__row[data-task-id="${id}"]`);
const ids = (): (string | undefined)[] =>
  [...document.querySelectorAll<HTMLElement>('.gantt-task-list__row')].map(
    (node) => node.dataset.taskId,
  );
const root = (): HTMLElement => document.querySelector<HTMLElement>('.gantt-task-list')!;
/** Runs what the browser or the application would, and what React then does. */
const run = (work: () => void): Promise<void> =>
  act(() => {
    work();
    return Promise.resolve();
  });
const press = (target: Element, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

/** Renders a plan; returns the chart and the view. */
async function plan(props: PlanProps = {}): Promise<{
  gantt: GanttInstance;
  view: Awaited<ReturnType<typeof renderInto>>;
}> {
  let gantt: GanttInstance | undefined;
  const view = await renderInto(
    <Plan
      {...props}
      capture={(made) => {
        gantt = made;
      }}
    />,
  );
  await run(() => {
    frames.step();
  });
  return { gantt: gantt!, view };
}

describe('<TaskList>: beside bars that take the focus, and selection.multiple', () => {
  const bar = (id: string): SVGElement =>
    document.querySelector<SVGElement>(`.gantt__bar[data-task-id="${id}"]`)!;
  const withBars = { keyboard: { barFocus: true } };
  const clickWith = (node: Element | null, init: MouseEventInit): void => {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  };

  it('FR-SEL-3: a bar with the focus keeps it, and the list follows with its tab stop', async () => {
    const { gantt } = await plan({ options: withBars });
    await run(() => {
      bar('g').focus();
      frames.step();
    });
    expect(document.activeElement).toBe(bar('g'));
    expect(gantt.getSnapshot().focusedTask).toBe('g');
    expect(row('g')?.tabIndex).toBe(0);
  });

  it('FR-SEL-3: a row with the focus keeps it, and the bar follows with its tab stop', async () => {
    await plan({ options: withBars });
    await run(() => {
      row('g')?.focus();
      frames.step();
    });
    expect(document.activeElement).toBe(row('g'));
    expect(bar('g').getAttribute('tabindex')).toBe('0');
  });

  it('FR-SEL-3: a browser that takes the focus from a row that a sort moves gives no gap', async () => {
    // What Chromium does during React's commit; React then gives the focus back by itself.
    const flat = TASKS.filter((task) => task.parentId === undefined);
    const { gantt } = await plan({ options: { defaultTasks: flat } });
    const heard: unknown[] = [];
    gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    const moved = row('g')!;
    await run(() => {
      moved.focus();
      frames.step();
    });
    // React moves a node with either, as the rows around it say.
    const box = moved.parentElement!;
    const insert = box.insertBefore.bind(box);
    const append = box.appendChild.bind(box);
    vi.spyOn(box, 'insertBefore').mockImplementation((node: Node, before: Node | null) => {
      if (node === moved) moved.blur();
      return insert(node, before);
    });
    vi.spyOn(box, 'appendChild').mockImplementation((node: Node) => {
      if (node === moved) moved.blur();
      return append(node);
    });
    await run(() => {
      gantt.setTasks([...flat].reverse());
    });
    expect(ids()).toEqual(['z', 'g', 'a']);
    expect(document.activeElement).toBe(moved);
    expect(gantt.getSnapshot().focusedTask).toBe('g');
    expect(heard).toEqual(['g']);
  });

  it('FR-SEL-3: moving between a row and a bar reports the new task with no gap', async () => {
    const { gantt } = await plan({ options: withBars });
    const heard: unknown[] = [];
    gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    await run(() => {
      row('a')?.focus();
    });
    await run(() => {
      bar('g').focus();
    });
    await run(() => {
      row('g1')?.focus();
    });
    expect(heard).toEqual(['a', 'g', 'g1']);
  });

  it('FR-SEL-3: focusBar is on the instance, and moves the focus from the list to a bar', async () => {
    const { gantt } = await plan({ options: withBars });
    await run(() => {
      row('a')?.focus();
    });
    await run(() => {
      gantt.focusBar('g1');
      frames.step();
    });
    expect(document.activeElement).toBe(bar('g1'));
  });

  it('FR-SEL-2: Ctrl or Cmd adds a row and takes it out, and the grid says it can', async () => {
    const { gantt } = await plan({ options: { selection: { multiple: true } } });
    expect(document.querySelector('[role="treegrid"]')?.getAttribute('aria-multiselectable')).toBe(
      'true',
    );
    await run(() => {
      row('a')?.click();
    });
    await run(() => {
      clickWith(row('g1'), { ctrlKey: true });
    });
    await run(() => {
      clickWith(row('g2'), { metaKey: true });
    });
    expect(gantt.getSnapshot().selection.tasks).toEqual(['a', 'g1', 'g2']);
    expect(row('g1')?.getAttribute('aria-selected')).toBe('true');
    await run(() => {
      clickWith(row('g1'), { ctrlKey: true });
    });
    expect(gantt.getSnapshot().selection.tasks).toEqual(['a', 'g2']);
  });

  it('FR-SEL-2: off by default Ctrl + click selects one and the grid does not say it can', async () => {
    const { gantt } = await plan();
    expect(document.querySelector('[aria-multiselectable]')).toBeNull();
    await run(() => {
      row('a')?.click();
    });
    await run(() => {
      clickWith(row('g1'), { ctrlKey: true });
    });
    expect(gantt.getSnapshot().selection.tasks).toEqual(['g1']);
  });

  it('FR-SEL-2: a selection.multiple taken off the props turns it off, field by field', async () => {
    const { gantt, view } = await plan({
      options: { selection: { onClick: true, multiple: true } },
    });
    expect(gantt.getAppearance().multiSelect).toBe(true);
    await view.render(<Plan options={{ selection: { onClick: true } }} />);
    expect(gantt.getAppearance().multiSelect).toBe(false);
  });

  it('FR-SEL-3: keyboard.barFocus follows its prop', async () => {
    const { view } = await plan({ options: withBars });
    expect(bar('a').getAttribute('tabindex')).toBe('0');
    await view.render(<Plan options={{}} />);
    await run(() => {
      frames.step();
    });
    expect(bar('a').hasAttribute('tabindex')).toBe(false);
  });
});

describe('<TaskList>: the rows', () => {
  it('FR-REACT-8: a row for every row of the chart, at its height and place, with its tree state', async () => {
    await plan();
    expect(ids()).toEqual(['a', 'g', 'g1', 'g2', 'z']);
    expect(root().style.getPropertyValue('--gantt-task-list-row-height')).toBe('40px');
    expect(root().style.getPropertyValue('--gantt-task-list-header-height')).toBe('50px');
    expect(root().style.getPropertyValue('--gantt-task-list-view-height')).toBe('150px');
    expect(row('g1')?.style.getPropertyValue('--gantt-task-list-y')).toBe('80px');
    expect(row('g')?.getAttribute('role')).toBe('row');
    expect(row('g')?.getAttribute('aria-level')).toBe('1');
    expect(row('g')?.getAttribute('aria-expanded')).toBe('true');
    expect(row('g')?.hasAttribute('data-group')).toBe(true);
    expect(row('g2')?.getAttribute('aria-level')).toBe('2');
    expect(row('g2')?.hasAttribute('aria-expanded')).toBe(false);
    expect(row('a')?.tabIndex).toBe(0);
    expect(row('g')?.tabIndex).toBe(-1);
    expect(row('z')?.classList.contains('late')).toBe(true);
    expect(document.querySelector('[role="treegrid"]')?.getAttribute('aria-label')).toBe('Tasks');
    expect(document.querySelector('[role="columnheader"]')?.textContent).toBe('Task');
  });

  it('FR-REACT-8: the same markup as the vanilla list: classes and data attributes', async () => {
    await plan();
    expect(root().classList.contains('gantt-scope')).toBe(true);
    const cell = row('a')?.firstElementChild;
    expect(cell?.className).toBe('gantt-task-list__cell');
    expect(cell?.getAttribute('role')).toBe('gridcell');
    expect(cell?.hasAttribute('data-tree')).toBe(true);
    expect(cell?.querySelector('[data-toggle]')?.getAttribute('aria-hidden')).toBe('true');
    expect(cell?.querySelector('.gantt-task-list__text')?.textContent).toBe('Alpha');
  });

  it('FR-REACT-8: columns draw text from value and React from render', async () => {
    await plan({
      list: {
        columns: [
          { id: 'name', header: 'Name' },
          {
            id: 'done',
            header: 'Done',
            width: 50,
            align: 'end',
            value: (item) => `${String(item.record.progress)}%`,
          },
          {
            id: 'badge',
            render: (item) => (item.depth === 0 ? <b>{item.name[0]}</b> : null),
            value: () => 'child',
          },
        ],
      },
    });
    const cells = (id: string): (string | null | undefined)[] =>
      [...(row(id)?.children ?? [])].map((cell) => cell.textContent);
    expect(cells('a')).toEqual(['Alpha', '10%', 'A']);
    expect(cells('g1')).toEqual(['Child one', '0%', 'child']);
    expect(row('a')?.querySelector('b')?.textContent).toBe('A');
    expect(row('a')?.children[1]?.getAttribute('data-align')).toBe('end');
    expect(root().style.getPropertyValue('--gantt-task-list-columns')).toBe(
      'minmax(0, 1fr) 50px 96px',
    );
  });

  it('FR-ROW-2: a group shut from anywhere leaves the list, and rows keep their nodes', async () => {
    const { gantt } = await plan();
    const zulu = row('z');
    await run(() => {
      gantt.collapse('g');
    });
    expect(ids()).toEqual(['a', 'g', 'z']);
    expect(row('z')).toBe(zulu);
    expect(row('g')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('NFR-PERF-3: it draws the rows the chart draws, and the row with the tab stop', async () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `T${String(i)}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    const { gantt } = await plan({ options: { defaultTasks: tasks } });
    const first = gantt.getRowWindow();
    expect(ids()).toHaveLength(first.lastRow - first.firstRow + 1);
    await run(() => {
      gantt.scrollTo({ top: 20_000 });
    });
    const moved = gantt.getRowWindow();
    expect(moved.firstRow).toBeGreaterThan(400);
    expect(ids()).toHaveLength(moved.lastRow - moved.firstRow + 2);
    expect(ids()[0]).toBe('0');
  });

  it('FR-REACT-8: a hover in the chart does not draw the rows again that did not change', async () => {
    const render = vi.fn(() => 'cell');
    const { gantt } = await plan({ list: { columns: [{ id: 'x', render }] } });
    const calls = render.mock.calls.length;
    await run(() => {
      gantt.setHoveredRow('a');
    });
    // Only the row that is lit now, and its cell.
    expect(render.mock.calls.length).toBe(calls + 1);
    expect(row('a')?.hasAttribute('data-hovered')).toBe(true);
  });
});

describe('<TaskList>: sync with the chart', () => {
  it('FR-REACT-8: a click selects the task; the toggle opens and shuts the group', async () => {
    const { gantt } = await plan();
    await run(() => {
      row('z')?.click();
    });
    expect(gantt.getSnapshot().selection.tasks).toEqual(['z']);
    expect(row('z')?.getAttribute('aria-selected')).toBe('true');
    expect(gantt.getSnapshot().scrollRequest?.left).toBeGreaterThan(0);

    await run(() => {
      row('g')?.querySelector<HTMLElement>('[data-toggle]')?.click();
    });
    expect(ids()).toEqual(['a', 'g', 'z']);
    expect(gantt.getSnapshot().selection.tasks).toEqual(['z']);
  });

  it('FR-REACT-8: the handlers are always the latest, and preventDefault keeps the selection', async () => {
    const first = vi.fn();
    const second = vi.fn((_record: unknown, event: Event) => {
      event.preventDefault();
    });
    const onRowDoubleClick = vi.fn();
    const { gantt, view } = await plan({ list: { onRowClick: first, onRowDoubleClick } });
    await view.render(<Plan list={{ onRowClick: second, onRowDoubleClick }} />);
    await run(() => {
      row('a')?.click();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls[0]?.[0]).toBe(gantt.getTask('a'));
    expect(gantt.getSnapshot().selection.tasks).toEqual([]);
    await run(() => {
      row('a')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onRowDoubleClick.mock.calls[0]?.[0]).toBe(gantt.getTask('a'));
  });

  it('FR-REACT-8: selectedKeys of the chart show in the list', async () => {
    await plan({ options: { selectedKeys: ['g1'] } });
    expect(row('g1')?.getAttribute('aria-selected')).toBe('true');
    expect(row('g1')?.tabIndex).toBe(0);
  });

  it('FR-A11Y-2: the keys walk the tree, with the focus on the new row after the commit', async () => {
    const { gantt } = await plan();
    await run(() => {
      row('a')?.focus();
    });
    expect(gantt.getSnapshot().focusedTask).toBe('a');
    await run(() => {
      press(row('a')!, 'ArrowDown');
    });
    expect(document.activeElement).toBe(row('g'));
    expect(row('g')?.tabIndex).toBe(0);
    await run(() => {
      press(row('g')!, 'ArrowLeft');
    });
    expect(ids()).toEqual(['a', 'g', 'z']);
    await run(() => {
      press(row('g')!, 'Enter');
    });
    expect(gantt.getSnapshot().selection.tasks).toEqual(['g']);
    await run(() => {
      gantt.focusTask('z');
    });
    expect(document.activeElement).toBe(row('z'));
  });

  it('FR-ROW-6: a hover in the list lights the chart, and the list turns on its row hover', async () => {
    const { gantt } = await plan();
    expect(gantt.getAppearance().rowHover).toBe(true);
    expect(document.querySelector('.gantt')?.hasAttribute('data-row-hover')).toBe(true);
    await run(() => {
      row('g1')?.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
      );
    });
    expect(gantt.getSnapshot().hoveredRow).toBe('g1');
    expect(row('g1')?.hasAttribute('data-hovered')).toBe(true);
  });

  it('FR-ROW-6: the row hover ends with the list', async () => {
    const { gantt, view } = await plan();
    expect(gantt.getAppearance().rowHover).toBe(true);
    await view.render(<Plan list={false} />);
    expect(root()).toBeNull();
    expect(gantt.getAppearance().rowHover).toBe(false);
  });

  it('FR-THEME-2: it follows the theme, the height and the stripes of the chart', async () => {
    const { view } = await plan({
      options: { theme: 'dark', display: { rowStripes: 'group' } },
    });
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(row('g')?.hasAttribute('data-stripe')).toBe(true);
    expect(root().hasAttribute('data-height')).toBe(false);
    await view.render(
      <Plan
        options={{
          theme: 'light',
          layout: { rowHeight: 40, height: 'auto' },
          display: { rowStripes: false },
        }}
      />,
    );
    expect(root().getAttribute('data-theme')).toBe('light');
    expect(root().getAttribute('data-height')).toBe('auto');
    expect(row('g')?.hasAttribute('data-stripe')).toBe(false);
    await view.render(<Plan options={{ theme: 'light' }} list={{ theme: 'dark' }} />);
    expect(root().getAttribute('data-theme')).toBe('dark');
  });

  it('FR-ROW-6: the chart scrolling moves the list, and the list scrolling moves the chart', async () => {
    const { gantt } = await plan({
      options: { layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25, height: 200 } },
    });
    const body = document.querySelector<HTMLElement>('.gantt-task-list__body')!;
    const write = vi.spyOn(body, 'scrollTo');
    await run(() => {
      gantt.core.scroll({ left: 0, top: 70 });
    });
    expect(write).toHaveBeenCalledWith({ top: 70, behavior: 'instant' });

    await run(() => {
      body.scrollTop = 40;
      body.dispatchEvent(new Event('scroll'));
    });
    expect(gantt.getSnapshot().scrollRequest).toMatchObject({ top: 40, behavior: 'instant' });
  });
});

describe('<TaskList>: the width', () => {
  const splitter = (): HTMLElement =>
    document.querySelector<HTMLElement>('.gantt-task-list__splitter')!;
  const width = (): string => root().style.getPropertyValue('--gantt-task-list-width');

  it('FR-REACT-1: uncontrolled, it starts from defaultWidth and owns it', async () => {
    const onWidthChange = vi.fn();
    await plan({ list: { defaultWidth: 300, onWidthChange } });
    expect(width()).toBe('300px');
    await run(() => {
      press(splitter(), 'ArrowRight');
    });
    expect(width()).toBe('316px');
    expect(onWidthChange).toHaveBeenCalledWith(316);
    expect(splitter().getAttribute('aria-valuenow')).toBe('316');
  });

  it('FR-REACT-1: controlled, it changes when your state does', async () => {
    const onWidthChange = vi.fn();
    const { view } = await plan({ list: { width: 300, onWidthChange } });
    await run(() => {
      press(splitter(), 'End');
    });
    expect(onWidthChange).toHaveBeenCalledWith(640);
    expect(width()).toBe('300px');
    await view.render(<Plan list={{ width: 1000, maxWidth: 500 }} />);
    expect(width()).toBe('500px');
  });

  it('FR-ROW-6: the splitter drags with the pointer, and can be left out', async () => {
    const { view } = await plan({ list: { defaultWidth: 300 } });
    const handle = splitter();
    handle.setPointerCapture = vi.fn();
    const send = (type: string, clientX: number): void => {
      handle.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          button: 0,
          pointerId: 1,
        }),
      );
    };
    await run(() => {
      send('pointerdown', 500);
      send('pointermove', 540);
      send('pointerup', 540);
    });
    expect(width()).toBe('340px');
    await view.render(<Plan list={{ splitter: false }} />);
    expect(splitter().hidden).toBe(true);
  });
});

describe('<TaskList>: React', () => {
  it('FR-REACT-5: it renders on a server, with the first rows, and the same as the browser', () => {
    function Page(): ReactElement {
      const gantt = useGantt({ defaultTasks: TASKS });
      return <TaskList gantt={gantt} />;
    }
    const html = renderToString(<Page />);
    expect(html).toContain('Child two');
    expect(html).toContain('role="treegrid"');
    expect(html).not.toContain('--gantt-task-list-view-height');
  });

  it('FR-REACT-5: StrictMode mounts it twice, and leaves one set of listeners', async () => {
    let gantt: GanttInstance | undefined;
    await renderInto(
      <Plan
        capture={(made) => {
          gantt = made;
        }}
      />,
      { strict: true },
    );
    const onSelect = vi.fn();
    gantt?.on('selectionChange', onSelect);
    await run(() => {
      row('a')?.click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(gantt?.getAppearance().rowHover).toBe(true);
  });
});
