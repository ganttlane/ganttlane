import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChart, createGantt, type Gantt } from './create-gantt';
import type { GanttOptions } from './options';
import {
  createContainer,
  createManualFrames,
  type ListenerTracker,
  type ManualFrames,
  stubScrollerSize,
  trackListeners,
} from './testing';

// Rows of 40 px under a header of 50 px, in a chart 200 px tall: 150 px of rows are in view.
const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'n', name: 'No dates', type: 'placeholder' as const },
  { id: 'g', name: 'Group', start: '2026-03-09', end: '2026-03-20' },
  { id: 'g1', name: 'Child one', parentId: 'g', start: '2026-03-09', end: '2026-03-11' },
  { id: 'g2', name: 'Child two', parentId: 'g', start: '2026-03-12', end: '2026-03-13' },
  { id: 'c', name: 'Charlie', start: '2026-03-16', end: '2026-03-18' },
  { id: 'd', name: 'Delta', start: '2026-03-16', end: '2026-03-18' },
  { id: 'e', name: 'Echo', start: '2026-03-16', end: '2026-03-18' },
  { id: 'z', name: 'Zulu', start: '2026-09-01', end: '2026-09-04' },
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
  readonly frames: ManualFrames;
  readonly chart: HTMLElement;
  readonly bar: (id: string) => SVGElement | null;
  readonly bars: () => (string | null)[];
  readonly stops: () => (string | null)[];
}

// Enough rows for the first ones to leave the window, overscan included.
const MANY = Array.from({ length: 60 }, (_, index) => ({
  id: `t${String(index)}`,
  name: `Task ${String(index)}`,
  start: '2026-03-02',
  end: '2026-03-06',
}));

const OPTIONS = {
  tasks: TASKS,
  calendar: { weekends: [] },
  scroll: { initial: 'start', behavior: 'instant' },
  layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25 },
} satisfies Partial<GanttOptions>;

function create(options: Partial<GanttOptions> = { keyboard: { barFocus: true } }): Fixture {
  const frames = createManualFrames();
  const chart = createContainer();
  const gantt = createGantt(chart, { ...OPTIONS, renderer: { frames }, ...options });
  frames.step();
  const all = (): SVGElement[] => [...chart.querySelectorAll<SVGElement>('.gantt__bar')];
  return {
    gantt,
    frames,
    chart,
    bar: (id) => all().find((node) => node.getAttribute('data-task-id') === id) ?? null,
    bars: () => all().map((node) => node.getAttribute('data-task-id')),
    stops: () =>
      all()
        .filter((node) => node.getAttribute('tabindex') === '0')
        .map((node) => node.getAttribute('data-task-id')),
  };
}

