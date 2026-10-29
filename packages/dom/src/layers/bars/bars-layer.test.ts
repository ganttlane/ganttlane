import {
  barHandles,
  barsInWindow,
  createGanttCore,
  type GanttCore,
  type GanttCoreOptions,
  type GanttSnapshot,
  placeLabel,
  type PointerInput,
  type Task,
  type TaskModel,
} from '@ganttlane/core';
import { edgeCases, type Fixture, sampleProject } from '@ganttlane/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLayerHarness, describeLayerContract } from '../../testing';
import { type BarsLayerOptions, createBarsLayer } from './index';

describeLayerContract('bars', createBarsLayer);

type Display = Parameters<typeof createLayerHarness>[1];

const NOW = '2026-03-04';

/** A core with a viewport, the layer mounted on a real skeleton, and a way to draw. */
interface Chart {
  readonly core: GanttCore;
  readonly harness: ReturnType<typeof createLayerHarness<'bars'>>;
  readonly layer: ReturnType<typeof createBarsLayer>;
  readonly root: SVGGElement;
  /** Draws the core's current snapshot, like the renderer does after a change. */
  draw(): GanttSnapshot;
  /** `bar(id)`: the group of a task's bar. */
  bar(id: string | number): SVGGElement | null;
  /** Records every DOM mutation `action` causes below the layer's root. */
  watch(action: () => void): MutationRecord[];
}

const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    chart.layer.destroy();
    chart.core.destroy();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function draw(
  core: GanttCore,
  display?: Display,
  layerOptions?: BarsLayerOptions,
  viewport = { width: 800, height: 400 },
): Chart {
  core.setViewport(viewport);
  const harness = createLayerHarness('bars', display);
  const layer = createBarsLayer(layerOptions);
  layer.mount(harness.context);
  let previous: GanttSnapshot | undefined;
  const chart: Chart = {
    core,
    harness,
    layer,
    root: harness.root,
    draw() {
      const snapshot = core.getSnapshot();
      layer.update(snapshot, previous);
      previous = snapshot;
      return snapshot;
    },
    bar: (id) => harness.root.querySelector<SVGGElement>(`[data-task-id="${String(id)}"]`),
    watch(action) {
      const observer = new MutationObserver(() => undefined);
      observer.observe(harness.root, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
      action();
      return observer.takeRecords();
    },
  };
  chart.draw();
  charts.push(chart);
  return chart;
}

const DAY_TASKS: readonly Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
];

function chartOf(
  tasks: readonly Task[] = DAY_TASKS,
  options: Partial<GanttCoreOptions> = {},
  display?: Display,
  layerOptions?: BarsLayerOptions,
): Chart {
  const core = createGanttCore({
    tasks,
    calendar: { weekends: [0, 6] },
    now: () => NOW,
    ...options,
  });
  return draw(core, display, layerOptions);
}

function fixtureCore(fixture: Fixture, options: Partial<GanttCoreOptions> = {}): GanttCore {
  return createGanttCore({
    tasks: fixture.tasks,
    links: fixture.links,
    ...(fixture.calendar && { calendar: fixture.calendar }),
    ...fixture.options,
    now: () => '2026-04-15',
    ...options,
  });
}

/** The ids of the bars the layer draws, in DOM order. */
function drawnIds(root: Element): string[] {
  return [...root.querySelectorAll<SVGGElement>(':scope > .gantt__bar')].map(
    (bar) => bar.dataset.taskId ?? '',
  );
}

/** The ids of the bars core says belong in the window. */
function windowIds(snapshot: GanttSnapshot): string[] {
  return barsInWindow(snapshot.window, snapshot.layout).map((bar) => String(bar.id));
}

const num = (element: Element | null, name: string): number => Number(element?.getAttribute(name));

function pointer(
  type: PointerInput['type'],
  x: number,
  y: number,
  target?: PointerInput['target'],
  time = 0,
): PointerInput {
  return { type, pointerId: 1, x, y, time, ...(target && { target }) };
}

/** Where the middle of a task's bar is, in the content coordinates `send` takes. */
function middleOf(core: GanttCore, id: string): { x: number; y: number } {
  const bar = core.getBarRect(id)!;
  return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
}

describe('bars layer: markup', () => {
  it('FR-BAR-1: draws one bar per bar of the window, in row order, with its parts', () => {
    const chart = chartOf();
    const snapshot = chart.core.getSnapshot();

    expect(drawnIds(chart.root)).toEqual(['design', 'build']);
    expect(drawnIds(chart.root)).toEqual(windowIds(snapshot));
    const design = chart.bar('design')!;
    expect(design.tagName).toBe('g');
    expect(design.getAttribute('class')).toBe('gantt__bar');
    expect(design.dataset.type).toBe('task');
    expect([...design.children].map((child) => child.getAttribute('class'))).toEqual([
      'gantt__bar-track',
      'gantt__bar-progress',
      'gantt__bar-label',
      'gantt__handle',
      'gantt__handle',
      'gantt__handle',
      'gantt__link-handle',
      'gantt__link-handle',
    ]);
  });

  it('FR-BAR-1, FR-BAR-2: geometry attributes equal the layout, nothing is rounded', () => {
    const chart = chartOf(
      [{ id: 'half', name: 'Mostly done', start: '2026-03-02', end: '2026-03-06', progress: 60 }],
      { layout: { barRadius: 4 } },
    );
    const bar = chart.core.getSnapshot().layout.getBarRect('half')!;
    const track = chart.bar('half')!.querySelector('.gantt__bar-track');
    const progress = chart.bar('half')!.querySelector('.gantt__bar-progress');

    expect(bar.progressWidth).toBe(120);
    for (const [name, value] of Object.entries({
      x: bar.x,
      y: bar.y,
      width: bar.width,
      height: bar.height,
      rx: bar.radius,
      ry: bar.radius,
    })) {
      expect(track?.getAttribute(name), name).toBe(String(value));
    }
    expect(num(progress, 'x')).toBe(bar.x);
    expect(num(progress, 'y')).toBe(bar.y);
    expect(num(progress, 'width')).toBe(bar.progressWidth);
    expect(num(progress, 'height')).toBe(bar.height);
  });

  it('FR-BAR-2: a zero-width bar and a narrow done part keep a valid radius', () => {
    const chart = chartOf(
      [
        { id: 'zero', name: 'Zero', start: '2026-03-02', duration: 0 },
        { id: 'sliver', name: 'Sliver', start: '2026-03-02', end: '2026-03-06', progress: 1 },
      ],
      { layout: { barRadius: 10 } },
    );
    const layout = chart.core.getSnapshot().layout;
    const zero = layout.getBarRect('zero')!;
    const sliver = layout.getBarRect('sliver')!;

    expect(zero.width).toBe(0);
    const zeroTrack = chart.bar('zero')!.querySelector('.gantt__bar-track');
    expect(num(zeroTrack, 'rx')).toBe(0);
    expect(num(zeroTrack, 'width')).toBe(0);
    const progress = chart.bar('sliver')!.querySelector('.gantt__bar-progress');
    expect(num(progress, 'width')).toBe(sliver.progressWidth);
    expect(num(progress, 'rx')).toBeLessThanOrEqual(sliver.progressWidth / 2);
    expect(num(chart.bar('sliver')!.querySelector('.gantt__bar-track'), 'rx')).toBe(sliver.radius);
  });

  it('FR-BAR-6: a milestone is a diamond polygon without track and progress', () => {
    const chart = chartOf([{ id: 'go', name: 'Go live', type: 'milestone', start: '2026-03-04' }]);
    const bar = chart.core.getSnapshot().layout.getBarRect('go')!;
    const group = chart.bar('go')!;

    expect(group.dataset.type).toBe('milestone');
    expect(group.querySelector('.gantt__bar-track')).toBeNull();
    expect(group.querySelector('.gantt__bar-progress')).toBeNull();
    const diamond = group.querySelector('polygon.gantt__bar-milestone');
    const x = bar.x + bar.width / 2;
    const y = bar.y + bar.height / 2;
    expect(diamond?.getAttribute('points')).toBe(
      `${x},${bar.y} ${bar.x + bar.width},${y} ${x},${bar.y + bar.height} ${bar.x},${y}`,
    );
    // Only the link handles: a milestone has no edges and no progress.
    expect(group.querySelectorAll('.gantt__handle')).toHaveLength(0);
    expect(group.querySelectorAll('.gantt__link-handle')).toHaveLength(2);
  });

  it('turns a task into a milestone and back in place', () => {
    const chart = chartOf([{ id: 'x', name: 'X', start: '2026-03-04', end: '2026-03-06' }]);
    const group = chart.bar('x')!;
    chart.core.setTasks([{ id: 'x', name: 'X', type: 'milestone', start: '2026-03-04' }]);
    chart.draw();

    expect(chart.bar('x')).toBe(group);
    expect(group.querySelector('polygon')).not.toBeNull();
    expect(group.querySelector('.gantt__bar-track')).toBeNull();

    chart.core.setTasks([{ id: 'x', name: 'X', start: '2026-03-04', end: '2026-03-06' }]);
    chart.draw();
    expect(group.querySelector('polygon')).toBeNull();
    expect([...group.children].slice(0, 3).map((c) => c.getAttribute('class'))).toEqual([
      'gantt__bar-track',
      'gantt__bar-progress',
      'gantt__bar-label',
    ]);
  });

  it('FR-ROW-3: rows without a bar (placeholder, invalid) have no node', () => {
    const fixture = edgeCases.find((entry) => entry.name === 'no-dates')!;
    const chart = draw(fixtureCore(fixture, { now: () => NOW }));
    const model = chart.core.getSnapshot().state.derived.model;

    expect(model.tasks.filter((task) => task.span === undefined)).toHaveLength(5);
    expect(drawnIds(chart.root)).toEqual(['dated']);
  });

  it('task ids of every shape become data-task-id', () => {
    const fixture = edgeCases.find((entry) => entry.name === 'numeric-ids')!;
    const chart = draw(fixtureCore(fixture, { now: () => NOW }));

    expect(chart.bar(0)?.dataset.type).toBe('task');
    expect(drawnIds(chart.root)).toEqual(windowIds(chart.core.getSnapshot()));
  });
});

