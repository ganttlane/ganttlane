import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGantt, type Gantt } from './create-gantt';
import type { GanttOptions } from './options';
import {
  createContainer,
  createManualFrames,
  type ManualFrames,
  stubScrollerSize,
} from './testing';

// 2026-03-02 is a Monday; the weekend is Saturday and Sunday.
const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'Bravo', start: '2026-03-09', end: '2026-03-13' },
  { id: 'c', name: 'Charlie', start: '2026-03-16', end: '2026-03-17' },
  { id: 'f', name: 'Frozen', start: '2026-03-16', end: '2026-03-20', locked: true },
];

beforeEach(() => {
  vi.useFakeTimers();
  stubScrollerSize(800, 300);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Fixture {
  readonly gantt: Gantt;
  readonly frames: ManualFrames;
  readonly chart: HTMLElement;
  readonly bar: (id: string) => SVGElement;
  readonly live: () => string | undefined;
  readonly changes: unknown[];
}

function create(options: Partial<GanttOptions> = {}): Fixture {
  const frames = createManualFrames();
  const chart = createContainer();
  const changes: unknown[] = [];
  const gantt = createGantt(chart, {
    tasks: TASKS,
    links: [{ id: 'ab', source: 'a', target: 'b' }],
    calendar: { weekends: [0, 6] },
    scroll: { initial: 'start', behavior: 'instant' },
    layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25 },
    keyboard: { barFocus: true, edit: true },
    onTasksChange: (changeSet) => changes.push(changeSet.reason),
    renderer: { frames },
    ...options,
  });
  frames.step();
  return {
    gantt,
    frames,
    chart,
    changes,
    bar: (id) => {
      const found = chart.querySelector<SVGElement>(`.gantt__bar[data-task-id="${id}"]`);
      if (found === null) throw new Error(`no bar ${id}`);
      return found;
    },
    live: () => chart.querySelector('.gantt__live')?.textContent ?? undefined,
  };
}

const press = (target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

/** Lets the nudge settle (a commit is a few promise turns) and draws what it left. */
async function settle(fixture: Fixture): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  fixture.frames.step();
}

const iso = (date: Date | undefined): string => date?.toLocaleDateString('en-CA') ?? '';
const dates = (fixture: Fixture, id: string): string => {
  const task = fixture.gantt.getTask(id);
  return `${iso(task?.start)}/${iso(task?.end)}`;
};

describe('keyboard.edit: the arrow keys (FR-EDIT-9)', () => {
  it('FR-EDIT-9: Left and Right move the task one step, as one change of reason move', async () => {
    const fixture = create();
    const bar = fixture.bar('a');
    bar.focus();
    const event = press(bar, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    await settle(fixture);
    expect(dates(fixture, 'a')).toBe('2026-03-03/2026-03-07');
    // The successor follows, as it does for a drag.
    expect(fixture.gantt.getTask('b')?.start).toEqual(new Date(2026, 2, 10));
    expect(fixture.changes).toEqual(['move']);
    // Monday back one day skips the weekend, as a drag does.
    press(fixture.bar('a'), 'ArrowLeft');
    await settle(fixture);
    press(fixture.bar('a'), 'ArrowLeft');
    await settle(fixture);
    expect(iso(fixture.gantt.getTask('a')?.start)).toBe('2026-02-27');
  });

  it('FR-EDIT-9: Shift moves the end, Alt and Shift the start, never past one step', async () => {
    const fixture = create();
    fixture.bar('a').focus();
    press(fixture.bar('a'), 'ArrowRight', { shiftKey: true });
    await settle(fixture);
    expect(dates(fixture, 'a')).toBe('2026-03-02/2026-03-07');
    press(fixture.bar('a'), 'ArrowRight', { shiftKey: true, altKey: true });
    await settle(fixture);
    expect(dates(fixture, 'a')).toBe('2026-03-03/2026-03-07');
    expect(fixture.changes).toEqual(['resize-end', 'resize-start']);
    fixture.bar('c').focus();
    press(fixture.bar('c'), 'ArrowLeft', { shiftKey: true });
    await settle(fixture);
    expect(dates(fixture, 'c')).toBe('2026-03-16/2026-03-16');
    press(fixture.bar('c'), 'ArrowLeft', { shiftKey: true });
    await settle(fixture);
    expect(dates(fixture, 'c')).toBe('2026-03-16/2026-03-16');
  });

  it('FR-EDIT-7, FR-EDIT-9: a task that cannot be edited that way leaves the key to the scroller', async () => {
    const fixture = create();
    fixture.bar('f').focus();
    expect(press(fixture.bar('f'), 'ArrowRight').defaultPrevented).toBe(false);
    fixture.gantt.setOptions({ editing: { resize: false } });
    fixture.bar('a').focus();
    expect(press(fixture.bar('a'), 'ArrowRight', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(fixture.bar('a'), 'ArrowRight').defaultPrevented).toBe(true);
    await settle(fixture);
    fixture.gantt.setOptions({ editing: false });
    expect(press(fixture.bar('a'), 'ArrowRight').defaultPrevented).toBe(false);
    expect(dates(fixture, 'f')).toBe('2026-03-16/2026-03-20');
  });

  it('FR-EDIT-9: the keys the browser and the system own are left alone', () => {
    const fixture = create();
    const bar = fixture.bar('a');
    bar.focus();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(press(bar, 'ArrowRight', init).defaultPrevented).toBe(false);
    }
  });

  it('FR-EDIT-9: without keyboard.edit the arrows stay the scroller’s, and no region is added', () => {
    const fixture = create({ keyboard: { barFocus: true } });
    const bar = fixture.bar('a');
    bar.focus();
    expect(press(bar, 'ArrowRight').defaultPrevented).toBe(false);
    expect(fixture.chart.querySelector('.gantt__live')).toBeNull();
  });

  it('FR-EDIT-9: the keys do nothing while a gesture runs', () => {
    const fixture = create();
    const bar = fixture.bar('a');
    bar.focus();
    fixture.gantt.core.send({
      type: 'down',
      target: { kind: 'task', id: 'a', part: 'body' },
      x: 10,
      y: 10,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      time: 0,
    } as never);
    expect(press(bar, 'ArrowRight').defaultPrevented).toBe(false);
  });
});

describe('keyboard.announce: the live region (FR-A11Y-2)', () => {
  it('FR-A11Y-2: a keyboard change says the task, its new dates, its length and what it moved', async () => {
    const fixture = create();
    expect(fixture.live()).toBe('');
    fixture.bar('a').focus();
    press(fixture.bar('a'), 'ArrowRight');
    await settle(fixture);
    expect(fixture.live()).toBe(
      'Alpha, Mar 3, 2026 – Mar 7, 2026, 0% done · 4 working days; 1 other task changed',
    );
    expect(fixture.chart.querySelector('.gantt__live')?.getAttribute('role')).toBe('status');
  });

  it('FR-A11Y-2: a change that did not happen says so, with the same words twice told apart', async () => {
    const fixture = create({ onBeforeTaskChange: () => false });
    fixture.bar('a').focus();
    press(fixture.bar('a'), 'ArrowRight');
    await settle(fixture);
    const first = fixture.live();
    expect(first).toBe('Alpha was not changed');
    press(fixture.bar('a'), 'ArrowRight');
    await settle(fixture);
    expect(fixture.live()).not.toBe(first);
    expect(fixture.live()?.trim()).toBe(first);
  });

  it('FR-A11Y-2: the words and numbers follow the strings and the locale', async () => {
    const fixture = create({
      locale: 'uk',
      strings: {
        taskChanged: (summary, others) => `Змінено: ${summary} (${String(others)})`,
      },
    });
    fixture.bar('a').focus();
    press(fixture.bar('a'), 'ArrowRight');
    await settle(fixture);
    expect(fixture.live()).toMatch(/^Змінено: Alpha, .*2026.*\(1\)$/);
  });

  it('FR-A11Y-2: a selection made by select() is announced where a click does not select', () => {
    const fixture = create({ keyboard: { barFocus: true, announce: true } });
    expect(fixture.live()).toBe('');
    fixture.gantt.select(['a']);
    fixture.frames.step();
    expect(fixture.live()).toBe('Alpha selected');
    fixture.gantt.select(['a', 'b']);
    fixture.frames.step();
    expect(fixture.live()).toBe('2 tasks selected');
    fixture.gantt.clearSelection();
    fixture.frames.step();
    expect(fixture.live()).toBe('Selection cleared');
  });

  it('FR-A11Y-2: a bar that says it is pressed is not announced as well', () => {
    const fixture = create({
      keyboard: { barFocus: true, announce: true },
      selection: { onClick: true },
    });
    fixture.bar('a').focus();
    press(fixture.bar('a'), 'Enter');
    fixture.frames.step();
    expect(fixture.bar('a').getAttribute('aria-pressed')).toBe('true');
    expect(fixture.live()).toBe('');
    // A selection made from elsewhere is announced.
    fixture.gantt.select(['b']);
    fixture.frames.step();
    document.body.focus();
    fixture.gantt.select(['c']);
    fixture.frames.step();
    expect(fixture.live()).toBe('Charlie selected');
  });

  it('FR-A11Y-2: the region follows the option, and goes with the chart', () => {
    const fixture = create({ keyboard: { barFocus: true, announce: true } });
    expect(fixture.chart.querySelectorAll('.gantt__live')).toHaveLength(1);
    fixture.gantt.setOptions({ keyboard: { announce: false, edit: false } });
    fixture.frames.step();
    expect(fixture.chart.querySelector('.gantt__live')).toBeNull();
    fixture.gantt.setOptions({ keyboard: { announce: true } });
    fixture.frames.step();
    expect(fixture.chart.querySelectorAll('.gantt__live')).toHaveLength(1);
    fixture.gantt.destroy();
    expect(document.querySelector('.gantt__live')).toBeNull();
  });
});

describe('contextmenu: a press that opens a menu is no drag (FR-EDIT-1)', () => {
  it('FR-EDIT-1: a Ctrl + press that is followed by a context menu cancels the gesture', () => {
    const fixture = create({ keyboard: { barFocus: true } });
    const scroller = fixture.chart.querySelector('.gantt__scroller')!;
    const bar = fixture.bar('a').querySelector('.gantt__bar-track')!;
    const init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' };
    bar.dispatchEvent(
      new PointerEvent('pointerdown', { ...init, isPrimary: true, button: 0, ctrlKey: true }),
    );
    expect(fixture.gantt.core.getSnapshot().feedback.phase).toBe('pressed');
    scroller.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 0 }));
    expect(fixture.gantt.core.getSnapshot().feedback.phase).toBe('idle');
    // The menu closes, and the pointer moves with no button down: nothing drags.
    scroller.dispatchEvent(
      new PointerEvent('pointermove', { ...init, isPrimary: true, clientX: 120 }),
    );
    expect(fixture.gantt.core.getSnapshot().feedback.phase).toBe('idle');
    expect(fixture.changes).toEqual([]);
  });
});