const press = (target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const focused = (fixture: Fixture): unknown => fixture.gantt.core.getSnapshot().focusedTask;
const active = (): string | null | undefined =>
  document.activeElement?.getAttribute('data-task-id');

describe('keyboard.barFocus: off by default', () => {
  it('FR-SEL-3: bars have no tab stop, no role and no name, and nothing listens for the keys', () => {
    const fixture = create({});
    const bar = fixture.bar('a');
    for (const name of ['tabindex', 'role', 'aria-label', 'aria-pressed']) {
      expect(bar?.hasAttribute(name), name).toBe(false);
    }
    bar?.focus();
    expect(focused(fixture)).toBeUndefined();
    // The document hears the keys of a gesture (editing); nothing in the chart listens for them.
    const inChart = tracker.alive().filter(({ target }) => fixture.chart.contains(target as Node));
    expect(inChart.filter(({ type }) => /^(focusin|focusout|keydown)$/.test(type))).toEqual([]);
  });

  it('FR-SEL-3: focusBar does nothing, and a focusTask does not redraw the bars', () => {
    const fixture = create({});
    fixture.gantt.focusBar('a');
    expect(focused(fixture)).toBeUndefined();
    expect(active()).toBeFalsy();
    const before = fixture.bars();
    fixture.gantt.focusTask('z');
    fixture.frames.step();
    expect(fixture.bars()).toEqual(before);
  });

  it('FR-SEL-3: only keyboard.barFocus turns it on, not a display option of that name', () => {
    const fixture = create({ display: { barFocus: true } as never });
    expect(fixture.bar('a')?.hasAttribute('tabindex')).toBe(false);
  });
});

describe('keyboard.barFocus: the roving tabindex', () => {
  it('FR-SEL-3: one bar can be tabbed to, the first drawn until another has the focus', () => {
    const fixture = create();
    expect(fixture.stops()).toEqual(['a']);
    expect(fixture.bar('g')?.getAttribute('tabindex')).toBe('-1');
    fixture.bar('g')?.focus();
    fixture.frames.step();
    expect(fixture.stops()).toEqual(['g']);
    expect(fixture.bar('a')?.getAttribute('tabindex')).toBe('-1');
  });

  it('FR-SEL-3: a bar has a role and a name, and says whether it is selected', () => {
    const fixture = create();
    const bar = fixture.bar('a');
    expect(bar?.getAttribute('role')).toBe('button');
    expect(bar?.getAttribute('aria-label')).toBe('Alpha');
    expect(bar?.getAttribute('aria-pressed')).toBe('false');
    fixture.gantt.select(['a']);
    fixture.frames.step();
    expect(bar?.getAttribute('aria-pressed')).toBe('true');
  });

  it('FR-SEL-3: the focus of a bar is the focused task, and leaving says so once', () => {
    const fixture = create();
    const heard: unknown[] = [];
    fixture.gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    fixture.bar('a')?.focus();
    expect(focused(fixture)).toBe('a');
    fixture.bar('a')?.blur();
    expect(focused(fixture)).toBeUndefined();
    expect(heard).toEqual(['a', null]);
  });

  it('FR-SEL-3: going from bar to bar reports the new one and no gap', () => {
    const fixture = create();
    const heard: unknown[] = [];
    fixture.gantt.on('focusChange', (record) => heard.push(record?.id ?? null));
    fixture.bar('a')?.focus();
    press(fixture.bar('a')!, 'ArrowDown');
    expect(heard).toEqual(['a', 'g']);
  });

  it('FR-SEL-3: the tab stop falls back to what is drawn when the last one scrolled away', () => {
    const fixture = create({ tasks: MANY, keyboard: { barFocus: true } });
    fixture.bar('t1')?.focus();
    fixture.frames.step();
    fixture.bar('t1')?.blur();
    fixture.frames.step();
    expect(fixture.stops()).toEqual(['t1']);
    fixture.gantt.scrollTo({ top: 1000, behavior: 'instant' });
    fixture.frames.step();
    fixture.frames.step();
    expect(fixture.bars()).not.toContain('t1');
    expect(fixture.stops()).toHaveLength(1);
    expect(fixture.stops()[0]).toBe(fixture.bars()[0]);
  });

  it('FR-SEL-3: the focused bar stays drawn out of the window, in row order, while it has the focus', () => {
    const fixture = create({ tasks: MANY, keyboard: { barFocus: true } });
    fixture.bar('t1')?.focus();
    const node = fixture.bar('t1');
    fixture.gantt.scrollTo({ top: 1000, behavior: 'instant' });
    fixture.frames.step();
    fixture.frames.step();
    expect(fixture.bars()[0]).toBe('t1');
    expect(fixture.bars()[1]).toMatch(/^t\d\d$/);
    expect(fixture.bar('t1')).toBe(node);
    expect(active()).toBe('t1');
    fixture.bar('t1')?.blur();
    fixture.frames.step();
    expect(fixture.bars()).not.toContain('t1');
  });
});

describe('keyboard.barFocus: the keys', () => {
  const walk = (fixture: Fixture, from: string, key: string): KeyboardEvent => {
    fixture.bar(from)?.focus();
    return press(fixture.bar(from)!, key);
  };

  it('FR-SEL-3: Up and Down go to the bar of the next row, past a row without one', () => {
    const fixture = create();
    const event = walk(fixture, 'a', 'ArrowDown');
    expect(active()).toBe('g');
    expect(focused(fixture)).toBe('g');
    expect(event.defaultPrevented).toBe(true);
    walk(fixture, 'g', 'ArrowUp');
    expect(active()).toBe('a');
    expect(focused(fixture)).toBe('a');
  });

  it('FR-SEL-3: Home and End go to the first and the last bar, drawn or not', () => {
    const fixture = create();
    expect(fixture.bars()).not.toContain('z');
    walk(fixture, 'a', 'End');
    expect(active()).toBe('z');
    walk(fixture, 'z', 'Home');
    expect(active()).toBe('a');
  });

  it('FR-SEL-3: Page Down and Page Up go a page of rows and stop at the ends', () => {
    const fixture = create();
    // 150 px of rows at 40 px: 3 fit, so a page is 2.
    walk(fixture, 'a', 'PageDown');
    expect(active()).toBe('g');
    walk(fixture, 'g', 'PageDown');
    expect(active()).toBe('g2');
    walk(fixture, 'g2', 'PageUp');
    expect(active()).toBe('g');
    walk(fixture, 'g', 'PageUp');
    expect(active()).toBe('a');
    walk(fixture, 'a', 'PageUp');
    expect(active()).toBe('a');
  });

  it('FR-SEL-3: at the ends the keys stay on the bar and still do not scroll the box', () => {
    const fixture = create();
    expect(walk(fixture, 'a', 'ArrowUp').defaultPrevented).toBe(true);
    expect(active()).toBe('a');
    walk(fixture, 'a', 'End');
    expect(walk(fixture, 'z', 'ArrowDown').defaultPrevented).toBe(true);
    expect(active()).toBe('z');
  });

  it('FR-SEL-3: a move scrolls the bar into view at once', () => {
    const fixture = create();
    walk(fixture, 'a', 'End');
    const { scrollTop, timeline } = fixture.gantt.core.getSnapshot();
    expect(scrollTop).toBeGreaterThan(0);
    expect(timeline.scrollLeft).toBeGreaterThan(0);
  });

  it('FR-SEL-3: Left and Right stay the scroller’s, and a modifier leaves a key alone', () => {
    const fixture = create();
    fixture.bar('a')?.focus();
    const bar = fixture.bar('a')!;
    expect(press(bar, 'ArrowLeft').defaultPrevented).toBe(false);
    expect(press(bar, 'ArrowRight').defaultPrevented).toBe(false);
    for (const init of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      expect(press(bar, 'ArrowDown', init).defaultPrevented).toBe(false);
    }
    expect(active()).toBe('a');
  });

  it('FR-SEL-3: Enter and Space are a click: selection.onClick and taskClick follow', () => {
    const onTaskClick = vi.fn();
    const fixture = create({
      keyboard: { barFocus: true },
      selection: { onClick: true },
      onTaskClick,
    });
    fixture.bar('a')?.focus();
    const enter = press(fixture.bar('a')!, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(fixture.gantt.core.getSnapshot().selection.tasks).toEqual(['a']);
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0]?.[1]).toBe(enter);
    press(fixture.bar('a')!, ' ');
    expect(onTaskClick).toHaveBeenCalledTimes(2);
  });

  it('FR-SEL-2: Ctrl or Cmd with Enter or Space adds a task and takes it out', () => {
    const fixture = create({
      keyboard: { barFocus: true },
      selection: { onClick: true, multiple: true },
    });
    const { core } = fixture.gantt;
    press(fixture.bar('a')!, 'Enter');
    press(fixture.bar('g')!, 'Enter', { ctrlKey: true });
    press(fixture.bar('g1')!, ' ', { metaKey: true });
    expect(core.getSnapshot().selection.tasks).toEqual(['a', 'g', 'g1']);
    press(fixture.bar('g')!, ' ', { ctrlKey: true });
    expect(core.getSnapshot().selection.tasks).toEqual(['a', 'g1']);
  });

  it('FR-SEL-3: a held Enter clicks once', () => {
    const onTaskClick = vi.fn();
    const fixture = create({ keyboard: { barFocus: true }, onTaskClick });
    const bar = fixture.bar('a')!;
    press(bar, 'Enter');
    press(bar, 'Enter', { repeat: true });
    expect(onTaskClick).toHaveBeenCalledTimes(1);
  });

  it('FR-SEL-3: while a gesture runs the keys are the gesture’s', () => {
    const fixture = create();
    const { core } = fixture.gantt;
    fixture.bar('a')?.focus();
    const rect = core.getBarRect('a');
    const at = { pointerId: 1, x: (rect?.x ?? 0) + 8, y: (rect?.y ?? 0) + 8, time: 0 };
    core.send({ type: 'down', ...at });
    core.send({ type: 'move', ...at, x: at.x + 40, time: 1 });
    expect(core.getSnapshot().feedback.phase).not.toBe('idle');
    expect(press(fixture.bar('a')!, 'ArrowDown').defaultPrevented).toBe(false);
    expect(active()).toBe('a');
    core.send({ type: 'cancel' });
  });

  it('FR-SEL-3: keys typed into something drawn in a label are that thing’s', () => {
    const fixture = create();
    const inside = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    fixture.bar('a')?.append(inside);
    expect(press(inside, 'ArrowDown').defaultPrevented).toBe(false);
    expect(press(inside, 'Enter').defaultPrevented).toBe(false);
    expect(focused(fixture)).toBeUndefined();
  });
});

