import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import type { ManualFrames } from './testing';
import { cleanUpDocument, createManualFrames, renderInto, stubScrollerSize } from './testing';

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'Bravo', start: '2026-03-09', end: '2026-03-13' },
];
const NOW = (): string => '2026-03-04';

let frames: ManualFrames;

beforeEach(() => {
  frames = createManualFrames();
  vi.useFakeTimers();
  stubScrollerSize(800, 400);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

describe('<Gantt keyboard>: editing and announcements (FR-A11Y-1, FR-A11Y-2, FR-EDIT-9)', () => {
  it('FR-A11Y-1: a bar that takes the focus is named with its dates, progress and length', async () => {
    const view = await renderInto(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        keyboard={{ barFocus: true }}
        calendar={{ weekends: [0, 6] }}
      />,
    );
    const bar = view.container.querySelector('.gantt__bar[data-task-id="a"]');
    expect(bar?.getAttribute('aria-label')).toBe(
      'Alpha, Mar 2, 2026 – Mar 6, 2026, 10% done · 5 working days',
    );
    await view.unmount();
  });

  it('FR-A11Y-2: the live region follows the keyboard prop, and a field left out goes back to off', async () => {
    const props = { defaultTasks: TASKS, now: NOW, renderer: { frames } };
    const view = await renderInto(<Gantt {...props} keyboard={{ barFocus: true, edit: true }} />);
    expect(view.container.querySelectorAll('.gantt__live')).toHaveLength(1);
    expect(view.container.querySelector('.gantt__live')?.getAttribute('role')).toBe('status');

    await view.render(<Gantt {...props} keyboard={{ barFocus: true }} />);
    frames.step();
    expect(view.container.querySelector('.gantt__live')).toBeNull();

    await view.render(<Gantt {...props} keyboard={{ barFocus: true, announce: true }} />);
    frames.step();
    expect(view.container.querySelectorAll('.gantt__live')).toHaveLength(1);

    await view.render(<Gantt {...props} />);
    frames.step();
    expect(view.container.querySelector('.gantt__live')).toBeNull();
    expect(view.container.querySelector('.gantt__bar')?.hasAttribute('tabindex')).toBe(false);
    await view.unmount();
  });

  it('FR-EDIT-9: the arrow keys edit the focused bar and the chart reports the move', async () => {
    const changes: string[] = [];
    const view = await renderInto(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        keyboard={{ barFocus: true, edit: true }}
        onTasksChange={(changeSet) => changes.push(changeSet.reason)}
      />,
    );
    const bar = view.container.querySelector<SVGElement>('.gantt__bar[data-task-id="a"]');
    bar?.focus();
    bar?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    frames.step();
    expect(changes).toEqual(['move']);
    expect(view.container.querySelector('.gantt__live')?.textContent).toMatch(
      /^Alpha, Mar 3, 2026/,
    );
    await view.unmount();
  });
});
