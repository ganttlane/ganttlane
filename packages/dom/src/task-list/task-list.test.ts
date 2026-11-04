import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Gantt } from '../create-gantt';
import { createGantt } from '../create-gantt';
import type { ListenerTracker, ManualFrames } from '../testing';
import {
  countNodes,
  createContainer,
  createManualFrames,
  stubScrollerSize,
  trackListeners,
} from '../testing';
import { createTaskList, type TaskList, type TaskListOptions } from './index';

// Rows of 40 px under a header of 50 px, in a chart 200 px tall: 150 px of rows are in view.
const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'g', name: 'Group', start: '2026-03-09', end: '2026-03-20' },
  { id: 'g1', name: 'Child one', parentId: 'g', start: '2026-03-09', end: '2026-03-11' },
  { id: 'g2', name: 'Child two', parentId: 'g', start: '2026-03-12', end: '2026-03-13' },
  { id: 'z', name: 'Zulu', start: '2026-09-01', end: '2026-09-04', rowClassName: 'late' },
  { id: 'n', name: 'No dates', type: 'placeholder' as const },
];

let tracker: ListenerTracker;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(600, 200);
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Fixture {
  readonly gantt: Gantt;
  readonly list: TaskList;
  readonly frames: ManualFrames;
  readonly side: HTMLElement;
  readonly chart: HTMLElement;
  readonly body: HTMLElement;
  readonly row: (id: string) => HTMLElement | null;
  readonly ids: () => (string | undefined)[];
  /** The chart's frame, in which it performs its scroll requests. */
  readonly flush: () => void;
}

function create(
  options: TaskListOptions = {},
  chartOptions: Partial<Parameters<typeof createGantt>[1]> = {},
): Fixture {
  const frames = createManualFrames();
  const chart = createContainer();
  const side = createContainer();
  const gantt = createGantt(chart, {
    tasks: TASKS,
    calendar: { weekends: [] },
    scroll: { initial: 'start', behavior: 'instant' },
    layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25 },
    renderer: { frames },
    ...chartOptions,
  });
  const list = createTaskList(side, gantt, options);
  frames.step();
  const body = side.querySelector<HTMLElement>('.gantt-task-list__body')!;
  return {
    gantt,
    list,
    frames,
    side,
    chart,
    body,
    row: (id) => side.querySelector<HTMLElement>(`.gantt-task-list__row[data-task-id="${id}"]`),
    ids: () =>
      [...side.querySelectorAll<HTMLElement>('.gantt-task-list__row')].map(
        (node) => node.dataset.taskId,
      ),
    flush: () => {
      frames.step();
    },
  };
}