describe('keyboard.barFocus: focus from elsewhere and focus that is lost', () => {
  it('FR-SEL-3: focusTask moves the focus while a bar has it', () => {
    const fixture = create();
    fixture.bar('a')?.focus();
    fixture.gantt.focusTask('g1');
    fixture.frames.step();
    expect(active()).toBe('g1');
  });

  it('FR-SEL-3: focusTask does not take the focus from outside the chart', () => {
    const fixture = create();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    fixture.gantt.focusTask('g1');
    fixture.frames.step();
    expect(document.activeElement).toBe(button);
    expect(fixture.stops()).toEqual(['g1']);
  });

  it('FR-SEL-3: focusBar moves the focus from anywhere and scrolls to a bar not drawn', () => {
    const fixture = create();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(fixture.bars()).not.toContain('z');
    fixture.gantt.focusBar('z');
    expect(active()).toBe('z');
    expect(focused(fixture)).toBe('z');
    expect(fixture.gantt.core.getSnapshot().scrollTop).toBeGreaterThan(0);
  });

  it('FR-SEL-3: focusBar ignores a task without a bar and one without a visible row', () => {
    const fixture = create();
    fixture.gantt.collapse('g');
    fixture.frames.step();
    for (const id of ['n', 'g1', 'nobody']) {
      fixture.gantt.focusBar(id);
      expect(focused(fixture), id).toBeUndefined();
    }
    expect(active()).toBeFalsy();
  });

  it('FR-SEL-3: going to a bar of another chart lets go of the task here', () => {
    const fixture = create();
    const other = create({
      tasks: [{ id: 'other', name: 'Other', start: '2026-03-02', end: '2026-03-06' }],
      keyboard: { barFocus: true },
    });
    fixture.bar('a')?.focus();
    other.bar('other')?.focus();
    expect(focused(fixture)).toBeUndefined();
    expect(focused(other)).toBe('other');
  });

  it('FR-SEL-3: a bar that goes away with its row hands the focus to the tab stop', () => {
    const fixture = create();
    fixture.bar('g1')?.focus();
    fixture.gantt.collapse('g');
    fixture.frames.step();
    expect(fixture.bar('g1')).toBeNull();
    expect(active()).toBe(fixture.stops()[0]);
    expect(focused(fixture)).toBe(fixture.stops()[0]);
  });

  it('FR-SEL-3: a bar whose task went away hands the focus on too', () => {
    const fixture = create();
    fixture.bar('a')?.focus();
    fixture.gantt.setTasks(TASKS.filter((task) => task.id !== 'a'));
    fixture.frames.step();
    expect(active()).toBe('g');
    expect(focused(fixture)).toBe('g');
  });

  it('FR-SEL-3: focus that left on purpose is not brought back when something is redrawn', () => {
    const fixture = create();
    fixture.bar('a')?.focus();
    fixture.bar('a')?.blur();
    fixture.gantt.collapse('g');
    fixture.frames.step();
    expect(active()).toBeFalsy();
  });
});