describe('bars layer: label', () => {
  const LONG = 'A task whose name is far too long for one day';
  const tasks: readonly Task[] = [
    { id: 'wide', name: 'Wide', start: '2026-03-02', end: '2026-03-13' },
    { id: 'narrow', name: LONG, start: '2026-03-02', end: '2026-03-02' },
  ];

  function labelOf(chart: Chart, id: string): SVGElement | null {
    return chart.bar(id)!.querySelector<SVGElement>('.gantt__bar-label');
  }

  it('FR-BAR-1: auto puts the label inside a bar it fits and outside one it does not', () => {
    const chart = chartOf(tasks);
    const layout = chart.core.getSnapshot().layout;
    const wide = layout.getBarRect('wide')!;
    const narrow = layout.getBarRect('narrow')!;

    const inside = labelOf(chart, 'wide')!;
    expect(inside.tagName).toBe('text');
    expect(inside.dataset.placement).toBe('inside');
    expect(inside.getAttribute('text-anchor')).toBe('middle');
    expect(num(inside, 'x')).toBe(wide.x + wide.width / 2);
    expect(num(inside, 'y')).toBe(wide.y + wide.height / 2);
    expect(inside.textContent).toBe('Wide');

    const outside = labelOf(chart, 'narrow')!;
    expect(outside.dataset.placement).toBe('outside');
    expect(outside.getAttribute('text-anchor')).toBe('start');
    // Past the link handle (centre 10 px out, radius 6) and the 5 px padding.
    expect(num(outside, 'x')).toBe(narrow.x + narrow.width + 21);
    expect(outside.textContent).toBe(LONG);
  });

  it('FR-BAR-1, FR-LINK-4: an outside label starts beyond the link handle it would overlap', () => {
    const chart = chartOf(tasks);
    const narrow = chart.core.getSnapshot().layout.getBarRect('narrow')!;
    const handle = chart.bar('narrow')!.querySelector('[data-side="end"]')!;

    const right = num(handle, 'cx') + num(handle, 'r');
    expect(right).toBe(narrow.x + narrow.width + 16);
    expect(num(labelOf(chart, 'narrow'), 'x')).toBeGreaterThan(right);
  });

  it('FR-BAR-1: the label gap follows the handle sizes of the snapshot', () => {
    const chart = chartOf(tasks, { interaction: { handles: { link: 10, linkOffset: 24 } } });
    const narrow = chart.core.getSnapshot().layout.getBarRect('narrow')!;
    expect(num(labelOf(chart, 'narrow'), 'x')).toBe(narrow.x + narrow.width + 24 + 10 + 5);

    chart.core.setOptions({ interaction: { handles: { link: 6, linkOffset: 10 } } });
    chart.draw();
    expect(num(labelOf(chart, 'narrow'), 'x')).toBe(narrow.x + narrow.width + 21);
  });

  it('FR-BAR-1: the label gap is the same whether or not the bar has link handles', () => {
    // The gap is a property of the chart, not of a bar: one that follows each task's
    // permissions would put the labels of a chart on ragged lines, and make every outside label
    // jump when the editing option is switched.
    const open = chartOf([
      { id: 'narrow', name: LONG, start: '2026-03-02', end: '2026-03-02' },
      { id: 'plain', name: LONG, start: '2026-03-04', end: '2026-03-04', linkable: false },
    ]);
    const bar = open.core.getSnapshot().layout.getBarRect('narrow')!;
    const gap = num(labelOf(open, 'narrow'), 'x') - (bar.x + bar.width);
    expect(gap).toBe(21);
    expect(open.bar('plain')!.querySelectorAll('.gantt__link-handle')).toHaveLength(0);
    const plain = open.core.getSnapshot().layout.getBarRect('plain')!;
    expect(num(labelOf(open, 'plain'), 'x') - (plain.x + plain.width)).toBe(gap);

    const readonly = chartOf(
      [{ id: 'narrow', name: LONG, start: '2026-03-02', end: '2026-03-02' }],
      {
        editing: false,
      },
    );
    expect(readonly.bar('narrow')!.querySelectorAll('.gantt__link-handle')).toHaveLength(0);
    expect(num(labelOf(readonly, 'narrow'), 'x') - (bar.x + bar.width)).toBe(gap);
  });

  it.each(['inside', 'outside'] as const)(
    'FR-BAR-1: barLabel "%s" places every label where placeLabel does',
    (mode) => {
      const chart = chartOf(tasks, {}, { barLabel: mode });
      const layout = chart.core.getSnapshot().layout;

      for (const id of ['wide', 'narrow']) {
        const bar = layout.getBarRect(id)!;
        const label = labelOf(chart, id)!;
        const placed = placeLabel(bar, 0, mode)!;
        expect(label.dataset.placement).toBe(mode);
        expect(num(label, 'x')).toBe(placed.x);
        expect(num(label, 'y')).toBe(placed.y);
        expect(label.getAttribute('text-anchor')).toBe(placed.anchor);
      }
    },
  );

  it('FR-BAR-1: barLabel "none" draws no label and never asks renderBarLabel', () => {
    const renderBarLabel = vi.fn(() => 'x');
    const chart = chartOf(tasks, {}, { barLabel: 'none', renderBarLabel });

    expect(chart.root.querySelector('.gantt__bar-label')).toBeNull();
    expect(renderBarLabel).not.toHaveBeenCalled();
  });

  it('follows a change of display options on the same snapshot', () => {
    const chart = chartOf(tasks);
    const wide = labelOf(chart, 'wide')!;
    expect(wide.dataset.placement).toBe('inside');

    chart.harness.setDisplay({ barLabel: 'outside' });
    chart.draw();
    expect(labelOf(chart, 'wide')).toBe(wide);
    expect(wide.dataset.placement).toBe('outside');

    chart.harness.setDisplay({ barLabel: 'none' });
    chart.draw();
    expect(labelOf(chart, 'wide')).toBeNull();

    chart.harness.setDisplay({ barLabel: 'auto' });
    chart.draw();
    expect(labelOf(chart, 'wide')?.dataset.placement).toBe('inside');
  });

  it('measureText decides what fits', () => {
    const huge = chartOf(tasks, {}, undefined, { measureText: () => 10_000 });
    expect(labelOf(huge, 'wide')?.dataset.placement).toBe('outside');
    const none = chartOf(tasks, {}, undefined, { measureText: () => 0 });
    expect(labelOf(none, 'narrow')?.dataset.placement).toBe('inside');
    const asked: string[] = [];
    chartOf(tasks, {}, undefined, {
      measureText: (text) => {
        asked.push(text);
        return 0;
      },
    });
    expect(asked.sort()).toEqual([LONG, 'Wide'].sort());
  });

  it('fontSize scales the default estimate', () => {
    // "Wide" is about 27 px at 12 px type: with the 5 px margins it fits one day (40 px).
    const day: Task[] = [{ id: 'd', name: 'Wide', start: '2026-03-02', end: '2026-03-02' }];
    expect(labelOf(chartOf(day), 'd')?.dataset.placement).toBe('inside');
    const large = chartOf(day, {}, undefined, { fontSize: 20 });
    expect(labelOf(large, 'd')?.dataset.placement).toBe('outside');
  });

  describe('renderBarLabel (FR-BAR-5)', () => {
    it('a string is inserted as text and never parsed as HTML', () => {
      const markup = '<img src=x onerror=alert(1)><b>bold</b>';
      const chart = chartOf(tasks, {}, { renderBarLabel: () => markup });
      const label = labelOf(chart, 'wide')!;

      expect(label.tagName).toBe('text');
      expect(label.textContent).toBe(markup);
      expect(label.children).toHaveLength(0);
      expect(label.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    });

    it('a task name that looks like markup is text too', () => {
      const chart = chartOf([
        { id: 'xss', name: '<script>alert(1)</script>', start: '2026-03-02', end: '2026-03-13' },
      ]);

      expect(chart.root.querySelector('script')).toBeNull();
      expect(labelOf(chart, 'xss')?.textContent).toBe('<script>alert(1)</script>');
    });

    it('a node goes into a foreignObject as it is', () => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Hi';
      const chart = chartOf(
        tasks,
        {},
        { renderBarLabel: ({ id }) => (id === 'wide' ? badge : null) },
      );
      const wide = chart.core.getSnapshot().layout.getBarRect('wide')!;
      const label = labelOf(chart, 'wide')!;

      expect(label.tagName).toBe('foreignObject');
      // An HTML element holds the node: a foreignObject takes HTML, not SVG, children.
      expect(label.children).toHaveLength(1);
      const wrapper = label.firstElementChild!;
      expect(wrapper.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      expect(wrapper.className).toBe('gantt__bar-label-content');
      expect(wrapper.childNodes).toHaveLength(1);
      expect(wrapper.firstChild).toBe(badge);
      expect(label.dataset.placement).toBe('inside');
      expect(num(label, 'x')).toBe(wide.x + 5);
      expect(num(label, 'y')).toBe(wide.y);
      expect(num(label, 'width')).toBe(wide.width - 10);
      expect(num(label, 'height')).toBe(wide.height);
      // The one that returned null falls back to the name, as text.
      expect(labelOf(chart, 'narrow')?.tagName).toBe('text');
      expect(labelOf(chart, 'narrow')?.textContent).toBe(LONG);
    });

    it('a node outside the bar gets a box next to it that does not clip', () => {
      // A node belongs to one place: the renderer returns a new one per bar.
      const notes = new Map<unknown, Text>();
      const chart = chartOf(
        tasks,
        {},
        {
          barLabel: 'outside',
          renderBarLabel: ({ id }) => {
            const note = document.createTextNode('Note');
            notes.set(id, note);
            return note;
          },
        },
      );
      const note = notes.get('wide');
      const wide = chart.core.getSnapshot().layout.getBarRect('wide')!;
      const label = labelOf(chart, 'wide')!;

      expect(label.tagName).toBe('foreignObject');
      expect(label.dataset.placement).toBe('outside');
      expect(num(label, 'x')).toBe(wide.x + wide.width + 21);
      expect(label.getAttribute('overflow')).toBe('visible');
      expect(num(label, 'width')).toBeGreaterThan(0);
      // A bare text node gets its HTML parent too.
      expect(label.firstElementChild?.firstChild).toBe(note);
    });

    it('null and undefined fall back to the task name; an empty string hides the label', () => {
      const answers: Record<string, string | null | undefined> = {
        wide: null,
        narrow: undefined,
      };
      const chart = chartOf(tasks, {}, { renderBarLabel: ({ id }) => answers[String(id)] });
      expect(labelOf(chart, 'wide')?.textContent).toBe('Wide');
      expect(labelOf(chart, 'narrow')?.textContent).toBe(LONG);

      const hidden = chartOf(tasks, {}, { renderBarLabel: () => '' });
      expect(hidden.root.querySelector('.gantt__bar-label')).toBeNull();
    });

    it('is told the id, name, the caller task and the progress', () => {
      const seen: unknown[] = [];
      const task: Task = {
        id: 'a',
        name: 'A',
        start: '2026-03-02',
        end: '2026-03-06',
        progress: 40,
      };
      chartOf(
        [task],
        {},
        {
          renderBarLabel: (context) => {
            seen.push(context);
            return null;
          },
        },
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({ id: 'a', name: 'A', task, progress: 40 });
      expect((seen[0] as { task: Task }).task).toBe(task);
    });

    it('is asked again only when the task, its progress or the renderer changed', () => {
      const renderBarLabel = vi.fn(({ name }: { name: string }) => `» ${name}`);
      const chart = chartOf(DAY_TASKS, {}, { renderBarLabel });
      expect(renderBarLabel).toHaveBeenCalledTimes(2);

      // A drag moves the bar and changes nothing the label depends on.
      const { x, y } = middleOf(chart.core, 'design');
      chart.core.send(pointer('down', x, y, { kind: 'task', id: 'design', part: 'body' }));
      chart.core.send(pointer('move', x + 80, y));
      chart.draw();
      expect(chart.core.getSnapshot().state.draft).toBeDefined();
      expect(renderBarLabel).toHaveBeenCalledTimes(2);

      const next = vi.fn(() => 'new');
      chart.harness.setDisplay({ renderBarLabel: next });
      chart.draw();
      expect(next).toHaveBeenCalledTimes(2);
      expect(labelOf(chart, 'build')?.textContent).toBe('new');
    });

    it('is given the previewed progress while the progress handle is dragged', () => {
      const progress: number[] = [];
      const chart = chartOf(
        [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-13', progress: 10 }],
        {},
        {
          renderBarLabel: (context) => {
            progress.push(context.progress);
            return `${Math.round(context.progress)}%`;
          },
        },
      );
      const bar = chart.core.getBarRect('a')!;
      const y = bar.y + bar.height;
      const x = bar.x + bar.progressWidth;
      chart.core.send(pointer('down', x, y, { kind: 'task', id: 'a', part: 'progress' }));
      chart.core.send(pointer('move', x + 120, y));
      chart.draw();

      expect(progress[0]).toBe(10);
      expect(progress.at(-1)).toBeGreaterThan(10);
      expect(labelOf(chart, 'a')?.textContent).toBe(`${Math.round(progress.at(-1)!)}%`);
    });

    it('a renderer that throws shows the name, still draws everything and reports once', () => {
      const boom = new Error('boom');
      const core = createGanttCore({ tasks: DAY_TASKS, now: () => NOW });
      core.setViewport({ width: 800, height: 400 });
      const harness = createLayerHarness('bars', {
        renderBarLabel: ({ id }) => {
          if (id === 'design') throw boom;
          return 'ok';
        },
      });
      const layer = createBarsLayer();
      layer.mount(harness.context);

      expect(() => {
        layer.update(core.getSnapshot(), undefined);
      }).toThrow(boom);
      const labels = [...harness.root.querySelectorAll('.gantt__bar-label')].map(
        (label) => label.textContent,
      );
      expect(labels).toEqual(['Design', 'ok']);
      // The same input again is a no-op, not a second report.
      expect(() => {
        layer.update(core.getSnapshot(), core.getSnapshot());
      }).not.toThrow();
      layer.destroy();
      core.destroy();
    });

    it('several failures are reported together', () => {
      const core = createGanttCore({ tasks: DAY_TASKS, now: () => NOW });
      core.setViewport({ width: 800, height: 400 });
      const harness = createLayerHarness('bars', {
        renderBarLabel: () => {
          throw new Error('nope');
        },
      });
      const layer = createBarsLayer();
      layer.mount(harness.context);

      expect(() => {
        layer.update(core.getSnapshot(), undefined);
      }).toThrow(AggregateError);
      layer.destroy();
      core.destroy();
    });

    it('FR-BAR-5: a document fragment is shown again after the labels were hidden and shown', () => {
      // Inserting a fragment moves its children out of it, so it can be shown once: the
      // renderer is asked for a new one, and an element (which can be put back) is kept.
      const span = document.createElement('span');
      span.textContent = 'kept';
      const renderBarLabel = vi.fn(({ id, name }: { id: unknown; name: string }) => {
        if (id === 'narrow') return span;
        const fragment = document.createDocumentFragment();
        const bold = document.createElement('b');
        bold.textContent = `» ${name}`;
        fragment.append(bold, ' !');
        return fragment;
      });
      const chart = chartOf(tasks, {}, { barLabel: 'inside', renderBarLabel });
      const content = (id: string): Element | null | undefined =>
        labelOf(chart, id)?.querySelector('.gantt__bar-label-content');
      expect(content('wide')?.textContent).toBe('» Wide !');
      expect(content('narrow')?.firstChild).toBe(span);

      chart.harness.setDisplay({ barLabel: 'none' });
      chart.draw();
      expect(labelOf(chart, 'wide')).toBeNull();
      chart.harness.setDisplay({ barLabel: 'inside' });
      chart.draw();

      expect(content('wide')?.textContent).toBe('» Wide !');
      expect(content('wide')?.querySelectorAll('b')).toHaveLength(1);
      expect(content('narrow')?.firstChild).toBe(span);
      // Once more: the new fragment is as good as the first.
      chart.harness.setDisplay({ barLabel: 'none' });
      chart.draw();
      chart.harness.setDisplay({ barLabel: 'inside' });
      chart.draw();
      expect(content('wide')?.textContent).toBe('» Wide !');
    });

    it('FR-BAR-5: a fragment label survives its bar leaving and re-entering the window', () => {
      const fragmentOf = vi.fn(({ name }: { name: string }) => {
        const fragment = document.createDocumentFragment();
        fragment.append(`« ${name} »`);
        return fragment;
      });
      const chart = chartOf(
        [
          { id: 'early', name: 'Early', start: '2026-03-02', end: '2026-03-13' },
          { id: 'late', name: 'Late', start: '2026-08-03', end: '2026-08-14' },
        ],
        { scroll: { initial: 'start' } },
        { barLabel: 'inside', renderBarLabel: fragmentOf },
      );
      const text = (id: string): string | null | undefined =>
        chart.bar(id)?.querySelector('.gantt__bar-label-content')?.textContent;
      expect(text('early')).toBe('« Early »');
      const late = chart.core.getBarRect('late')!;

      chart.core.scroll({ left: late.x - 100, top: 0 });
      chart.draw();
      expect(text('late')).toBe('« Late »');
      chart.core.scroll({ left: 0, top: 0 });
      chart.draw();

      expect(text('early')).toBe('« Early »');
    });

    it('switches a label between text and a node in place', () => {
      const icon = document.createElement('i');
      let custom: Node | string | undefined = icon;
      const chart = chartOf(tasks, {}, { renderBarLabel: () => custom });
      const group = chart.bar('wide')!;
      expect(labelOf(chart, 'wide')?.tagName).toBe('foreignObject');
      expect(icon.parentNode).not.toBeNull();

      custom = 'plain';
      chart.harness.setDisplay({ renderBarLabel: () => custom });
      chart.draw();
      expect(labelOf(chart, 'wide')?.tagName).toBe('text');
      expect(group.querySelectorAll('.gantt__bar-label')).toHaveLength(1);
      // The caller's node is let go of, so that it can be used elsewhere.
      expect(icon.parentNode).toBeNull();
      // The label stays below the progress and above the handles.
      expect([...group.children].map((child) => child.getAttribute('class'))).toEqual([
        'gantt__bar-track',
        'gantt__bar-progress',
        'gantt__bar-label',
        'gantt__handle',
        'gantt__handle',
        'gantt__handle',
        'gantt__link-handle',
        'gantt__link-handle',
      ]);
    });
  });
});

describe('bars layer: state flags (FR-BAR-3)', () => {
  const flags = (chart: Chart, id: string): string[] =>
    [...chart.bar(id)!.attributes]
      .map((attribute) => attribute.name)
      .filter(
        (name) =>
          name.startsWith('data-') &&
          name !== 'data-task-id' &&
          name !== 'data-type' &&
          name !== 'data-movable',
      )
      .map((name) => name.slice('data-'.length))
      .sort();

  it('has none for a plain bar', () => {
    const chart = chartOf();
    expect(flags(chart, 'design')).toEqual([]);
  });

  it('selected follows the selection', () => {
    const chart = chartOf();
    chart.core.select(['design']);
    chart.draw();
    expect(flags(chart, 'design')).toEqual(['selected']);
    expect(flags(chart, 'build')).toEqual([]);

    chart.core.select(['build', 'design']);
    chart.draw();
    expect(flags(chart, 'design')).toEqual(['selected']);
    expect(flags(chart, 'build')).toEqual(['selected']);

    chart.core.clearSelection();
    chart.draw();
    expect(flags(chart, 'design')).toEqual([]);
  });

  it('hovered follows the pointer', () => {
    const chart = chartOf();
    const { x, y } = middleOf(chart.core, 'build');
    chart.core.send(pointer('move', x, y, { kind: 'task', id: 'build', part: 'body' }));
    chart.draw();
    expect(flags(chart, 'build')).toEqual(['hovered']);
    expect(flags(chart, 'design')).toEqual([]);

    chart.core.send(pointer('move', 0, 0, { kind: 'empty' }));
    chart.draw();
    expect(flags(chart, 'build')).toEqual([]);
  });

  it('dragging while the bar is moved, and its progress handle is dragged', () => {
    const chart = chartOf();
    const { x, y } = middleOf(chart.core, 'design');
    chart.core.send(pointer('down', x, y, { kind: 'task', id: 'design', part: 'body' }));
    chart.draw();
    // Pressed, not yet dragged.
    expect(flags(chart, 'design')).toEqual(['hovered']);

    chart.core.send(pointer('move', x + 80, y));
    chart.draw();
    expect(flags(chart, 'design')).toEqual(['dragging', 'hovered']);
    expect(flags(chart, 'build')).toEqual([]);

    chart.core.send(pointer('up', x + 80, y));
    chart.draw();
    expect(flags(chart, 'design')).not.toContain('dragging');
  });

  it('resizing while an edge is dragged', () => {
    const chart = chartOf();
    const bar = chart.core.getBarRect('design')!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width - 2;
    chart.core.send(pointer('down', x, y, { kind: 'task', id: 'design', part: 'resize-end' }));
    chart.core.send(pointer('move', x + 80, y));
    chart.draw();

    expect(flags(chart, 'design')).toEqual(['hovered', 'resizing']);
    chart.core.send(pointer('up', x + 80, y));
  });

  it('a link gesture marks neither dragging nor resizing', () => {
    const chart = chartOf();
    const bar = chart.core.getBarRect('design')!;
    const y = bar.y + bar.height / 2;
    const x = bar.x + bar.width + 10;
    chart.core.send(pointer('down', x, y, { kind: 'task', id: 'design', part: 'link-end' }));
    chart.core.send(pointer('move', x + 100, y));
    chart.draw();

    expect(chart.core.getSnapshot().feedback.gesture).toBe('link-create');
    expect(flags(chart, 'design')).not.toContain('dragging');
    expect(flags(chart, 'design')).not.toContain('resizing');
    chart.core.send({ type: 'cancel', pointerId: 1 });
  });

  it('locked marks a locked task, which is also read-only but can still be linked', () => {
    const chart = chartOf([
      { id: 'done', name: 'Done', start: '2026-03-02', end: '2026-03-06', locked: true },
      { id: 'open', name: 'Open', start: '2026-03-09', end: '2026-03-13' },
    ]);

    expect(flags(chart, 'done')).toEqual(['locked', 'readonly']);
    expect(flags(chart, 'open')).toEqual([]);
    expect(chart.bar('done')!.querySelectorAll('.gantt__handle')).toHaveLength(0);
    expect(chart.bar('done')!.querySelectorAll('.gantt__link-handle')).toHaveLength(2);
  });

  it('readonly follows the editing option and a task editable override', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13', editable: true },
      { id: 'c', name: 'C', start: '2026-03-09', end: '2026-03-13', editable: false },
    ];
    const off = chartOf(tasks, { editing: false });
    expect(flags(off, 'a')).toEqual(['readonly']);
    expect(flags(off, 'b')).toEqual([]);
    expect(flags(off, 'c')).toEqual(['readonly']);

    const on = chartOf(tasks);
    expect(flags(on, 'a')).toEqual([]);
    expect(flags(on, 'c')).toEqual(['readonly']);

    // Dates and progress only: links alone do not make a bar editable.
    const linksOnly = chartOf(tasks, { editing: { move: false, resize: false, progress: false } });
    expect(flags(linksOnly, 'a')).toEqual(['readonly']);
    const moveOnly = chartOf(tasks, { editing: { resize: false, progress: false } });
    expect(flags(moveOnly, 'a')).toEqual([]);
  });

  it('FR-EDIT-1: movable marks a bar whose body may be dragged, whatever else may be edited', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13', editable: true },
      { id: 'c', name: 'C', start: '2026-03-09', end: '2026-03-13', editable: false },
      { id: 'd', name: 'D', start: '2026-03-16', end: '2026-03-20', locked: true },
      { id: 'm', name: 'M', start: '2026-03-16', end: '2026-03-16', type: 'milestone' },
    ];
    const movable = (chart: Chart): string[] =>
      ['a', 'b', 'c', 'd', 'm'].filter((id) => chart.bar(id)!.hasAttribute('data-movable'));

    expect(movable(chartOf(tasks))).toEqual(['a', 'b', 'm']);
    // `editing: false` takes it away, a task that says `editable: true` gets it back.
    expect(movable(chartOf(tasks, { editing: false }))).toEqual(['b']);
    // Moving is the permission: a bar that can still be resized or progressed is not movable
    // (and is not `data-readonly` either), one that can only be linked is neither. The task
    // that says `editable: true` is the one that is moved all the same.
    const resizeOnly = chartOf(tasks, { editing: { move: false } });
    expect(movable(resizeOnly)).toEqual(['b']);
    expect(resizeOnly.bar('a')!.hasAttribute('data-readonly')).toBe(false);
    expect(resizeOnly.bar('a')!.querySelectorAll('.gantt__handle')).toHaveLength(3);
    const linksOnly = chartOf(tasks, { editing: { move: false, resize: false, progress: false } });
    expect(movable(linksOnly)).toEqual(['b']);
    expect(linksOnly.bar('a')!.hasAttribute('data-readonly')).toBe(true);
  });

  it('FR-EDIT-1: movable follows the editing option through the snapshot, on the same node', () => {
    const chart = chartOf();
    const group = chart.bar('design')!;
    expect(group.getAttribute('data-movable')).toBe('');

    chart.core.setOptions({ editing: false });
    chart.draw();
    expect(group.hasAttribute('data-movable')).toBe(false);
    expect(group.hasAttribute('data-readonly')).toBe(true);

    chart.core.setOptions({ editing: { move: true, resize: false } });
    chart.draw();
    expect(group.getAttribute('data-movable')).toBe('');
    expect(chart.bar('design')).toBe(group);
  });

  it('FR-EDIT-1: a row without dates has no bar, so nothing to move', () => {
    const chart = chartOf([
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
      { id: 'p', name: 'No dates' },
    ]);

    expect(chart.bar('p')).toBeNull();
    expect(chart.bar('a')!.hasAttribute('data-movable')).toBe(true);
  });

  it('invalid marks a task the model calls invalid', () => {
    const chart = chartOf();
    const snapshot = chart.core.getSnapshot();
    const { model } = snapshot.state.derived;
    const taskById = new Map<TaskModel['id'], TaskModel>(model.taskById);
    taskById.set('design', { ...taskById.get('design')!, valid: false });
    const marked = {
      ...snapshot,
      state: {
        ...snapshot.state,
        derived: { ...snapshot.state.derived, model: { ...model, taskById } },
      },
    } as GanttSnapshot;

    chart.layer.update(marked, snapshot);

    expect(flags(chart, 'design')).toEqual(['invalid']);
    expect(flags(chart, 'build')).toEqual([]);
  });

  it('conflict marks a task that core reports a conflict on', () => {
    const chart = chartOf([
      { id: 'parent', name: 'Parent', start: '2026-03-02', end: '2026-03-06' },
      { id: 'child', name: 'Child', parentId: 'parent', start: '2026-03-09', end: '2026-03-11' },
      { id: 'inside', name: 'Inside', parentId: 'parent', start: '2026-03-03', end: '2026-03-05' },
    ]);
    const { conflicts } = chart.core.getSnapshot().state.derived;

    expect([...conflicts.keys()]).toEqual(['child']);
    expect(flags(chart, 'child')).toEqual(['conflict']);
    expect(flags(chart, 'inside')).toEqual([]);
    expect(flags(chart, 'parent')).toEqual([]);
  });

  it('every flag is present or absent, never a value', () => {
    const chart = chartOf([
      { id: 'done', name: 'Done', start: '2026-03-02', end: '2026-03-06', locked: true },
    ]);
    chart.core.select(['done']);
    chart.draw();

    for (const flag of ['selected', 'locked', 'readonly']) {
      expect(chart.bar('done')!.getAttribute(`data-${flag}`), flag).toBe('');
    }
    for (const flag of ['hovered', 'dragging', 'resizing', 'invalid', 'conflict', 'movable']) {
      expect(chart.bar('done')!.hasAttribute(`data-${flag}`), flag).toBe(false);
    }
    expect(chartOf().bar('design')!.getAttribute('data-movable')).toBe('');
  });
});