const press = (target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const toggleOf = (row: HTMLElement | null): HTMLElement =>
  row!.querySelector<HTMLElement>('[data-toggle]')!;

describe('createTaskList: beside bars that take the focus', () => {
  const withBars = (more: Partial<Parameters<typeof createGantt>[1]> = {}): Fixture =>
    create({}, { keyboard: { barFocus: true }, ...more });
  const barOf = (chart: HTMLElement, id: string): SVGElement =>
    chart.querySelector<SVGElement>(`.gantt__bar[data-task-id="${id}"]`)!;

  it('FR-SEL-3: a bar with the focus keeps it, and the row only follows', () => {
    const { gantt, chart, row, flush } = withBars();
    barOf(chart, 'g').focus();
    flush();
    expect(document.activeElement).toBe(barOf(chart, 'g'));
    expect(gantt.core.getSnapshot().focusedTask).toBe('g');
    expect(row('g')?.tabIndex).toBe(0);
    expect(row('a')?.tabIndex).toBe(-1);
  });

  it('FR-SEL-3: a row with the focus keeps it, and the bar only follows', () => {
    const { chart, row, flush } = withBars();
    row('g')?.focus();
    flush();
    expect(document.activeElement).toBe(row('g'));
    expect(barOf(chart, 'g').getAttribute('tabindex')).toBe('0');
    expect(barOf(chart, 'a').getAttribute('tabindex')).toBe('-1');
  });

  it('FR-SEL-3: the keys walk the surface that has the focus, and the other follows', () => {
    const { gantt, chart, row, flush } = withBars();
    barOf(chart, 'a').focus();
    press(barOf(chart, 'a'), 'ArrowDown');
    flush();
    expect(document.activeElement).toBe(barOf(chart, 'g'));
    expect(row('g')?.tabIndex).toBe(0);

    row('g')?.focus();
    flush();
    press(row('g')!, 'ArrowDown');
    flush();
    expect(document.activeElement).toBe(row('g1'));
    expect(barOf(chart, 'g1').getAttribute('tabindex')).toBe('0');
    expect(gantt.core.getSnapshot().focusedTask).toBe('g1');
  });

  it('FR-SEL-3: moving between a row and a bar reports the new task with no gap', () => {
    const { gantt, chart, row, flush } = withBars();
    const heard: unknown[] = [];
    gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    row('a')?.focus();
    flush();
    barOf(chart, 'g').focus();
    flush();
    row('g1')?.focus();
    flush();
    expect(heard).toEqual(['a', 'g', 'g1']);
    expect(document.activeElement).toBe(row('g1'));
  });

  it('FR-SEL-3: going from a row to a bar of another chart lets go of the task here', () => {
    const { gantt, row, flush } = withBars();
    const other = createContainer();
    const another = createGantt(other, {
      tasks: [{ id: 'other', name: 'Other', start: '2026-03-02', end: '2026-03-06' }],
      keyboard: { barFocus: true },
      renderer: { frames: createManualFrames() },
    });
    row('a')?.focus();
    flush();
    other.querySelector<SVGElement>('.gantt__bar')?.focus();
    expect(gantt.core.getSnapshot().focusedTask).toBeUndefined();
    another.destroy();
  });

  it('FR-SEL-3: a focusTask from elsewhere stays with the surface that holds the focus', () => {
    const { gantt, chart, row, flush } = withBars();
    barOf(chart, 'a').focus();
    flush();
    gantt.focusTask('g1');
    flush();
    expect(document.activeElement).toBe(barOf(chart, 'g1'));

    row('a')?.focus();
    flush();
    gantt.focusTask('g2');
    flush();
    expect(document.activeElement).toBe(row('g2'));
  });

  it('FR-SEL-3: a focusTask with the focus on neither goes to the row, as without bars', () => {
    const { gantt, row, flush } = withBars();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    gantt.focusTask('g1');
    flush();
    expect(document.activeElement).toBe(row('g1'));
  });

  it('FR-SEL-3: a bar that goes away is the chart\u2019s to hand on, not the list\u2019s', () => {
    const { gantt, chart, flush } = withBars();
    barOf(chart, 'g1').focus();
    flush();
    gantt.collapse('g');
    flush();
    expect(document.activeElement?.classList.contains('gantt__bar')).toBe(true);
    expect(chart.contains(document.activeElement)).toBe(true);
  });

  it('FR-SEL-2: the selection made on a bar shows on the row, and the other way round', () => {
    const { chart, row, flush } = withBars({ selection: { onClick: true, multiple: true } });
    press(barOf(chart, 'a'), 'Enter');
    flush();
    expect(row('a')?.getAttribute('aria-selected')).toBe('true');
    row('g')?.click();
    flush();
    expect(barOf(chart, 'g').getAttribute('aria-pressed')).toBe('true');
    expect(barOf(chart, 'a').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('createTaskList: a bar with something focusable in its label', () => {
  const withButton = (more: Partial<Parameters<typeof createGantt>[1]> = {}): Fixture =>
    create(
      {},
      {
        display: {
          barLabel: 'inside',
          renderBarLabel: () => {
            const button = document.createElement('button');
            button.textContent = 'Open';
            return button;
          },
        },
        ...more,
      },
    );
  const buttonOf = ({ chart }: Fixture, id: string): HTMLElement =>
    chart.querySelector<HTMLElement>(`.gantt__bar[data-task-id="${id}"] button`)!;

  it('FR-SEL-3: with the options off, a button in a bar takes the focus from a row like anything else', () => {
    const fixture = withButton();
    const heard: unknown[] = [];
    fixture.gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    fixture.row('a')?.focus();
    fixture.flush();
    buttonOf(fixture, 'g').focus();
    expect(fixture.gantt.core.getSnapshot().focusedTask).toBeUndefined();
    expect(heard).toEqual(['a', null]);
  });

  it('FR-SEL-3: with the options off, the list does not take the focus back from what has it next', () => {
    const fixture = withButton();
    fixture.row('a')?.focus();
    fixture.flush();
    buttonOf(fixture, 'g').focus();
    fixture.flush();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fixture.gantt.setHoveredRow('z');
    fixture.flush();
    expect(document.activeElement).toBe(input);
  });

  it('FR-SEL-3: with bars that take the focus, the button keeps it, and its task is the focused one', () => {
    const fixture = withButton({ keyboard: { barFocus: true } });
    fixture.row('a')?.focus();
    fixture.flush();
    const button = buttonOf(fixture, 'g');
    button.focus();
    fixture.flush();
    expect(document.activeElement).toBe(button);
    expect(fixture.gantt.core.getSnapshot().focusedTask).toBe('g');
  });
});

describe('createTaskList: numeric ids beside bars that take the focus', () => {
  const NUMBERED = [
    { id: 1, name: 'One', start: '2026-03-02', end: '2026-03-06' },
    { id: 2, name: 'Two', start: '2026-03-09', end: '2026-03-13' },
    { id: 3, name: 'Three', start: '2026-03-16', end: '2026-03-20' },
  ];

  it('FR-SEL-3: moving between rows and bars reports each id, as a number, with no gap', () => {
    const { gantt, chart, side, flush } = create(
      {},
      { tasks: NUMBERED, keyboard: { barFocus: true } },
    );
    const heard: unknown[] = [];
    gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    const rowOf = (id: number): HTMLElement =>
      side.querySelector<HTMLElement>(`.gantt-task-list__row[data-task-id="${String(id)}"]`)!;
    rowOf(1).focus();
    flush();
    chart.querySelector<SVGElement>('.gantt__bar[data-task-id="2"]')?.focus();
    flush();
    rowOf(3).focus();
    flush();
    expect(heard).toEqual([1, 2, 3]);
    expect(document.activeElement).toBe(rowOf(3));
  });

  it('FR-SEL-3: the keys walk the bars of numeric ids', () => {
    const { gantt, chart, flush } = create({}, { tasks: NUMBERED, keyboard: { barFocus: true } });
    const bar = chart.querySelector<SVGElement>('.gantt__bar[data-task-id="1"]')!;
    bar.focus();
    press(bar, 'ArrowDown');
    flush();
    expect(gantt.core.getSnapshot().focusedTask).toBe(2);
  });
});

describe('createTaskList: a row with the focus when rows are sorted', () => {
  const FLAT = [
    { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
    { id: 'b', name: 'Bravo', start: '2026-03-09', end: '2026-03-13' },
    { id: 'c', name: 'Charlie', start: '2026-03-16', end: '2026-03-20' },
  ];

  it('FR-SEL-3: a browser that takes the focus from the moved node gives no gap, and it comes back', () => {
    // What Chromium does when a sort moves the node of the focused row: `focusout`, nothing to
    // take it, and the focus on the body. Happy DOM keeps the focus on a moved node, so it is sent here.
    const { gantt, row, side, flush } = create({}, { tasks: FLAT });
    const heard: unknown[] = [];
    gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    const moved = row('b')!;
    moved.focus();
    flush();
    const box = moved.parentElement!;
    const original = box.insertBefore.bind(box);
    vi.spyOn(box, 'insertBefore').mockImplementation((node: Node, before: Node | null) => {
      if (node === moved) moved.blur();
      return original(node, before);
    });

    gantt.setTasks([...FLAT].reverse());
    flush();

    const ids = [...side.querySelectorAll<HTMLElement>('.gantt-task-list__row')].map(
      (node) => node.dataset.taskId,
    );
    expect(ids).toEqual(['c', 'b', 'a']);
    expect(document.activeElement).toBe(moved);
    expect(gantt.core.getSnapshot().focusedTask).toBe('b');
    expect(heard).toEqual(['b']);
  });

  it('FR-SEL-3: going away from a row on purpose still lets go of it, with new rows or without', () => {
    const { gantt, row, flush } = create({}, { tasks: FLAT });
    const outside = document.createElement('button');
    document.body.append(outside);
    row('b')?.focus();
    flush();
    // Something takes the focus, while the rows are new and not drawn yet: that is no moved node.
    gantt.setTasks([...FLAT].reverse());
    outside.focus();
    expect(gantt.core.getSnapshot().focusedTask).toBeUndefined();
    flush();
    expect(document.activeElement).toBe(outside);

    row('a')?.focus();
    flush();
    row('a')?.blur();
    expect(gantt.core.getSnapshot().focusedTask).toBeUndefined();
  });
});

describe('createTaskList: selection.multiple', () => {
  const multiple = (more: Partial<Parameters<typeof createGantt>[1]> = {}): Fixture =>
    create({}, { selection: { multiple: true }, ...more });
  const selected = ({ gantt }: Fixture): readonly unknown[] =>
    gantt.core.getSnapshot().selection.tasks;
  const clickWith = (node: Element | null, init: MouseEventInit): void => {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  };

  it('FR-SEL-2: Ctrl or Cmd + click adds a row and takes it out; a plain click selects one', () => {
    const fixture = multiple();
    fixture.row('a')?.click();
    clickWith(fixture.row('g1'), { ctrlKey: true });
    clickWith(fixture.row('g2'), { metaKey: true });
    expect(selected(fixture)).toEqual(['a', 'g1', 'g2']);
    clickWith(fixture.row('g1'), { ctrlKey: true });
    expect(selected(fixture)).toEqual(['a', 'g2']);
    fixture.row('z')?.click();
    expect(selected(fixture)).toEqual(['z']);
  });

  it('FR-SEL-2: Ctrl or Cmd with Enter or Space adds a row and takes it out', () => {
    const fixture = multiple();
    fixture.row('a')?.focus();
    expect(press(fixture.row('a')!, 'Enter', { ctrlKey: true }).defaultPrevented).toBe(true);
    press(fixture.row('g1')!, ' ', { metaKey: true });
    expect(selected(fixture)).toEqual(['a', 'g1']);
    press(fixture.row('a')!, ' ', { ctrlKey: true });
    expect(selected(fixture)).toEqual(['g1']);
  });

  it('FR-SEL-2: other keys with Ctrl or Cmd stay the browser\u2019s', () => {
    const fixture = multiple();
    fixture.row('a')?.focus();
    expect(press(fixture.row('a')!, 'ArrowDown', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(fixture.row('a')!, 'Home', { metaKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(fixture.row('a'));
  });

  it('FR-SEL-2: off by default Ctrl + click selects one and Ctrl + Enter is left alone', () => {
    const fixture = create();
    fixture.row('a')?.click();
    clickWith(fixture.row('g1'), { ctrlKey: true });
    expect(selected(fixture)).toEqual(['g1']);
    expect(press(fixture.row('a')!, 'Enter', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(selected(fixture)).toEqual(['g1']);
  });

  it('FR-SEL-2: the grid says it is multiselectable only then, and follows the option', () => {
    const fixture = multiple();
    const grid = fixture.side.querySelector('[role="treegrid"]');
    expect(grid?.getAttribute('aria-multiselectable')).toBe('true');
    fixture.gantt.setOptions({ selection: { multiple: false } });
    fixture.flush();
    expect(grid?.hasAttribute('aria-multiselectable')).toBe(false);
    expect(create().side.querySelector('[aria-multiselectable]')).toBeNull();
  });
});

describe('createTaskList: the rows', () => {
  it('FR-ROW-6: a row for every row of the chart, at its height and place, with its tree state', () => {
    const { side, row, ids } = create();
    expect(ids()).toEqual(['a', 'g', 'g1', 'g2', 'z', 'n']);

    const root = side.querySelector<HTMLElement>('.gantt-task-list')!;
    expect(root.style.getPropertyValue('--gantt-task-list-row-height')).toBe('40px');
    expect(root.style.getPropertyValue('--gantt-task-list-header-height')).toBe('50px');
    expect(root.style.getPropertyValue('--gantt-task-list-rows-height')).toBe('240px');
    expect(root.style.getPropertyValue('--gantt-task-list-view-height')).toBe('150px');
    expect(row('g1')?.style.getPropertyValue('--gantt-task-list-y')).toBe('80px');

    expect(row('a')?.tabIndex).toBe(0);
    expect(row('g')?.tabIndex).toBe(-1);
    expect(row('g')?.getAttribute('role')).toBe('row');
    expect(row('g')?.getAttribute('aria-level')).toBe('1');
    expect(row('g')?.getAttribute('aria-expanded')).toBe('true');
    expect(row('g')?.getAttribute('aria-rowindex')).toBe('3');
    expect(row('g')?.getAttribute('aria-setsize')).toBe('4');
    expect(row('g')?.getAttribute('aria-posinset')).toBe('2');
    expect(row('g')?.hasAttribute('data-group')).toBe(true);
    expect(row('g2')?.getAttribute('aria-level')).toBe('2');
    expect(row('g2')?.getAttribute('aria-posinset')).toBe('2');
    expect(row('g2')?.hasAttribute('aria-expanded')).toBe(false);
    expect(row('g2')?.textContent).toBe('Child two');
    expect(row('n')?.hasAttribute('data-placeholder')).toBe(true);
    expect(row('z')?.classList.contains('late')).toBe(true);
  });

  it('FR-A11Y-1: a named treegrid of columns and rows, with a header', () => {
    const { side, gantt } = create();
    const grid = side.querySelector('[role="treegrid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('Tasks');
    expect(grid.getAttribute('aria-rowcount')).toBe('7');
    expect(grid.getAttribute('aria-colcount')).toBe('1');
    const header = side.querySelector('[role="columnheader"]')!;
    expect(header.textContent).toBe('Task');
    expect(header.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('1');
    gantt.collapse('g');
    expect(grid.getAttribute('aria-rowcount')).toBe('5');
  });

  it('FR-ROW-6: columns: text from value, nodes from render, widths and alignment', () => {
    const { row, side } = create({
      columns: [
        { id: 'p', header: 'Done', width: 50, align: 'end', value: (r) => `${r.record.progress}%` },
        { id: 'name', header: 'Name', tree: true },
        {
          id: 'badge',
          header: 'Badge',
          render: (r) => {
            const badge = document.createElement('b');
            badge.textContent = r.name[0] ?? '';
            return r.depth === 0 ? badge : null;
          },
          value: () => 'child',
        },
      ],
    });
    const cells = (id: string): (string | null | undefined)[] =>
      [...(row(id)?.children ?? [])].map((cell) => cell.textContent);
    expect(cells('a')).toEqual(['10%', 'Alpha', 'A']);
    expect(cells('g1')).toEqual(['0%', 'Child one', 'child']);
    expect(row('a')?.querySelector('b')).not.toBeNull();
    expect(row('a')?.children[0]?.getAttribute('data-align')).toBe('end');
    // The toggle is in the tree column, wherever that is.
    expect(row('a')?.children[1]?.querySelector('[data-toggle]')).not.toBeNull();
    expect(row('a')?.children[0]?.querySelector('[data-toggle]')).toBeNull();
    const root = side.querySelector<HTMLElement>('.gantt-task-list')!;
    expect(root.style.getPropertyValue('--gantt-task-list-columns')).toBe(
      '50px minmax(0, 1fr) 96px',
    );
    expect([...side.querySelectorAll('[role="columnheader"]')].map((n) => n.textContent)).toEqual([
      'Done',
      'Name',
      'Badge',
    ]);
  });

  it('FR-ROW-6: the list follows the data: a name and a date, without drawing other rows again', () => {
    const value = vi.fn((r: { readonly name: string }) => r.name);
    const { gantt, row } = create({ columns: [{ id: 'name', value }] });
    const calls = value.mock.calls.length;
    gantt.setTasks(TASKS.map((task) => (task.id === 'z' ? { ...task, name: 'Zed' } : task)));
    expect(row('z')?.textContent).toBe('Zed');
    expect(value.mock.calls.length).toBe(calls + 1);
  });

  it('FR-ROW-2: a group shut from anywhere leaves the list, and rows keep their nodes', () => {
    const { gantt, row, ids } = create();
    const zulu = row('z');
    gantt.collapse('g');
    expect(ids()).toEqual(['a', 'g', 'z', 'n']);
    expect(row('g')?.getAttribute('aria-expanded')).toBe('false');
    expect(row('z')).toBe(zulu);
    expect(row('z')?.style.getPropertyValue('--gantt-task-list-y')).toBe('80px');
    gantt.expandAll();
    expect(ids()).toEqual(['a', 'g', 'g1', 'g2', 'z', 'n']);
  });

  it('NFR-PERF-3: it draws the rows the chart draws, and the row with the tab stop', () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `T${String(i)}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    const { gantt, ids, flush } = create({}, { tasks });
    const window = gantt.getRowWindow();
    expect(ids()).toHaveLength(window.lastRow - window.firstRow + 1);
    gantt.scrollTo({ top: 20_000 });
    flush();
    const moved = gantt.getRowWindow();
    expect(moved.firstRow).toBeGreaterThan(400);
    // The window, and the first row, which is still the tab stop.
    expect(ids()).toHaveLength(moved.lastRow - moved.firstRow + 2);
    expect(ids()[0]).toBe('0');
  });

  it('FR-REACT-5: with no viewport yet the first rows are drawn all the same', () => {
    vi.restoreAllMocks();
    stubScrollerSize(0, 0);
    const tasks = Array.from({ length: 80 }, (_, i) => ({
      id: i,
      name: `T${String(i)}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    const { ids, side } = create({}, { tasks });
    expect(ids()).toHaveLength(50);
    const root = side.querySelector<HTMLElement>('.gantt-task-list')!;
    expect(root.style.getPropertyValue('--gantt-task-list-view-height')).toBe('');
  });
});

describe('createTaskList: selection, toggles and clicks', () => {
  it('FR-ROW-6: a click selects the task and scrolls to it, without moving what is in view', () => {
    const { gantt, row, flush } = create();
    row('z')?.click();
    flush();
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['z']);
    expect(row('z')?.getAttribute('aria-selected')).toBe('true');
    expect(row('a')?.getAttribute('aria-selected')).toBe('false');
    expect(gantt.core.getSnapshot().scrollRequest?.reason).toBe('scroll-to');
    expect(gantt.core.getSnapshot().scrollRequest?.left).toBeGreaterThan(0);
  });

  it('FR-ROW-2: the toggle opens and shuts the group and selects nothing', () => {
    const { gantt, row, ids } = create();
    toggleOf(row('g')).click();
    expect(ids()).toEqual(['a', 'g', 'z', 'n']);
    expect(gantt.core.getSnapshot().selection.tasks).toEqual([]);
    toggleOf(row('g')).click();
    expect(ids()).toContain('g1');
    // On a task without children it is part of the row.
    toggleOf(row('a')).click();
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['a']);
  });

  it('FR-EVT-3: onRowClick hears the record first, and preventDefault keeps the rest from happening', () => {
    const onRowClick = vi.fn();
    const onRowDoubleClick = vi.fn();
    const { gantt, row } = create({ onRowClick, onRowDoubleClick });
    row('a')?.click();
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]?.[0]).toBe(gantt.getTask('a'));
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['a']);

    onRowClick.mockImplementation((_record: unknown, event: Event) => {
      event.preventDefault();
    });
    row('z')?.click();
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['a']);

    row('a')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onRowDoubleClick.mock.calls[0]?.[0]).toBe(gantt.getTask('a'));
    toggleOf(row('g')).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onRowDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('FR-ROW-6: what is drawn in a cell keeps its own clicks and keys', () => {
    const { gantt, row } = create({
      columns: [
        { id: 'name' },
        {
          id: 'action',
          render: () => {
            const button = document.createElement('button');
            button.textContent = 'Open';
            return button;
          },
        },
      ],
    });
    const button = row('a')!.querySelector('button')!;
    button.click();
    expect(gantt.core.getSnapshot().selection.tasks).toEqual([]);
    expect(press(button, 'ArrowDown').defaultPrevented).toBe(false);
  });

  it('FR-SEL-2: the selection made anywhere shows in the list', () => {
    const { gantt, row } = create();
    gantt.select(['g1']);
    expect(row('g1')?.getAttribute('aria-selected')).toBe('true');
    // And moves the tab stop.
    expect(row('g1')?.tabIndex).toBe(0);
    expect(row('a')?.tabIndex).toBe(-1);
  });
});

describe('createTaskList: hover', () => {
  it('FR-ROW-6: the mouse on a row lights the chart, and the chart lights the list', () => {
    const { gantt, row, frames, chart } = create();
    const over = (target: Element, pointerType: string): void => {
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType }));
    };
    over(row('g1')!, 'mouse');
    frames.step();
    expect(gantt.core.getSnapshot().hoveredRow).toBe('g1');
    expect(row('g1')?.hasAttribute('data-hovered')).toBe(true);
    expect(
      chart.querySelector('.gantt__row[data-task-id="g1"]')?.hasAttribute('data-hovered'),
    ).toBe(true);

    row('g1')?.closest('.gantt-task-list__body')?.dispatchEvent(new PointerEvent('pointerleave'));
    frames.step();
    expect(gantt.core.getSnapshot().hoveredRow).toBeUndefined();
    expect(row('g1')?.hasAttribute('data-hovered')).toBe(false);

    // A touch lights nothing: it would stay lit under the finger.
    over(row('g1')!, 'touch');
    expect(gantt.core.getSnapshot().hoveredRow).toBeUndefined();

    gantt.setHoveredRow('z');
    expect(row('z')?.hasAttribute('data-hovered')).toBe(true);
  });

  it('FR-ROW-6: a list turns on the row hover of its chart while it is there, and only then', () => {
    const chartAlone = createContainer();
    const frames = createManualFrames();
    const alone = createGantt(chartAlone, { tasks: TASKS, renderer: { frames } });
    frames.step();
    expect(alone.getAppearance().rowHover).toBe(false);
    expect(chartAlone.querySelector('.gantt')?.hasAttribute('data-row-hover')).toBe(false);

    const { gantt, list, chart, flush } = create();
    flush();
    expect(gantt.getAppearance().rowHover).toBe(true);
    expect(chart.querySelector('.gantt')?.hasAttribute('data-row-hover')).toBe(true);
    list.destroy();
    flush();
    expect(gantt.getAppearance().rowHover).toBe(false);
    expect(chart.querySelector('.gantt')?.hasAttribute('data-row-hover')).toBe(false);
  });
});

describe('createTaskList: the keyboard', () => {
  it('FR-A11Y-2: one tab stop, and the arrows walk the rows', () => {
    const { side, row } = create();
    expect(side.querySelectorAll('[tabindex="0"]')).toHaveLength(2); // A row, and the splitter.
    row('a')?.focus();
    expect(press(row('a')!, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(row('g'));
    expect(row('g')?.tabIndex).toBe(0);
    expect(row('a')?.tabIndex).toBe(-1);
    press(row('g')!, 'ArrowUp');
    expect(document.activeElement).toBe(row('a'));
    press(row('a')!, 'End');
    expect(document.activeElement).toBe(row('n'));
    press(row('n')!, 'Home');
    expect(document.activeElement).toBe(row('a'));
    press(row('a')!, 'PageDown');
    expect(document.activeElement).toBe(row('g1'));
    press(row('g1')!, 'PageUp');
    expect(document.activeElement).toBe(row('a'));
  });

  it('FR-A11Y-2: Left and Right shut, open, step in and step out', () => {
    const { row, ids } = create();
    row('g')?.focus();
    press(row('g')!, 'ArrowLeft');
    expect(ids()).not.toContain('g1');
    expect(document.activeElement).toBe(row('g'));
    press(row('g')!, 'ArrowRight');
    expect(ids()).toContain('g1');
    expect(document.activeElement).toBe(row('g'));
    press(row('g')!, 'ArrowRight');
    expect(document.activeElement).toBe(row('g1'));
    press(row('g1')!, 'ArrowLeft');
    expect(document.activeElement).toBe(row('g'));
    // A task without children, or at the top: nothing to do, and the key is not taken.
    row('a')?.focus();
    expect(press(row('a')!, 'ArrowRight').defaultPrevented).toBe(false);
    expect(press(row('a')!, 'ArrowLeft').defaultPrevented).toBe(false);
  });

  it('FR-A11Y-2: Enter and Space activate; a key with a modifier, or another key, is not taken', () => {
    const onRowClick = vi.fn();
    const { gantt, row } = create({ onRowClick });
    row('z')?.focus();
    press(row('z')!, 'Enter');
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['z']);
    row('a')?.focus();
    expect(press(row('a')!, ' ').defaultPrevented).toBe(true);
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['a']);
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(press(row('a')!, 'ArrowDown', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(row('a')!, 'x').defaultPrevented).toBe(false);
  });

  it('FR-SEL-3: the row with the focus is the focused task, on both sides, and it clears on leaving', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const { gantt, row, chart, frames } = create();
    const seen: unknown[] = [];
    gantt.on('focusChange', (record) => seen.push(record?.id ?? null));

    row('g')?.focus();
    frames.step();
    expect(gantt.core.getSnapshot().focusedTask).toBe('g');
    expect(chart.querySelector('.gantt__row[data-task-id="g"]')?.hasAttribute('data-focused')).toBe(
      true,
    );

    outside.focus();
    expect(gantt.core.getSnapshot().focusedTask).toBeUndefined();
    expect(seen).toEqual(['g', null]);
    // The tab stop stays where the focus was.
    expect(row('g')?.tabIndex).toBe(0);

    gantt.focusTask('z');
    expect(document.activeElement).toBe(row('z'));
  });

  it('FR-SEL-3: the row with the focus stays in the document when it scrolls out of view', () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `T${String(i)}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    const { gantt, row, flush } = create({}, { tasks });
    row('1')?.focus();
    gantt.scrollTo({ top: 20_000 });
    flush();
    expect(row('1')).not.toBeNull();
    expect(document.activeElement).toBe(row('1'));
  });

  it('FR-SEL-3: a row that goes away with the focus hands it to the tab stop', () => {
    const { gantt, row } = create();
    row('g1')?.focus();
    expect(gantt.core.getSnapshot().focusedTask).toBe('g1');
    gantt.collapse('g');
    expect(gantt.core.getSnapshot().focusedTask).toBe('a');
    expect(document.activeElement).toBe(row('a'));
  });
});

describe('createTaskList: the cells', () => {
  const COLUMNS: TaskListOptions['columns'] = [
    { id: 'name' },
    { id: 'progress', header: '%', value: (r) => String(r.record.progress) },
    { id: 'more', header: 'More', value: () => 'x' },
  ];
  const cellsOn = (more: TaskListOptions = {}): Fixture =>
    create({ columns: COLUMNS, cellNavigation: true, ...more });
  const cell = ({ row }: Fixture, id: string, column: number): HTMLElement =>
    row(id)!.children[column] as HTMLElement;
  /** Where the focus is, as `row` or `row/column` (a column counts from 0). */
  const at = ({ side }: Fixture): string => {
    const active = document.activeElement as HTMLElement | null;
    const node = active?.closest<HTMLElement>('.gantt-task-list__row');
    if (!node || !side.contains(node)) return String(active?.tagName);
    const column = [...node.children].indexOf(active!);
    return column < 0 ? node.dataset.taskId! : `${node.dataset.taskId!}/${String(column)}`;
  };

  it('FR-A11Y-1: the cells and the headers say their column, and can be focused by script, only with the option on', () => {
    const off = create({ columns: COLUMNS });
    expect(off.side.querySelectorAll('[aria-colindex]')).toHaveLength(0);
    expect(off.row('a')?.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(off.side.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);

    const on = cellsOn();
    const index = (nodes: NodeListOf<Element>): (string | null)[] =>
      [...nodes].map((node) => node.getAttribute('aria-colindex'));
    expect(index(on.side.querySelectorAll('[role="columnheader"]'))).toEqual(['1', '2', '3']);
    expect(index(on.row('g')!.querySelectorAll('[role="gridcell"]'))).toEqual(['1', '2', '3']);
    expect(
      [...on.row('g')!.querySelectorAll('[role="gridcell"]')].map((node) =>
        node.getAttribute('tabindex'),
      ),
    ).toEqual(['-1', '-1', '-1']);
    // The headers are not for the keys; the rows are the one tab stop, and the splitter.
    expect(on.side.querySelectorAll('[role="columnheader"][tabindex]')).toHaveLength(0);
    expect(on.side.querySelectorAll('[tabindex="0"]')).toHaveLength(2);
    expect(on.row('a')?.getAttribute('tabindex')).toBe('0');
    expect(on.row('g')?.getAttribute('tabindex')).toBe('-1');
  });

  it('FR-A11Y-1: setOptions turns the cells on and off, also for rows drawn later', () => {
    const fixture = create({ columns: COLUMNS });
    const { list, row, side, gantt } = fixture;
    const focusable = (): number =>
      side.querySelectorAll('[role="gridcell"][tabindex="-1"]').length;
    const counted = (): number => side.querySelectorAll('[role="gridcell"]').length;
    expect(focusable()).toBe(0);
    const content = row('z')?.children[0];

    list.setOptions({ cellNavigation: true });
    expect(focusable()).toBe(counted());
    expect(side.querySelectorAll('[aria-colindex]')).toHaveLength(counted() + 3);
    // The cells were marked, not drawn again.
    expect(row('z')?.children[0]).toBe(content);

    gantt.collapse('g');
    gantt.expandAll();
    expect(focusable()).toBe(counted());

    list.setOptions({ cellNavigation: false });
    expect(focusable()).toBe(0);
    expect(side.querySelectorAll('[aria-colindex]')).toHaveLength(0);
    list.setOptions({ cellNavigation: true, columns: [{ id: 'name' }] });
    expect(side.querySelectorAll('[role="gridcell"][aria-colindex="1"]')).toHaveLength(counted());
    expect(side.querySelectorAll('[aria-colindex]')).toHaveLength(counted() + 1);
  });

  it('FR-A11Y-2: with the option off, Left and Right on a row are what they were, and no cell takes a key', () => {
    const fixture = create({ columns: COLUMNS });
    const { row, ids } = fixture;
    row('a')?.focus();
    expect(press(row('a')!, 'ArrowRight').defaultPrevented).toBe(false);
    expect(at(fixture)).toBe('a');
    row('g')?.focus();
    press(row('g')!, 'ArrowRight');
    expect(at(fixture)).toBe('g1');
    press(row('g1')!, 'ArrowLeft');
    expect(at(fixture)).toBe('g');
    press(row('g')!, 'ArrowLeft');
    expect(ids()).not.toContain('g1');
    // A cell is not what the key came from: nothing happens, and the key is the browser's.
    const name = cell(fixture, 'g', 0);
    expect(press(name, 'ArrowRight').defaultPrevented).toBe(false);
    expect(press(name, 'ArrowDown').defaultPrevented).toBe(false);
    expect(at(fixture)).toBe('g');
  });

  it('FR-A11Y-2: Right steps from a row into its first cell, Left back, and the row stays the tab stop', () => {
    const fixture = cellsOn();
    const { row, gantt } = fixture;
    row('a')?.focus();
    expect(press(row('a')!, 'ArrowRight').defaultPrevented).toBe(true);
    expect(at(fixture)).toBe('a/0');
    expect(gantt.core.getSnapshot().focusedTask).toBe('a');
    expect(row('a')?.tabIndex).toBe(0);
    expect(press(cell(fixture, 'a', 0), 'ArrowLeft').defaultPrevented).toBe(true);
    expect(at(fixture)).toBe('a');
    // On a row, Left is still the tree's: a task at the top has nowhere to go.
    expect(press(row('a')!, 'ArrowLeft').defaultPrevented).toBe(false);
  });

  it('FR-A11Y-2: on a group Right opens it first, then steps into its first cell; Left shuts it', () => {
    const fixture = cellsOn();
    const { row, ids, gantt } = fixture;
    gantt.collapse('g');
    row('g')?.focus();
    press(row('g')!, 'ArrowRight');
    expect(ids()).toContain('g1');
    expect(at(fixture)).toBe('g');
    press(row('g')!, 'ArrowRight');
    expect(at(fixture)).toBe('g/0');
    // The first cell is the tree's: Left shuts the group from there, and then goes back to the row.
    press(cell(fixture, 'g', 0), 'ArrowLeft');
    expect(ids()).not.toContain('g1');
    expect(at(fixture)).toBe('g/0');
    press(cell(fixture, 'g', 0), 'ArrowLeft');
    expect(at(fixture)).toBe('g');
    // On the row itself, Left shuts an open group, as without cells.
    press(row('g')!, 'ArrowRight');
    expect(ids()).toContain('g1');
    press(row('g')!, 'ArrowLeft');
    expect(ids()).not.toContain('g1');
    expect(at(fixture)).toBe('g');
    // And Left on a task steps out to its group, as without cells.
    gantt.expandAll();
    row('g1')?.focus();
    press(row('g1')!, 'ArrowLeft');
    expect(at(fixture)).toBe('g');
  });

  it('FR-A11Y-2: Right and Left walk the cells of a row and stay at its ends, keeping the key', () => {
    const fixture = cellsOn();
    const { row } = fixture;
    // The tree is the first column, and a task has nothing to open in it.
    row('a')?.focus();
    press(row('a')!, 'ArrowRight');
    press(cell(fixture, 'a', 0), 'ArrowRight');
    expect(at(fixture)).toBe('a/1');
    press(cell(fixture, 'a', 1), 'ArrowRight');
    expect(at(fixture)).toBe('a/2');
    expect(press(cell(fixture, 'a', 2), 'ArrowRight').defaultPrevented).toBe(true);
    expect(at(fixture)).toBe('a/2');
    press(cell(fixture, 'a', 2), 'ArrowLeft');
    press(cell(fixture, 'a', 1), 'ArrowLeft');
    expect(at(fixture)).toBe('a/0');
    // On the last cell of the last row nothing moves and nothing scrolls the box.
    cell(fixture, 'n', 2).focus();
    expect(press(cell(fixture, 'n', 2), 'ArrowDown').defaultPrevented).toBe(true);
    expect(at(fixture)).toBe('n/2');
  });

  it('FR-A11Y-2: Up and Down keep the column, and the focused task follows, with the tab stop', () => {
    const fixture = cellsOn();
    const { row, gantt } = fixture;
    cell(fixture, 'a', 1).focus();
    expect(gantt.core.getSnapshot().focusedTask).toBe('a');
    press(cell(fixture, 'a', 1), 'ArrowDown');
    expect(at(fixture)).toBe('g/1');
    expect(gantt.core.getSnapshot().focusedTask).toBe('g');
    expect(row('g')?.tabIndex).toBe(0);
    expect(row('a')?.tabIndex).toBe(-1);
    press(cell(fixture, 'g', 1), 'ArrowDown');
    press(cell(fixture, 'g1', 1), 'ArrowDown');
    expect(at(fixture)).toBe('g2/1');
    press(cell(fixture, 'g2', 1), 'ArrowUp');
    expect(at(fixture)).toBe('g1/1');
    // A row taken out of the list while the column is kept: the next one that is there.
    gantt.collapse('g');
    expect(at(fixture)).toBe('a');
    cell(fixture, 'g', 2).focus();
    press(cell(fixture, 'g', 2), 'ArrowDown');
    expect(at(fixture)).toBe('z/2');
  });

  it('FR-A11Y-2: Home and End go to the ends of the row, Ctrl or Cmd with them to the ends of the column', () => {
    const fixture = cellsOn();
    cell(fixture, 'g1', 1).focus();
    press(cell(fixture, 'g1', 1), 'End');
    expect(at(fixture)).toBe('g1/2');
    press(cell(fixture, 'g1', 2), 'Home');
    expect(at(fixture)).toBe('g1/0');
    cell(fixture, 'g1', 1).focus();
    expect(press(cell(fixture, 'g1', 1), 'End', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(at(fixture)).toBe('n/1');
    press(cell(fixture, 'n', 1), 'Home', { metaKey: true });
    expect(at(fixture)).toBe('a/1');
    // Other keys with Ctrl or Cmd are still the browser's, in a cell as on a row.
    expect(press(cell(fixture, 'a', 1), 'ArrowDown', { ctrlKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(press(cell(fixture, 'a', 1), 'ArrowRight', { metaKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(at(fixture)).toBe('a/1');
  });

  it('FR-A11Y-2: Page Down and Page Up move a page of rows in the same column', () => {
    const fixture = cellsOn();
    cell(fixture, 'a', 2).focus();
    press(cell(fixture, 'a', 2), 'PageDown');
    expect(at(fixture)).toBe('g1/2');
    press(cell(fixture, 'g1', 2), 'PageDown');
    press(cell(fixture, 'z', 2), 'PageDown');
    expect(at(fixture)).toBe('n/2');
    press(cell(fixture, 'n', 2), 'PageUp');
    expect(at(fixture)).toBe('g2/2');
  });

  it('FR-A11Y-2: Enter and Space on a cell activate its row, with Ctrl or Cmd adding it to the selection', () => {
    const onRowClick = vi.fn();
    const fixture = cellsOn({ onRowClick });
    const { gantt, row } = fixture;
    cell(fixture, 'z', 1).focus();
    expect(press(cell(fixture, 'z', 1), 'Enter').defaultPrevented).toBe(true);
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['z']);
    expect(onRowClick.mock.calls[0]?.[0]).toBe(gantt.getTask('z'));
    expect(at(fixture)).toBe('z/1');
    cell(fixture, 'a', 0).focus();
    press(cell(fixture, 'a', 0), ' ');
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['a']);
    expect(row('a')?.getAttribute('aria-selected')).toBe('true');
    // Without selection.multiple Ctrl + Enter is left alone, as on a row.
    expect(press(cell(fixture, 'g', 1), 'Enter', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('FR-SEL-2: with selection.multiple Ctrl or Cmd + Enter on a cell adds the row and takes it out', () => {
    const fixture = create(
      { columns: COLUMNS, cellNavigation: true },
      { selection: { multiple: true } },
    );
    const { gantt } = fixture;
    cell(fixture, 'a', 1).focus();
    press(cell(fixture, 'a', 1), 'Enter', { ctrlKey: true });
    cell(fixture, 'g1', 2).focus();
    press(cell(fixture, 'g1', 2), ' ', { metaKey: true });
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['a', 'g1']);
    press(cell(fixture, 'a', 1), 'Enter', { ctrlKey: true });
    expect(gantt.core.getSnapshot().selection.tasks).toEqual(['g1']);
  });

  it('FR-A11Y-2: in the column of the tree Left shuts a group and Right opens it before they move', () => {
    const fixture = cellsOn({
      columns: [{ id: 'progress', value: () => 'p' }, { id: 'name', tree: true }, { id: 'more' }],
    });
    const { row, ids, gantt } = fixture;
    cell(fixture, 'g', 1).focus();
    press(cell(fixture, 'g', 1), 'ArrowLeft');
    expect(ids()).not.toContain('g1');
    expect(at(fixture)).toBe('g/1');
    press(cell(fixture, 'g', 1), 'ArrowLeft');
    expect(at(fixture)).toBe('g/0');
    press(cell(fixture, 'g', 0), 'ArrowRight');
    expect(at(fixture)).toBe('g/1');
    press(cell(fixture, 'g', 1), 'ArrowRight');
    expect(ids()).toContain('g1');
    expect(at(fixture)).toBe('g/1');
    press(cell(fixture, 'g', 1), 'ArrowRight');
    expect(at(fixture)).toBe('g/2');
    // Another column does not change a group, nor does a task have anything to open.
    press(cell(fixture, 'g', 2), 'ArrowLeft');
    gantt.collapse('g');
    cell(fixture, 'g', 0).focus();
    press(cell(fixture, 'g', 0), 'ArrowRight');
    expect(ids()).not.toContain('g1');
    expect(row('g')?.getAttribute('aria-expanded')).toBe('false');
    expect(at(fixture)).toBe('g/1');
  });

  it('FR-A11Y-2: what is drawn in a cell keeps its own keys, and its focus', () => {
    const fixture = cellsOn({
      columns: [
        { id: 'name' },
        {
          id: 'edit',
          render: () => {
            const input = document.createElement('input');
            input.className = 'edit';
            return input;
          },
        },
      ],
    });
    const { row, gantt } = fixture;
    const input = row('g')!.querySelector<HTMLInputElement>('.edit')!;
    input.focus();
    expect(gantt.core.getSnapshot().focusedTask).toBe('g');
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'Home', 'End', 'Enter', ' ']) {
      expect(press(input, key).defaultPrevented).toBe(false);
    }
    expect(press(input, 'End', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(gantt.core.getSnapshot().selection.tasks).toEqual([]);
    // A redraw does not take the focus from it.
    gantt.setHoveredRow('z');
    fixture.flush();
    expect(document.activeElement).toBe(input);
  });

  it('FR-A11Y-2: a cell with the focus keeps it across a redraw of the rows', () => {
    const fixture = cellsOn();
    const { gantt, flush } = fixture;
    cell(fixture, 'g1', 1).focus();
    gantt.setHoveredRow('z');
    gantt.select(['n']);
    flush();
    gantt.setTasks(TASKS.map((task) => (task.id === 'g1' ? { ...task, name: 'Renamed' } : task)));
    flush();
    expect(at(fixture)).toBe('g1/1');
    gantt.scrollTo({ top: 10 });
    flush();
    expect(at(fixture)).toBe('g1/1');
  });

  it('FR-A11Y-2: a focusTask from elsewhere brings the focus to the row, not to the cell of the column before', () => {
    const fixture = cellsOn();
    const { gantt, flush } = fixture;
    cell(fixture, 'a', 2).focus();
    gantt.focusTask('z');
    flush();
    expect(at(fixture)).toBe('z');
    // The list forgets the column when the focus leaves it.
    cell(fixture, 'g', 1).focus();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(gantt.core.getSnapshot().focusedTask).toBeUndefined();
    gantt.focusTask('g2');
    flush();
    expect(at(fixture)).toBe('g2');
    press(fixture.row('g2')!, 'ArrowRight');
    expect(at(fixture)).toBe('g2/0');
  });

  it('FR-A11Y-2: the focus can go to a cell by script or by pointer, and the keys go on from there', () => {
    const fixture = cellsOn();
    const { gantt } = fixture;
    cell(fixture, 'g2', 2).focus();
    expect(gantt.core.getSnapshot().focusedTask).toBe('g2');
    expect(fixture.row('g2')?.tabIndex).toBe(0);
    press(cell(fixture, 'g2', 2), 'ArrowUp');
    expect(at(fixture)).toBe('g1/2');
  });

  it('FR-A11Y-2: a row that a sort moves keeps the focus in its cell', () => {
    // What Chromium does when a sort moves the node of the focused row: `focusout`, nothing to
    // take it, and the focus on the body. Happy DOM keeps the focus on a moved node, so it is sent here.
    const fixture = cellsOn();
    const { gantt, row, flush } = fixture;
    const heard: unknown[] = [];
    gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    const flat = TASKS.filter((task) => task.parentId === undefined);
    gantt.setTasks(flat);
    flush();
    const moved = row('z')!;
    const target = cell(fixture, 'z', 2);
    target.focus();
    flush();
    const box = moved.parentElement!;
    const original = box.insertBefore.bind(box);
    vi.spyOn(box, 'insertBefore').mockImplementation((node: Node, before: Node | null) => {
      if (node === moved) target.blur();
      return original(node, before);
    });
    gantt.setTasks([...flat].reverse());
    flush();
    expect(fixture.ids()[0]).toBe('n');
    expect(document.activeElement).toBe(target);
    expect(gantt.core.getSnapshot().focusedTask).toBe('z');
    expect(heard).toEqual(['z']);
  });

  it('FR-A11Y-2: a row that goes away with the focus in its cell hands it to the tab stop', () => {
    const fixture = cellsOn();
    const { gantt, flush } = fixture;
    cell(fixture, 'g1', 2).focus();
    gantt.collapse('g');
    flush();
    expect(gantt.core.getSnapshot().focusedTask).toBe('a');
    expect(at(fixture)).toBe('a');
  });

  it('FR-A11Y-2: a bar that holds the focus keeps it, with the cells on', () => {
    const fixture = create(
      { columns: COLUMNS, cellNavigation: true },
      { keyboard: { barFocus: true } },
    );
    const { chart, gantt, flush } = fixture;
    const bar = chart.querySelector<SVGElement>('.gantt__bar[data-task-id="g"]')!;
    bar.focus();
    flush();
    expect(document.activeElement).toBe(bar);
    expect(gantt.core.getSnapshot().focusedTask).toBe('g');
    cell(fixture, 'a', 1).focus();
    press(cell(fixture, 'a', 1), 'ArrowDown');
    flush();
    expect(at(fixture)).toBe('g/1');
  });

  it('FR-A11Y-2: destroy leaves no listener behind, with the cells on', () => {
    const fixture = cellsOn();
    cell(fixture, 'a', 1).focus();
    fixture.list.destroy();
    fixture.gantt.destroy();
    expect(tracker.alive()).toEqual([]);
  });
});

describe('createTaskList: scrolling with a chart of its own height', () => {
  it('FR-ROW-6: the chart scrolling moves the list in the same task', () => {
    const { gantt, body } = create(
      {},
      { layout: { rowHeight: 40, headerRowHeight: 25, height: 200 } },
    );
    const write = vi.spyOn(body, 'scrollTo');
    gantt.core.scroll({ left: 0, top: 70 });
    expect(write).toHaveBeenCalledWith({ top: 70, behavior: 'instant' });
  });

  it('FR-ROW-6: the list scrolling moves the chart, and what the chart answers does not fight it', () => {
    const { gantt, body, flush } = create();
    const write = vi.spyOn(body, 'scrollTo');
    body.scrollTop = 60;
    body.dispatchEvent(new Event('scroll'));
    expect(gantt.core.getSnapshot().scrollRequest).toMatchObject({ top: 60, behavior: 'instant' });
    expect(gantt.core.getSnapshot().scrollTop).toBe(60);
    flush();

    // The list has gone on (a fling) while the chart reports where it was a frame ago.
    body.scrollTop = 80;
    body.dispatchEvent(new Event('scroll'));
    gantt.core.scroll({ left: 0, top: 60 });
    expect(write).not.toHaveBeenCalled();

    // Later, the chart moving is news again.
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    gantt.core.scroll({ left: 0, top: 30 });
    expect(write).toHaveBeenCalledWith({ top: 30, behavior: 'instant' });
  });

  it('FR-ROW-6: a change of the chart that is no scroll leaves the list where it has scrolled to', () => {
    const { gantt, body } = create();
    const write = vi.spyOn(body, 'scrollTo');
    // The list has moved, and its scroll event is still to come, when a hover is published: the
    // browser reports one as soon as rows move under a still pointer.
    body.scrollTop = 60;
    gantt.setHoveredRow('g1');
    expect(write).not.toHaveBeenCalled();
    expect(body.scrollTop).toBe(60);
    body.dispatchEvent(new Event('scroll'));
    expect(gantt.core.getSnapshot().scrollTop).toBe(60);
  });

  it('FR-ROW-6: a list made for a chart that has already scrolled starts where the chart is', () => {
    const frames = createManualFrames();
    const chart = createContainer();
    const gantt = createGantt(chart, {
      tasks: TASKS,
      layout: { rowHeight: 40, headerRowHeight: 25, height: 200 },
      renderer: { frames },
    });
    gantt.core.scroll({ left: 0, top: 70 });
    const write = vi.spyOn(HTMLElement.prototype, 'scrollTo');
    createTaskList(createContainer(), gantt);
    expect(write).toHaveBeenCalledWith({ top: 70, behavior: 'instant' });
  });

  it('FR-ROW-6: the scroll event of what the list was told to do is no news to the chart', () => {
    const { gantt, body } = create();
    gantt.core.scroll({ left: 0, top: 30 });
    body.scrollTop = 30;
    const requests = gantt.core.getSnapshot().scrollRequest;
    body.dispatchEvent(new Event('scroll'));
    expect(gantt.core.getSnapshot().scrollRequest).toBe(requests);
  });

  it('FR-ROW-5: the view of the list is the rows the chart shows, whatever its own box is', () => {
    const { side, gantt } = create();
    gantt.core.setViewport({ width: 600, height: 185 }); // A sideways scrollbar took 15 px.
    const root = side.querySelector<HTMLElement>('.gantt-task-list')!;
    expect(root.style.getPropertyValue('--gantt-task-list-view-height')).toBe('135px');
  });
});

describe('createTaskList: a chart of automatic height', () => {
  it('FR-SCROLL-3: one box scrolls both: the list writes and sends nothing', () => {
    const { side, gantt, body } = create({}, { layout: { rowHeight: 40, height: 'auto' } });
    expect(side.querySelector('.gantt-task-list')?.getAttribute('data-height')).toBe('auto');
    const write = vi.spyOn(body, 'scrollTo');
    const before = gantt.core.getSnapshot().scrollRequest;
    gantt.core.scroll({ left: 0, top: 70 });
    expect(write).not.toHaveBeenCalled();
    body.scrollTop = 50;
    body.dispatchEvent(new Event('scroll'));
    expect(gantt.core.getSnapshot().scrollRequest).toBe(before);
  });

  it('FR-SCROLL-3: it follows a change of the height at runtime', () => {
    const { side, gantt } = create();
    const root = side.querySelector('.gantt-task-list');
    expect(root?.hasAttribute('data-height')).toBe(false);
    gantt.setOptions({ layout: { height: 'auto' } });
    expect(root?.getAttribute('data-height')).toBe('auto');
    gantt.setOptions({ layout: { height: 300 } });
    expect(root?.hasAttribute('data-height')).toBe(false);
  });
});

describe('createTaskList: appearance', () => {
  it('FR-THEME-2: it has the tokens and the theme of the chart, and follows them', () => {
    const { side, gantt } = create({}, { theme: 'dark' });
    const root = side.querySelector('.gantt-task-list');
    expect(root?.classList.contains('gantt-scope')).toBe(true);
    expect(root?.getAttribute('data-theme')).toBe('dark');
    gantt.setOptions({ theme: 'light' });
    expect(root?.getAttribute('data-theme')).toBe('light');
  });

  it('FR-THEME-2: its own theme wins', () => {
    const { side, list, gantt } = create({ theme: 'dark' }, { theme: 'light' });
    const root = side.querySelector('.gantt-task-list');
    expect(root?.getAttribute('data-theme')).toBe('dark');
    gantt.setOptions({ theme: 'auto' });
    expect(root?.getAttribute('data-theme')).toBe('dark');
    list.setOptions({ theme: undefined });
    expect(root?.getAttribute('data-theme')).toBe('auto');
  });

  it('FR-ROW-4: the stripes are the chart’s, row or group', () => {
    const { row, gantt } = create({}, { display: { rowStripes: 'group' } });
    // The roots alternate, a group with its children.
    expect(row('g')?.hasAttribute('data-stripe')).toBe(true);
    expect(row('g1')?.hasAttribute('data-stripe')).toBe(true);
    expect(row('a')?.hasAttribute('data-stripe')).toBe(false);
    gantt.setOptions({ display: { rowStripes: 'row' } });
    expect(row('g1')?.hasAttribute('data-stripe')).toBe(false);
    expect(row('g2')?.hasAttribute('data-stripe')).toBe(true);
    gantt.setOptions({ display: { rowStripes: false } });
    expect(row('g2')?.hasAttribute('data-stripe')).toBe(false);
  });

  it('FR-ROW-5: the sizes are the chart’s, also when they change', () => {
    const { side, row, gantt } = create();
    gantt.setOptions({ layout: { rowHeight: 30, headerRowHeight: 20 } });
    const root = side.querySelector<HTMLElement>('.gantt-task-list')!;
    expect(root.style.getPropertyValue('--gantt-task-list-row-height')).toBe('30px');
    expect(root.style.getPropertyValue('--gantt-task-list-header-height')).toBe('40px');
    expect(row('g1')?.style.getPropertyValue('--gantt-task-list-y')).toBe('60px');
  });
});

describe('createTaskList: the splitter', () => {
  const splitterOf = (side: HTMLElement): HTMLElement =>
    side.querySelector<HTMLElement>('.gantt-task-list__splitter')!;

  it('FR-ROW-6: the pointer drags the width, between its limits, and tells who asked', () => {
    const onWidthChange = vi.fn();
    const { side, list } = create({ width: 300, minWidth: 200, maxWidth: 400, onWidthChange });
    const splitter = splitterOf(side);
    splitter.setPointerCapture = vi.fn();
    const send = (type: string, clientX: number): void => {
      splitter.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          button: 0,
          pointerId: 1,
        }),
      );
    };
    send('pointermove', 900);
    expect(list.getWidth()).toBe(300);
    send('pointerdown', 500);
    expect(splitter.hasAttribute('data-resizing')).toBe(true);
    send('pointermove', 550);
    expect(list.getWidth()).toBe(350);
    expect(onWidthChange).toHaveBeenLastCalledWith(350);
    send('pointermove', 900);
    expect(list.getWidth()).toBe(400);
    send('pointermove', 0);
    expect(list.getWidth()).toBe(200);
    send('pointerup', 0);
    expect(splitter.hasAttribute('data-resizing')).toBe(false);
    send('pointermove', 900);
    expect(list.getWidth()).toBe(200);
    const root = side.querySelector<HTMLElement>('.gantt-task-list')!;
    expect(root.style.getPropertyValue('--gantt-task-list-width')).toBe('200px');
    expect(splitter.getAttribute('aria-valuenow')).toBe('200');
  });

  it('FR-A11Y-2: it is a separator the keys move', () => {
    const { side, list } = create({ width: 300, minWidth: 200, maxWidth: 400 });
    const splitter = splitterOf(side);
    expect(splitter.getAttribute('role')).toBe('separator');
    expect(splitter.getAttribute('aria-orientation')).toBe('vertical');
    expect(splitter.getAttribute('aria-label')).toBe('Resize the task list');
    expect(splitter.getAttribute('aria-valuemin')).toBe('200');
    expect(splitter.getAttribute('aria-valuemax')).toBe('400');
    expect(press(splitter, 'ArrowRight').defaultPrevented).toBe(true);
    expect(list.getWidth()).toBe(316);
    press(splitter, 'ArrowLeft');
    expect(list.getWidth()).toBe(300);
    press(splitter, 'End');
    expect(list.getWidth()).toBe(400);
    press(splitter, 'Home');
    expect(list.getWidth()).toBe(200);
    expect(press(splitter, 'x').defaultPrevented).toBe(false);
  });

  it('FR-ROW-6: splitter: false hides it; setWidth and setOptions keep to the limits', () => {
    const { side, list } = create({ splitter: false, maxWidth: 400 });
    expect(splitterOf(side).hidden).toBe(true);
    list.setWidth(1000);
    expect(list.getWidth()).toBe(400);
    list.setOptions({ splitter: true, maxWidth: 350 });
    expect(splitterOf(side).hidden).toBe(false);
    expect(list.getWidth()).toBe(350);
    list.setOptions({ width: undefined, maxWidth: undefined });
    expect(list.getWidth()).toBe(280);
  });
});

describe('createTaskList: its options and its end', () => {
  it('FR-I18N-2: its text can be yours, and changed', () => {
    const { side, list } = create({ strings: { label: 'Завдання', name: 'Назва' } });
    expect(side.querySelector('[role="treegrid"]')?.getAttribute('aria-label')).toBe('Завдання');
    expect(side.querySelector('[role="columnheader"]')?.textContent).toBe('Назва');
    list.setOptions({ strings: { resize: 'Розмір' } });
    expect(side.querySelector('[role="separator"]')?.getAttribute('aria-label')).toBe('Розмір');
    expect(side.querySelector('[role="columnheader"]')?.textContent).toBe('Task');
  });

  it('FR-ROW-6: setOptions changes the columns and handlers; a handler in use is the latest', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { list, row } = create({ onRowClick: first });
    list.setOptions({
      onRowClick: second,
      columns: [{ id: 'id', value: (r) => String(r.id) }],
      indent: 8,
    });
    expect(row('a')?.textContent).toBe('a');
    row('a')?.click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(list.element.style.getPropertyValue('--gantt-task-list-indent')).toBe('8px');
    list.setOptions({ columns: [] });
    expect(row('a')?.textContent).toBe('Alpha');
  });

  it('FR-API-1: createTaskList takes an element, and says what it got instead', () => {
    const frames = createManualFrames();
    const gantt = createGantt(createContainer(), { tasks: TASKS, renderer: { frames } });
    expect(() => createTaskList(null as unknown as HTMLElement, gantt)).toThrow(TypeError);
  });

  it('FR-API-4: destroy leaves nothing behind, in the page or on the chart, and can be called twice', () => {
    const { gantt, list, side, row, flush } = create();
    row('a')?.focus();
    gantt.setHoveredRow('z');
    const before = gantt.core.getSnapshot();
    expect(before.focusedTask).toBe('a');
    list.destroy();
    list.destroy();
    flush();
    expect(countNodes(side)).toBe(0);
    expect(gantt.core.getSnapshot().hoveredRow).toBeUndefined();
    expect(gantt.core.getSnapshot().focusedTask).toBeUndefined();
    list.setOptions({ width: 400 });
    list.setWidth(500);
    expect(list.getWidth()).toBe(280);
    gantt.collapse('g');
    expect(countNodes(side)).toBe(0);
    gantt.destroy();
    expect(tracker.alive()).toEqual([]);
  });

  it('FR-API-4: a chart destroyed first leaves a list that can still be destroyed', () => {
    const { gantt, list, side } = create();
    gantt.destroy();
    list.destroy();
    expect(countNodes(side)).toBe(0);
  });
});