describe('keyboard.barFocus: the option', () => {
  it('FR-SEL-3: turned on and off at runtime, and off lets go of the focused task', () => {
    const fixture = create({});
    fixture.gantt.setOptions({ keyboard: { barFocus: true } });
    fixture.frames.step();
    expect(fixture.stops()).toEqual(['a']);
    fixture.bar('a')?.focus();
    expect(focused(fixture)).toBe('a');
    fixture.gantt.setOptions({ keyboard: { barFocus: false } });
    fixture.frames.step();
    expect(fixture.bar('a')?.hasAttribute('tabindex')).toBe(false);
    expect(fixture.bar('a')?.hasAttribute('role')).toBe(false);
    expect(focused(fixture)).toBeUndefined();
  });

  it('FR-SEL-3: the group is merged, and undefined puts its default back', () => {
    const fixture = create();
    fixture.gantt.setOptions({ keyboard: {} });
    fixture.frames.step();
    expect(fixture.stops()).toEqual(['a']);
    fixture.gantt.setOptions({ keyboard: undefined });
    fixture.frames.step();
    expect(fixture.stops()).toEqual([]);
  });

  it('FR-DATA-4: a value of the wrong kind is an issue with its path, and the default is used', () => {
    const fixture = create({ keyboard: { barFocus: 'yes' as unknown as boolean } });
    expect(fixture.gantt.getIssues().options).toContainEqual(
      expect.objectContaining({ code: 'invalid-option', path: 'keyboard.barFocus', value: 'yes' }),
    );
    expect(fixture.bar('a')?.hasAttribute('tabindex')).toBe(false);
  });

  it('FR-SEL-2: getAppearance says whether a list should add with Ctrl or Cmd', () => {
    const fixture = create({ selection: { onClick: true, multiple: true } });
    const heard = vi.fn();
    fixture.gantt.on('appearanceChange', heard);
    expect(fixture.gantt.getAppearance().multiSelect).toBe(true);
    fixture.gantt.setOptions({ selection: { clearOnEmptyClick: true } });
    expect(fixture.gantt.getAppearance().multiSelect).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    fixture.gantt.setOptions({ selection: { multiple: false } });
    expect(fixture.gantt.getAppearance().multiSelect).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    fixture.gantt.setOptions({ selection: { multiple: true } });
    fixture.gantt.setOptions({ selection: undefined });
    expect(fixture.gantt.getAppearance().multiSelect).toBe(false);
  });

  it('FR-API-3: destroying a chart leaves no listener behind', () => {
    const fixture = create();
    fixture.bar('a')?.focus();
    fixture.gantt.destroy();
    expect(tracker.alive()).toEqual([]);
  });

  it('FR-SEL-3: a renderer that is taken out lets go of the focused task, and a new one takes over', () => {
    const frames = createManualFrames();
    const chart = createChart({
      ...OPTIONS,
      keyboard: { barFocus: true },
      renderer: { frames },
    });
    const container = createContainer();
    chart.mount(container);
    frames.step();
    container.querySelector<SVGElement>('.gantt__bar')?.focus();
    expect(chart.gantt.core.getSnapshot().focusedTask).toBe('a');
    chart.unmount();
    expect(chart.gantt.core.getSnapshot().focusedTask).toBeUndefined();
    chart.gantt.focusBar('a');
    chart.mount(container);
    frames.step();
    expect(container.querySelectorAll('.gantt__bar[tabindex="0"]')).toHaveLength(1);
    chart.gantt.destroy();
  });
});
