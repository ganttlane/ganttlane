import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGantt, type Gantt } from './create-gantt';
import { type HistoryKeysCore, mountHistoryKeys } from './history-keys';
import type { GanttOptions } from './options';
import { createContainer, createManualFrames, stubScrollerSize } from './testing';

// 2026-03-02 is a Monday.
const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'Bravo', start: '2026-03-09', end: '2026-03-13' },
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

function create(options: Partial<GanttOptions> = {}) {
  const frames = createManualFrames();
  const chart = createContainer();
  const gantt: Gantt = createGantt(chart, {
    tasks: TASKS,
    history: true,
    calendar: { weekends: [0, 6] },
    scroll: { initial: 'start', behavior: 'instant' },
    layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25 },
    keyboard: { barFocus: true, undo: true },
    renderer: { frames },
    ...options,
  });
  frames.step();
  const bar = (id: string): SVGElement =>
    chart.querySelector<SVGElement>(`.gantt__bar[data-task-id="${id}"]`)!;
  const scroller = chart.querySelector<HTMLElement>('.gantt__scroller')!;
  const live = (): string | undefined =>
    chart.querySelector('.gantt__live')?.textContent ?? undefined;
  return { gantt, frames, chart, bar, scroller, live };
}

const press = (target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const start = (gantt: Gantt, id: string): string =>
  gantt.getTask(id)?.start?.toLocaleDateString('en-CA') ?? '';

/** A task moved by `updateTask`, so that the history has one entry. */
function move(gantt: Gantt): void {
  void gantt.updateTask('a', { start: new Date(2026, 2, 3), end: new Date(2026, 2, 7) });
}

describe('keyboard.undo: Ctrl / Cmd + Z (FR-TX-5)', () => {
  it('FR-TX-5: Ctrl + Z undoes, Ctrl + Shift + Z and Ctrl + Y redo, on a bar and on the scroller', async () => {
    const { gantt, bar, scroller, frames } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    bar('a').focus();
    expect(press(bar('a'), 'z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(start(gantt, 'a')).toBe('2026-03-02');
    expect(press(bar('a'), 'Z', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    frames.step();
    press(scroller, 'z', { metaKey: true });
    expect(start(gantt, 'a')).toBe('2026-03-02');
    press(scroller, 'y', { ctrlKey: true });
    expect(start(gantt, 'a')).toBe('2026-03-03');
    gantt.destroy();
  });

  it('FR-TX-5: a Cyrillic layout is read from the physical key: Z undoes, Shift + Z and Y redo', async () => {
    const { gantt, bar } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    bar('a').focus();
    expect(press(bar('a'), 'я', { ctrlKey: true, code: 'KeyZ' }).defaultPrevented).toBe(true);
    expect(start(gantt, 'a')).toBe('2026-03-02');
    expect(
      press(bar('a'), 'Я', { ctrlKey: true, shiftKey: true, code: 'KeyZ' }).defaultPrevented,
    ).toBe(true);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    press(bar('a'), 'я', { metaKey: true, code: 'KeyZ' });
    expect(start(gantt, 'a')).toBe('2026-03-02');
    press(bar('a'), 'н', { ctrlKey: true, code: 'KeyY' });
    expect(start(gantt, 'a')).toBe('2026-03-03');
    gantt.destroy();
  });

  it('FR-TX-5: a Latin letter follows the print, not the physical key (Dvorak, AZERTY)', async () => {
    const { gantt, bar } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    bar('a').focus();
    // Dvorak: the physical KeyY types "f"; AZERTY: the physical KeyW types "z".
    expect(press(bar('a'), 'f', { ctrlKey: true, code: 'KeyY' }).defaultPrevented).toBe(false);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    expect(press(bar('a'), 'z', { ctrlKey: true, code: 'KeyW' }).defaultPrevented).toBe(true);
    expect(start(gantt, 'a')).toBe('2026-03-02');
    gantt.destroy();
  });

  it('FR-TX-5: a letter that is not Latin on a key that is not Z or Y does nothing', async () => {
    const { gantt, bar } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    bar('a').focus();
    expect(press(bar('a'), 'ф', { ctrlKey: true, code: 'KeyA' }).defaultPrevented).toBe(false);
    expect(press(bar('a'), 'я', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    gantt.destroy();
  });

  it('FR-TX-5: a symbol, an accented Latin letter or a named key on the Z / Y position is no combination', async () => {
    const { gantt, bar } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    bar('a').focus();
    // Dvorak types ";" and BÉPO "à" on the physical Z; "Copy" has the code "Copy".
    for (const [key, code] of [
      [';', 'KeyZ'],
      ['à', 'KeyZ'],
    ] as const) {
      expect(press(bar('a'), key, { ctrlKey: true, code }).defaultPrevented).toBe(false);
      expect(start(gantt, 'a')).toBe('2026-03-03');
    }
    press(bar('a'), 'z', { ctrlKey: true });
    expect(start(gantt, 'a')).toBe('2026-03-02');
    for (const [key, init] of [
      [':', { ctrlKey: true, shiftKey: true, code: 'KeyZ' }],
      ['Copy', { ctrlKey: true, code: 'Copy' }],
    ] as const) {
      expect(press(bar('a'), key, init).defaultPrevented).toBe(false);
      expect(start(gantt, 'a')).toBe('2026-03-02');
    }
    gantt.destroy();
  });

  it('FR-TX-5: Cmd + Y, Alt, a plain Z and Ctrl + Shift + Y are not the keys', async () => {
    const { gantt, bar } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    for (const [key, init] of [
      ['z', {}],
      ['z', { ctrlKey: true, altKey: true }],
      ['y', { metaKey: true }],
      ['y', { ctrlKey: true, shiftKey: true }],
      ['x', { ctrlKey: true }],
    ] as const) {
      expect(press(bar('a'), key, init).defaultPrevented).toBe(false);
    }
    expect(start(gantt, 'a')).toBe('2026-03-03');
    gantt.destroy();
  });

  it('FR-TX-5: nothing to undo, or no history, leaves the key to the browser', () => {
    const empty = create();
    expect(press(empty.bar('a'), 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(empty.bar('a'), 'y', { ctrlKey: true }).defaultPrevented).toBe(false);
    empty.gantt.destroy();
    const off = create({ history: false });
    expect(press(off.bar('a'), 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    off.gantt.destroy();
  });

  it('FR-TX-5: it is off by default, and setOptions turns it on and off', async () => {
    const { gantt, bar, frames } = create({ keyboard: { barFocus: true } });
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    expect(press(bar('a'), 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    gantt.setOptions({ keyboard: { undo: true } });
    frames.step();
    expect(press(bar('a'), 'z', { ctrlKey: true }).defaultPrevented).toBe(true);
    gantt.setOptions({ keyboard: { undo: false } });
    expect(press(bar('a'), 'y', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(start(gantt, 'a')).toBe('2026-03-02');
    gantt.destroy();
  });

  it('FR-TX-5: keys typed into something of a slot, or heard outside the chart, are not taken', async () => {
    const { gantt, chart, scroller, bar } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    const input = document.createElement('input');
    scroller.append(input);
    expect(press(input, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    // Something drawn in the label of a bar is that thing's, not the bar's.
    const inLabel = document.createElement('input');
    bar('a').append(inLabel);
    expect(press(inLabel, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    chart.append(editable);
    expect(press(editable, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(document.body, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    gantt.destroy();
  });

  it('FR-TX-5: a gesture in progress is not cancelled by the key', async () => {
    const { gantt, bar, scroller } = create();
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    bar('a')
      .querySelector('.gantt__bar-track')!
      .dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
        }),
      );
    expect(gantt.core.getSnapshot().feedback.phase).not.toBe('idle');
    expect(press(scroller, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(start(gantt, 'a')).toBe('2026-03-03');
    gantt.destroy();
  });

  it('FR-TX-5: a draft that waits to be applied is not undone under', () => {
    const scroller = document.createElement('div');
    const undo = vi.fn(() => ({ status: 'undone' }) as never);
    const core = {
      getSnapshot: () => ({ feedback: { phase: 'idle' }, state: { draft: {} } }) as never,
      undo,
      redo: undo,
    } satisfies HistoryKeysCore;
    const arm = mountHistoryKeys({
      core,
      scroller,
      signal: new AbortController().signal,
      enabled: () => true,
      announcer: { sync: vi.fn(), report: vi.fn(), reportHistory: vi.fn() },
    });
    arm();
    expect(press(scroller, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it('FR-TX-5: the listener is added when the option is first on, and goes with the signal', () => {
    const scroller = document.createElement('div');
    const abort = new AbortController();
    let enabled = false;
    const undo = vi.fn(() => ({ status: 'undone' }) as never);
    const core = {
      getSnapshot: () => ({ feedback: { phase: 'idle' }, state: { draft: undefined } }) as never,
      undo,
      redo: undo,
    } satisfies HistoryKeysCore;
    const add = vi.spyOn(scroller, 'addEventListener');
    const arm = mountHistoryKeys({
      core,
      scroller,
      signal: abort.signal,
      enabled: () => enabled,
      announcer: { sync: vi.fn(), report: vi.fn(), reportHistory: vi.fn() },
    });
    arm();
    expect(add).not.toHaveBeenCalled();
    enabled = true;
    arm();
    arm();
    expect(add).toHaveBeenCalledTimes(1);
    expect(press(scroller, 'z', { ctrlKey: true }).defaultPrevented).toBe(true);
    abort.abort();
    press(scroller, 'z', { ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('FR-TX-5, FR-A11Y-2: the result is said in the live region when the chart announces', async () => {
    const { gantt, bar, live } = create({
      keyboard: { barFocus: true, undo: true, announce: true },
    });
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    press(bar('a'), 'z', { ctrlKey: true });
    expect(live()).toMatch(/^Undone\. Alpha, /);
    expect(live()).toContain('Mar 2');
    press(bar('a'), 'y', { ctrlKey: true });
    expect(live()).toMatch(/^Redone\. Alpha, /);
    expect(live()).toContain('Mar 3');
    gantt.destroy();
  });

  it('FR-TX-5: a chart that does not announce has no live region, and the strings can be replaced', async () => {
    const quiet = create();
    move(quiet.gantt);
    await vi.advanceTimersByTimeAsync(0);
    press(quiet.bar('a'), 'z', { ctrlKey: true });
    expect(quiet.live()).toBeUndefined();
    quiet.gantt.destroy();
    const { gantt, bar, live } = create({
      keyboard: { barFocus: true, undo: true, announce: true },
      strings: { undone: (detail) => `back: ${detail}` },
    });
    move(gantt);
    await vi.advanceTimersByTimeAsync(0);
    press(bar('a'), 'z', { ctrlKey: true });
    expect(live()).toMatch(/^back: Alpha/);
    gantt.destroy();
  });

  it('FR-TX-5: an undo of a link says only that it was undone', async () => {
    const { gantt, bar, live } = create({
      links: [{ id: 'ab', source: 'a', target: 'b' }],
      keyboard: { barFocus: true, undo: true, announce: true },
    });
    void gantt.removeLink('ab');
    await vi.advanceTimersByTimeAsync(0);
    expect(gantt.canUndo).toBe(true);
    press(bar('a'), 'z', { ctrlKey: true });
    expect(live()).toBe('Undone');
    gantt.destroy();
  });
});