describe('bars layer: class and colour', () => {
  const styled: Task = {
    id: 'a',
    name: 'A',
    start: '2026-03-02',
    end: '2026-03-06',
    className: 'status-late  urgent',
    color: 'tomato',
    progressColor: '#036',
  };

  it('FR-BAR-1, FR-THEME-1: adds the task class and sets the colour as a custom property', () => {
    const chart = chartOf([styled]);
    const group = chart.bar('a')!;

    expect(group.classList.contains('gantt__bar')).toBe(true);
    expect(group.classList.contains('status-late')).toBe(true);
    expect(group.classList.contains('urgent')).toBe(true);
    expect(group.style.getPropertyValue('--gantt-bar-color')).toBe('tomato');
    expect(group.style.getPropertyValue('--gantt-bar-progress-color')).toBe('#036');
  });

  it('FR-THEME-6: goes through the CSSOM, never through a style attribute', () => {
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    const chart = chartOf([styled]);

    expect(setProperty.mock.calls).toEqual([
      ['--gantt-bar-color', 'tomato'],
      ['--gantt-bar-progress-color', '#036'],
    ]);
    expect(chart.bar('a')!.style.getPropertyValue('--gantt-bar-color')).toBe('tomato');
  });

  it('drops class and colour when the task loses them', () => {
    const chart = chartOf([styled]);
    chart.core.setTasks([{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' }]);
    chart.draw();
    const group = chart.bar('a')!;

    expect(group.getAttribute('class')).toBe('gantt__bar');
    expect(group.style.getPropertyValue('--gantt-bar-color')).toBe('');
    expect(group.style.getPropertyValue('--gantt-bar-progress-color')).toBe('');
  });
});

describe('bars layer: handles (FR-EDIT-7)', () => {
  const handles = (chart: Chart, id: string): string[] =>
    [...chart.bar(id)!.querySelectorAll<SVGElement>('.gantt__handle, .gantt__link-handle')].map(
      (handle) => handle.dataset.handle ?? `link-${handle.dataset.side ?? ''}`,
    );
  const ALL = ['resize-start', 'resize-end', 'progress', 'link-start', 'link-end'];

  it('draws every handle of an editable bar where barHandles puts it', () => {
    const chart = chartOf();
    const bar = chart.core.getBarRect('design')!;
    const boxes = barHandles(bar);
    const group = chart.bar('design')!;

    expect(handles(chart, 'design')).toEqual(ALL);
    const at = (selector: string): Element => group.querySelector(selector)!;
    for (const [selector, box] of [
      ['[data-handle="resize-start"]', boxes.resizeStart],
      ['[data-handle="resize-end"]', boxes.resizeEnd],
      ['[data-handle="progress"]', boxes.progress],
    ] as const) {
      expect(at(selector).tagName, selector).toBe('rect');
      expect(num(at(selector), 'x')).toBe(box?.x);
      expect(num(at(selector), 'y')).toBe(box?.y);
      expect(num(at(selector), 'width')).toBe(box?.width);
      expect(num(at(selector), 'height')).toBe(box?.height);
    }
    for (const [side, box] of [
      ['start', boxes.linkStart],
      ['end', boxes.linkEnd],
    ] as const) {
      const circle = at(`[data-side="${side}"]`);
      expect(circle.tagName).toBe('circle');
      expect(num(circle, 'r')).toBe(box.width / 2);
      expect(num(circle, 'cx')).toBe(box.x + box.width / 2);
      expect(num(circle, 'cy')).toBe(box.y + box.height / 2);
    }
    // The task id is on the group: a pointer target finds it with `closest`.
    expect(group.dataset.taskId).toBe('design');
    expect(at('[data-handle="resize-end"]').closest('[data-task-id]')).toBe(group);
  });

  it('draws none for a read-only chart', () => {
    const chart = chartOf(DAY_TASKS, { editing: false });
    expect(handles(chart, 'design')).toEqual([]);
    expect(handles(chart, 'build')).toEqual([]);
  });

  it.each([
    ['move', { move: false }, ALL],
    ['resize', { resize: false }, ['progress', 'link-start', 'link-end']],
    ['progress', { progress: false }, ['resize-start', 'resize-end', 'link-start', 'link-end']],
    ['links', { links: false }, ['resize-start', 'resize-end', 'progress']],
  ])('editing.%s off draws only the handles of what is still allowed', (_flag, editing, wanted) => {
    const chart = chartOf(DAY_TASKS, { editing });
    expect(handles(chart, 'design')).toEqual(wanted);
  });

  it('a task can override the editing option in both directions', () => {
    const chart = chartOf(
      [
        { id: 'on', name: 'On', start: '2026-03-02', end: '2026-03-06', editable: true },
        { id: 'off', name: 'Off', start: '2026-03-09', end: '2026-03-13', editable: false },
      ],
      { editing: false },
    );
    expect(handles(chart, 'on')).toEqual(ALL);
    expect(handles(chart, 'off')).toEqual([]);
  });

  it('draws no handle a gesture is forbidden for', () => {
    const chart = chartOf([
      { id: 'fixed', name: 'Fixed', start: '2026-03-02', end: '2026-03-06', fixedDuration: true },
      { id: 'sealed', name: 'Sealed', start: '2026-03-09', end: '2026-03-13', linkable: false },
    ]);
    expect(handles(chart, 'fixed')).toEqual(['progress', 'link-start', 'link-end']);
    expect(handles(chart, 'sealed')).toEqual(['resize-start', 'resize-end', 'progress']);
  });

  it('draws no resize handle on a zero-width bar', () => {
    const chart = chartOf([{ id: 'zero', name: 'Zero', start: '2026-03-04', duration: 0 }]);
    expect(handles(chart, 'zero')).toEqual(['progress', 'link-start', 'link-end']);
  });

  it('FR-EDIT-7: adds and removes handles when the editing option changes, through the snapshot', () => {
    const chart = chartOf();
    expect(handles(chart, 'design')).toEqual(ALL);
    const before = chart.core.getSnapshot();

    chart.core.setOptions({ editing: false });
    expect(chart.core.getSnapshot().editing).not.toBe(before.editing);
    chart.draw();
    expect(handles(chart, 'design')).toEqual([]);
    expect(chart.bar('design')!.hasAttribute('data-readonly')).toBe(true);

    chart.core.setOptions({ editing: { resize: false } });
    chart.draw();
    expect(handles(chart, 'design')).toEqual(['progress', 'link-start', 'link-end']);
    expect(chart.bar('design')!.hasAttribute('data-readonly')).toBe(false);
  });

  it('FR-EDIT-7: draws the handles with the sizes of the snapshot, which the hit test uses too', () => {
    const sizes = { resize: 4, progress: 3, link: 9, linkOffset: 20 };
    const chart = chartOf(DAY_TASKS, { interaction: { handles: sizes } });
    const boxes = barHandles(chart.core.getBarRect('design')!, sizes);
    const group = chart.bar('design')!;

    expect(num(group.querySelector('[data-handle="resize-start"]'), 'width')).toBe(4);
    expect(num(group.querySelector('[data-handle="progress"]'), 'width')).toBe(6);
    expect(num(group.querySelector('[data-side="start"]'), 'r')).toBe(9);
    expect(num(group.querySelector('[data-side="end"]'), 'cx')).toBe(
      boxes.linkEnd.x + boxes.linkEnd.width / 2,
    );
    expect(chart.core.getSnapshot().handles).toEqual(sizes);
  });

  it('FR-EDIT-7: redraws the handles when only their sizes change', () => {
    const chart = chartOf();
    const before = num(chart.bar('design')!.querySelector('[data-side="end"]'), 'r');
    expect(before).toBe(6);

    chart.core.setOptions({ interaction: { handles: { link: 11 } } });
    chart.draw();

    expect(num(chart.bar('design')!.querySelector('[data-side="end"]'), 'r')).toBe(11);
  });

  it('follows a bar that is being dragged', () => {
    const chart = chartOf();
    const { x, y } = middleOf(chart.core, 'design');
    chart.core.send(pointer('down', x, y, { kind: 'task', id: 'design', part: 'body' }));
    chart.core.send(pointer('move', x + 80, y));
    chart.draw();
    const bar = chart.core.getSnapshot().layout.getBarRect('design')!;
    const boxes = barHandles(bar);

    expect(num(chart.bar('design')!.querySelector('[data-handle="resize-end"]'), 'x')).toBe(
      boxes.resizeEnd?.x,
    );
    expect(num(chart.bar('design')!.querySelector('.gantt__bar-track'), 'x')).toBe(bar.x);
  });
});

describe('bars layer: reconciliation', () => {
  it('a repeated snapshot and a repeated display touch nothing', () => {
    const chart = chartOf();
    const records = chart.watch(() => {
      chart.draw();
      chart.draw();
    });
    expect(records).toEqual([]);
  });

  it('a scroll that leaves the same bars in the window touches nothing and keeps the nodes', () => {
    const chart = chartOf();
    const before = [...chart.root.children];
    const { timeline, scrollTop } = chart.core.getSnapshot();
    const windowBefore = chart.core.getSnapshot().window;

    const records = chart.watch(() => {
      chart.core.scroll({ left: timeline.scrollLeft + 7, top: scrollTop });
      chart.draw();
    });

    expect(chart.core.getSnapshot().window).not.toBe(windowBefore);
    expect(records).toEqual([]);
    expect([...chart.root.children]).toEqual(before);
    chart.root.childNodes.forEach((node, i) => {
      expect(node).toBe(before[i]);
    });
  });

  it('a bar that enters the window gets clean nodes: nothing of the task that left is on it', () => {
    const chart = chartOf(
      [
        {
          id: 'early',
          name: 'Early',
          start: '2026-03-02',
          end: '2026-03-06',
          locked: true,
          className: 'old',
          color: 'red',
          progress: 50,
        },
        { id: 'late', name: 'Late', start: '2026-08-03', end: '2026-08-07' },
      ],
      { scroll: { initial: 'start' } },
    );
    chart.core.select(['early']);
    chart.draw();
    expect(drawnIds(chart.root)).toEqual(['early']);
    const gone = chart.bar('early')!;
    const late = chart.core.getBarRect('late')!;

    chart.core.scroll({ left: late.x - 100, top: 0 });
    chart.draw();

    expect(drawnIds(chart.root)).toEqual(['late']);
    const group = chart.bar('late')!;
    expect(group).not.toBe(gone);
    expect(gone.isConnected).toBe(false);
    expect(group.getAttribute('class')).toBe('gantt__bar');
    expect(group.dataset.type).toBe('task');
    expect(group.hasAttribute('data-locked')).toBe(false);
    expect(group.hasAttribute('data-selected')).toBe(false);
    expect(group.hasAttribute('data-readonly')).toBe(false);
    expect(group.style.getPropertyValue('--gantt-bar-color')).toBe('');
    expect(group.querySelector('.gantt__bar-label')?.textContent).toBe('Late');
    expect(num(group.querySelector('.gantt__bar-track'), 'x')).toBe(late.x);
    expect(num(group.querySelector('.gantt__bar-progress'), 'width')).toBe(0);
    expect(group.querySelectorAll('.gantt__handle')).toHaveLength(3);
  });

  it('FR-TIP-1: the aria-describedby of a bar that left the window goes with its node', () => {
    const tasks: Task[] = Array.from({ length: 140 }, (_, i) => ({
      id: `t${i + 1}`,
      name: `Task ${i + 1}`,
      start: '2026-03-02',
      end: '2026-03-04',
    }));
    const chart = draw(createGanttCore({ tasks, now: () => NOW }), undefined, undefined, {
      width: 800,
      height: 200,
    });
    // The popover layer describes the bar a tooltip is about with an attribute on its group.
    const hovered = chart.bar('t1')!;
    hovered.setAttribute('aria-describedby', 'gantt-1-popover');

    chart.core.scroll({ left: 0, top: 130 * 48 });
    chart.draw();

    expect(chart.bar('t1')).toBeNull();
    expect(hovered.isConnected).toBe(false);
    const drawn = [...chart.root.children];
    expect(drawn.map((node) => node.getAttribute('data-task-id'))).toContain('t130');
    expect(drawn.filter((node) => node.hasAttribute('aria-describedby'))).toEqual([]);
  });

  it('FR-TIP-1: a bar that stays in the window keeps the aria-describedby the popover gave it', () => {
    const chart = chartOf();
    const group = chart.bar('design')!;
    group.setAttribute('aria-describedby', 'gantt-1-popover');

    chart.core.select(['design']);
    chart.draw();
    chart.core.setOptions({ editing: false });
    chart.draw();

    expect(chart.bar('design')).toBe(group);
    expect(group.getAttribute('aria-describedby')).toBe('gantt-1-popover');
  });

  it('keeps the nodes of the bars that stay when others enter and leave', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
      { id: 'c', name: 'C', start: '2026-03-16', end: '2026-03-20' },
    ];
    const chart = chartOf(tasks, { scroll: { initial: 'start' } });
    const b = chart.bar('b');

    chart.core.setTasks(tasks.slice(1));
    chart.draw();

    expect(chart.bar('a')).toBeNull();
    expect(chart.bar('b')).toBe(b);
    expect(drawnIds(chart.root)).toEqual(['b', 'c']);
    chart.core.setTasks(tasks);
    chart.draw();
    expect(drawnIds(chart.root)).toEqual(['a', 'b', 'c']);
    expect(chart.bar('b')).toBe(b);
    expect(chart.bar('a')?.isConnected).toBe(true);
  });

  it('keeps the node of a bar whose row moves and only reorders', () => {
    const chart = chartOf();
    const design = chart.bar('design');
    const build = chart.bar('build');

    chart.core.setTasks([...DAY_TASKS].reverse());
    chart.draw();

    expect(drawnIds(chart.root)).toEqual(['build', 'design']);
    expect(chart.bar('design')).toBe(design);
    expect(chart.bar('build')).toBe(build);
    expect(num(design!.querySelector('.gantt__bar-track'), 'y')).toBe(
      chart.core.getBarRect('design')!.y,
    );
  });

  it('FR-EDIT-5: a draft preview that moves one bar touches only that bar', () => {
    const chart = chartOf();
    const build = chart.bar('build')!;
    const design = chart.bar('design')!;
    const { x, y } = middleOf(chart.core, 'design');
    const before = chart.core.getBarRect('design')!;
    chart.core.send(pointer('down', x, y, { kind: 'task', id: 'design', part: 'body' }));
    chart.draw();

    const records = chart.watch(() => {
      chart.core.send(pointer('move', x + 80, y));
      chart.draw();
    });

    expect(chart.core.getSnapshot().state.draft).toBeDefined();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(design.contains(record.target), `${record.type} ${String(record.attributeName)}`).toBe(
        true,
      );
    }
    expect(num(design.querySelector('.gantt__bar-track'), 'x')).toBe(before.x + 80);
    expect(build.getAttribute('data-dragging')).toBeNull();

    // The next frame of the same drag, a day further: still only the dragged bar.
    const next = chart.watch(() => {
      chart.core.send(pointer('move', x + 120, y));
      chart.draw();
    });
    expect(next.every((record) => design.contains(record.target))).toBe(true);
    expect(num(design.querySelector('.gantt__bar-track'), 'x')).toBe(before.x + 120);
  });

  it('a cancelled drag puts the bar back', () => {
    const chart = chartOf();
    const before = chart.core.getBarRect('design')!;
    const { x, y } = middleOf(chart.core, 'design');
    chart.core.send(pointer('down', x, y, { kind: 'task', id: 'design', part: 'body' }));
    chart.core.send(pointer('move', x + 80, y));
    chart.draw();
    chart.core.send({ type: 'cancel', pointerId: 1 });
    chart.draw();

    const group = chart.bar('design')!;
    expect(num(group.querySelector('.gantt__bar-track'), 'x')).toBe(before.x);
    expect(group.hasAttribute('data-dragging')).toBe(false);
  });

  it('an unchanged task keeps its nodes untouched when others change', () => {
    const chart = chartOf();
    const design = chart.bar('design')!;
    chart.core.setTasks([
      DAY_TASKS[0]!,
      { id: 'build', name: 'Build', start: '2026-03-10', end: '2026-03-13' },
    ]);

    const records = chart.watch(() => {
      chart.draw();
    });

    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => !design.contains(record.target))).toBe(true);
  });
});

/** An element that counts how often it was taken out of the document: a node moved, not kept. */
class Counted extends HTMLElement {
  disconnects = 0;
  disconnectedCallback(): void {
    this.disconnects++;
  }
}
customElements.define('x-counted-label', Counted);

describe('bars layer: labels with a lifetime (DisposableNode, FR-BAR-5)', () => {
  const WIDE: readonly Task[] = [
    { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-13', progress: 10 },
    { id: 'b', name: 'Beta', start: '2026-03-02', end: '2026-03-13' },
  ];

  /** A `renderBarLabel` whose nodes are told when they are done with, in order, in `log`. */
  function hosting(log: string[]) {
    let made = 0;
    const live = new Set<string>();
    const renderBarLabel = ({ id, progress }: { id: unknown; progress: number }) => {
      const label = `${String(id)}#${String(++made)}`;
      const node = document.createElement('i');
      node.textContent = `${String(id)} ${String(progress)}`;
      node.dataset.label = label;
      log.push(`make ${label}`);
      live.add(label);
      return {
        node,
        dispose: () => {
          expect(live.delete(label), `${label} disposed twice`).toBe(true);
          log.push(`dispose ${label}`);
        },
      };
    };
    return { renderBarLabel, live };
  }

  const wrapperOf = (chart: Chart, id: string): Element | null | undefined =>
    chart.bar(id)?.querySelector('.gantt__bar-label-content');

  it('shows the node in the label like a node', () => {
    const log: string[] = [];
    const chart = chartOf(WIDE, {}, { renderBarLabel: hosting(log).renderBarLabel });

    const label = chart.bar('a')!.querySelector('.gantt__bar-label')!;
    expect(label.tagName).toBe('foreignObject');
    expect(wrapperOf(chart, 'a')?.firstElementChild?.getAttribute('data-label')).toBe('a#1');
    expect(wrapperOf(chart, 'a')?.textContent).toBe('a 10');
    // Nothing is disposed while the label is shown.
    expect(log).toEqual(['make a#1', 'make b#2']);
  });

  it('disposes the content of a bar that leaves the window, once, and not the others', () => {
    const log: string[] = [];
    const { renderBarLabel, live } = hosting(log);
    const chart = chartOf(
      [
        { id: 'early', name: 'Early', start: '2026-03-02', end: '2026-03-13' },
        { id: 'late', name: 'Late', start: '2026-08-03', end: '2026-08-14' },
      ],
      { scroll: { initial: 'start' } },
      { barLabel: 'inside', renderBarLabel },
    );
    expect([...live]).toEqual(['early#1']);
    const late = chart.core.getBarRect('late')!;

    chart.core.scroll({ left: late.x - 100, top: 0 });
    chart.draw();

    expect(log).toEqual(['make early#1', 'dispose early#1', 'make late#2']);
    expect([...live]).toEqual(['late#2']);
    // And it is made again, not kept, when the bar comes back.
    chart.core.scroll({ left: 0, top: 0 });
    chart.draw();
    expect(log.slice(3)).toEqual(['dispose late#2', 'make early#3']);
  });

  it('makes the new content before it disposes the old when the label changes, so they may share', () => {
    const log: string[] = [];
    const { renderBarLabel } = hosting(log);
    const chart = chartOf(
      [{ id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-13', progress: 10 }],
      {},
      { renderBarLabel },
    );
    const bar = chart.core.getBarRect('a')!;
    const y = bar.y + bar.height;
    const x = bar.x + bar.progressWidth;

    // The progress handle is dragged: the label's input changes with every step.
    chart.core.send(pointer('down', x, y, { kind: 'task', id: 'a', part: 'progress' }));
    chart.core.send(pointer('move', x + 120, y));
    chart.draw();

    expect(log).toEqual(['make a#1', 'make a#2', 'dispose a#1']);
    expect(wrapperOf(chart, 'a')?.children).toHaveLength(1);
    expect(wrapperOf(chart, 'a')?.firstElementChild?.getAttribute('data-label')).toBe('a#2');
  });

  it('disposes the content when the renderer is replaced or removed', () => {
    const log: string[] = [];
    const { renderBarLabel, live } = hosting(log);
    const chart = chartOf(WIDE, {}, { renderBarLabel });
    expect(live.size).toBe(2);

    chart.harness.setDisplay({ renderBarLabel: () => 'plain' });
    chart.draw();

    expect(live.size).toBe(0);
    expect(log.filter((entry) => entry.startsWith('dispose'))).toEqual([
      'dispose a#1',
      'dispose b#2',
    ]);
    expect(chart.bar('a')!.querySelector('text.gantt__bar-label')?.textContent).toBe('plain');
  });

  it('disposes the content of a label that is hidden and asks again when it comes back', () => {
    const log: string[] = [];
    const { renderBarLabel, live } = hosting(log);
    const chart = chartOf(WIDE, {}, { barLabel: 'inside', renderBarLabel });

    chart.harness.setDisplay({ barLabel: 'none' });
    chart.draw();
    expect(live.size).toBe(0);
    expect(chart.root.querySelector('.gantt__bar-label')).toBeNull();

    chart.harness.setDisplay({ barLabel: 'inside' });
    chart.draw();
    expect([...live]).toEqual(['a#3', 'b#4']);
    expect(wrapperOf(chart, 'a')?.firstElementChild?.getAttribute('data-label')).toBe('a#3');
  });

  it('disposes every content when the layer is destroyed', () => {
    const log: string[] = [];
    const { renderBarLabel, live } = hosting(log);
    const chart = chartOf(WIDE, {}, { renderBarLabel });
    expect(live.size).toBe(2);

    chart.layer.destroy();

    expect(live.size).toBe(0);
    expect(chart.root.childNodes).toHaveLength(0);
  });

  it('is not disposed by a redraw that changes nothing the label depends on', () => {
    const log: string[] = [];
    const chart = chartOf(WIDE, {}, { renderBarLabel: hosting(log).renderBarLabel });

    chart.core.select(['a']);
    chart.draw();
    chart.core.setOptions({ editing: false });
    chart.draw();

    expect(log).toEqual(['make a#1', 'make b#2']);
  });

  it('FR-BAR-5: a host shared by the old and the new content stays in the label, and so does the focus in it', () => {
    const host = new Counted();
    const input = document.createElement('input');
    host.append(input);
    const chart = chartOf(
      [WIDE[0]!],
      {},
      { barLabel: 'inside', renderBarLabel: () => ({ node: host, dispose: vi.fn() }) },
    );
    expect(wrapperOf(chart, 'a')?.firstChild).toBe(host);
    input.focus();

    // The label's inputs change (the name): its content is made again, with the host it had.
    chart.core.setTasks([{ ...WIDE[0]!, name: 'Alpha v2' }]);
    chart.draw();

    expect(wrapperOf(chart, 'a')?.firstChild).toBe(host);
    expect(host.disconnects).toBe(0);
    expect(document.activeElement).toBe(input);
  });

  it('FR-BAR-5: a node that took the place of another in the label is put there', () => {
    let node = document.createElement('i');
    const chart = chartOf([WIDE[0]!], {}, { renderBarLabel: () => ({ node, dispose: vi.fn() }) });
    const first = node;

    node = document.createElement('b');
    chart.core.setTasks([{ ...WIDE[0]!, name: 'Alpha v2' }]);
    chart.draw();

    expect(wrapperOf(chart, 'a')?.children).toHaveLength(1);
    expect(wrapperOf(chart, 'a')?.firstChild).toBe(node);
    expect(first.isConnected).toBe(false);
  });

  describe('the width of content with a lifetime is not known', () => {
    // Two days: a bar of about 80 px, which a name of this length does not fit in.
    const NARROW: readonly Task[] = [
      { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-04' },
    ];
    const LONG = 'a name that is much too long for the bar it is in, '.repeat(3);
    const placementOf = (chart: Chart): string | undefined =>
      chart.bar('a')?.querySelector<SVGElement>('.gantt__bar-label')?.dataset.placement;

    it('FR-BAR-5: a plain node is measured by its text, as it was', () => {
      const node = document.createElement('i');
      node.textContent = LONG;
      const chart = chartOf(NARROW, {}, { barLabel: 'auto', renderBarLabel: () => node });

      expect(placementOf(chart)).toBe('outside');
    });

    it('FR-BAR-5: content with a lifetime is placed inside by auto, whatever text its node holds', () => {
      const node = document.createElement('i');
      node.textContent = LONG;
      const chart = chartOf(
        NARROW,
        {},
        { barLabel: 'auto', renderBarLabel: () => ({ node, dispose: vi.fn() }) },
      );

      expect(placementOf(chart)).toBe('inside');
    });

    it('FR-BAR-5: and the same when the node held other text the time before: no history', () => {
      const node = document.createElement('i');
      const chart = chartOf(
        NARROW,
        {},
        { barLabel: 'auto', renderBarLabel: () => ({ node, dispose: vi.fn() }) },
      );
      expect(placementOf(chart)).toBe('inside');

      node.textContent = LONG;
      chart.core.setTasks([{ ...NARROW[0]!, name: 'Alpha v2' }]);
      chart.draw();

      expect(placementOf(chart)).toBe('inside');
    });

    it('FR-BAR-5: outside, the foreignObject has the padding and no more: the node overflows it', () => {
      const node = document.createElement('i');
      node.textContent = LONG;
      const chart = chartOf(
        NARROW,
        {},
        { barLabel: 'outside', renderBarLabel: () => ({ node, dispose: vi.fn() }) },
      );

      const label = chart.bar('a')!.querySelector('.gantt__bar-label')!;
      expect(label.getAttribute('overflow')).toBe('visible');
      expect(Number(label.getAttribute('width'))).toBeLessThan(40);
    });
  });

  it('treats an answer with a node that is itself a node as a node, not as content with a lifetime', () => {
    // A custom element may have a `node` property of its own.
    const element = Object.assign(document.createElement('x-label'), { node: 'mine' });
    const chart = chartOf(WIDE, {}, { renderBarLabel: ({ id }) => (id === 'a' ? element : null) });

    expect(wrapperOf(chart, 'a')?.firstChild).toBe(element);
  });
});

describe('bars layer: lifecycle', () => {
  it('destroy removes every node and an update after it does nothing', () => {
    const chart = chartOf();
    expect(chart.root.childNodes.length).toBeGreaterThan(0);

    chart.layer.destroy();

    expect(chart.root.childNodes).toHaveLength(0);
    expect(() => {
      chart.layer.update(chart.core.getSnapshot(), undefined);
    }).not.toThrow();
    expect(chart.root.childNodes).toHaveLength(0);
    expect(() => {
      chart.layer.destroy();
    }).not.toThrow();
  });

  it('registers no listener (pointer input arrives with step 4.7)', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    chartOf();
    expect(add).not.toHaveBeenCalled();
  });

  it('two charts do not share nodes', () => {
    const first = chartOf();
    const second = chartOf();
    expect(first.bar('design')).not.toBe(second.bar('design'));
  });
});

describe('bars layer: fixtures', () => {
  it('draws the sample project: a bar for every row of the window that has one', () => {
    const core = fixtureCore(sampleProject, { scroll: { initial: 'start' } });
    const chart = draw(core, undefined, undefined, { width: 9000, height: 1400 });
    const snapshot = chart.core.getSnapshot();
    const { model } = snapshot.state.derived;

    const ids = windowIds(snapshot);
    expect(ids.length).toBeGreaterThan(20);
    expect(drawnIds(chart.root)).toEqual(ids);
    for (const id of ids) {
      const task = model.taskById.get(id)!;
      const group = chart.bar(id)!;
      expect(group.dataset.type, id).toBe(task.type);
      expect(group.hasAttribute('data-locked'), id).toBe(task.task.locked === true);
      const className = task.task.className;
      if (className !== undefined) expect(group.classList.contains(className), id).toBe(true);
      const geometry = snapshot.layout.getBarRect(id)!;
      expect(num(group.querySelector('.gantt__bar-track'), 'x'), id).toBe(geometry.x);
      expect(num(group.querySelector('.gantt__bar-track'), 'width'), id).toBe(geometry.width);
    }
    // The placeholder row has no bar.
    expect(model.taskById.get('placeholder-3')?.span).toBeUndefined();
    expect(chart.bar('placeholder-3')).toBeNull();
    // Conflicts of the data show on their bars.
    const conflicted = [...snapshot.state.derived.conflicts.keys()].filter((id) =>
      ids.includes(String(id)),
    );
    expect(conflicted.length).toBeGreaterThan(0);
    for (const id of conflicted)
      expect(chart.bar(id as string)!.hasAttribute('data-conflict')).toBe(true);
    // The fixed-duration review cannot be resized.
    const fixed = model.tasks.find((task) => task.task.fixedDuration === true);
    if (fixed !== undefined && ids.includes(String(fixed.id))) {
      expect(chart.bar(fixed.id as string)!.querySelector('[data-handle="resize-end"]')).toBeNull();
    }
  });

  it.each(edgeCases.map((fixture) => [fixture.name, fixture] as const))(
    'edge case %s: draws what the window holds, with finite geometry',
    (_name, fixture) => {
      const core = fixtureCore(fixture, { now: () => NOW });
      const chart = draw(core, undefined, undefined, { width: 1600, height: 900 });
      const snapshot = chart.core.getSnapshot();

      expect(drawnIds(chart.root)).toEqual(windowIds(snapshot));
      for (const element of chart.root.querySelectorAll(
        '[x], [y], [width], [height], [cx], [cy], [r]',
      )) {
        for (const name of ['x', 'y', 'width', 'height', 'cx', 'cy', 'r']) {
          const value = element.getAttribute(name);
          if (value !== null) expect(Number.isFinite(Number(value)), `${name}=${value}`).toBe(true);
        }
      }
    },
  );

  it('progress bounds: the done part stays inside the bar', () => {
    const fixture = edgeCases.find((entry) => entry.name === 'progress-bounds')!;
    const chart = draw(fixtureCore(fixture, { now: () => NOW }));

    for (const group of chart.root.querySelectorAll('.gantt__bar')) {
      const track = group.querySelector('.gantt__bar-track');
      const progress = group.querySelector('.gantt__bar-progress');
      expect(num(progress, 'width')).toBeGreaterThanOrEqual(0);
      expect(num(progress, 'width')).toBeLessThanOrEqual(num(track, 'width'));
    }
  });
});
