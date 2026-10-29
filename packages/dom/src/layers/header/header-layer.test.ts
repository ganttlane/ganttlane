import type { GanttCoreOptions, GanttSnapshot } from '@ganttlane/core';
import type { Fixture } from '@ganttlane/fixtures';
import { fixtureCatalog } from '@ganttlane/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayerHarness, createTestCore, describeLayerContract } from '../../testing';
import { createHeaderLayer } from './index';

describeLayerContract('header', createHeaderLayer);

// The day mode draws 40 px per day; the test core starts at 2026-02-16 (x = 0), so 2026-03-04 is
// at x = 640 and the chart opens scrolled there. Today is a fixed clock reading.
const TODAY = new Date(2026, 2, 4, 10, 30);

/** Mounts a header layer over a real core; `redraw()` feeds it the core's current snapshot. */
function chart(options: Partial<GanttCoreOptions> = {}, viewMode?: string) {
  // The core's clock is the (faked) system clock, which a test moves and then `refreshNow()`s.
  const core = createTestCore({ now: () => new Date(), ...options });
  core.setViewport({ width: 800, height: 400 });
  if (viewMode !== undefined) core.setViewMode(viewMode);
  const harness = createLayerHarness('header');
  const layer = createHeaderLayer();
  layer.mount(harness.context);
  let shown: GanttSnapshot = core.getSnapshot();
  layer.update(shown, undefined);
  return {
    core,
    harness,
    layer,
    root: harness.root,
    /** Draws the core's current snapshot and returns it. */
    redraw(): GanttSnapshot {
      const previous = shown;
      shown = core.getSnapshot();
      layer.update(shown, previous);
      return shown;
    },
    /** Draws the same snapshot again, as the renderer does after `setDisplay`. */
    refresh(): void {
      layer.update(shown, shown);
    },
  };
}

type Chart = ReturnType<typeof chart>;

const rowsOf = (root: Element): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>('.gantt__header-row'),
];
const cellsOf = (row: Element): HTMLElement[] => [
  ...row.querySelectorAll<HTMLElement>('.gantt__header-cell'),
];
const allCells = (root: Element): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>('.gantt__header-cell'),
];
const labelOf = (cell: Element): string =>
  cell.querySelector('.gantt__header-label')?.textContent ?? '';
const labelsOf = (row: Element): string[] => cellsOf(row).map(labelOf);
const num = (element: HTMLElement, name: string): number =>
  Number.parseFloat(element.style.getPropertyValue(name));
const cellAt = (row: Element, label: string): HTMLElement | undefined =>
  cellsOf(row).find((cell) => labelOf(cell) === label);

/** Records every DOM write below `root` (attributes, children, text) until `take()`. */
function watch(root: Element): { take(): MutationRecord[]; stop(): void } {
  const observer = new MutationObserver(() => undefined);
  observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
  return {
    take: () => observer.takeRecords(),
    stop: () => {
      observer.disconnect();
    },
  };
}

/** The pointer over the middle of a bar, in the content coordinates the core takes. */
function overBar(core: Chart['core'], id: string): { x: number; y: number } {
  const bar = core.getBarRect(id)!;
  return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('header rows (FR-SCALE-4)', () => {
  it('FR-SCALE-4: draws one row per header row of the view mode, top first, with its height', () => {
    const { root } = chart();

    const rows = rowsOf(root);
    expect(rows.map((row) => row.dataset.unit)).toEqual(['month', 'day']);
    expect(rows.map((row) => row.dataset.row)).toEqual(['0', '1']);
    expect(rows.map((row) => row.style.getPropertyValue('height'))).toEqual(['45px', '30px']);
    expect(cellsOf(rows[1]!).every((cell) => cell.dataset.unit === 'day')).toBe(true);
  });

  it.each([
    ['hour', ['day', 'hour']],
    ['quarter-day', ['day', 'hour']],
    ['half-day', ['day', 'hour']],
    ['day', ['month', 'day']],
    ['week', ['month', 'week']],
    ['month', ['year', 'month']],
    ['year', ['year', 'year']],
  ])('FR-SCALE-4: the %s view mode has the header rows %j', (mode, units) => {
    const { root } = chart({}, mode);

    expect(rowsOf(root).map((row) => row.dataset.unit)).toEqual(units);
    for (const row of rowsOf(root)) expect(cellsOf(row).length).toBeGreaterThan(0);
  });

  it('FR-SCALE-4: a view mode with one header row has one row; switching redraws the rows', () => {
    const { core, root, redraw } = chart({
      viewModes: {
        day: {
          headers: [{ unit: 'day', format: { day: 'numeric' } }],
        },
      },
    });
    expect(rowsOf(root)).toHaveLength(1);

    core.setViewMode('week');
    redraw();

    expect(rowsOf(root).map((row) => row.dataset.unit)).toEqual(['month', 'week']);
  });

  it('FR-SCALE-4: labels are formatted by core, with the locale of the snapshot', () => {
    const { core, root, redraw } = chart();
    const [months, days] = rowsOf(root);
    expect(labelsOf(months!)).toEqual(['February 2026', 'March 2026', 'April 2026']);
    expect(labelOf(cellAt(days!, '4')!)).toBe('4');

    core.setOptions({ locale: 'de' });
    redraw();

    expect(labelsOf(rowsOf(root)[0]!)).toEqual(['Februar 2026', 'März 2026', 'April 2026']);
  });

  it('FR-I18N-1: a locale given at the start labels the cells in it (Ukrainian months, week ranges)', () => {
    const { root } = chart({ locale: 'uk' });

    expect(labelsOf(rowsOf(root)[0]!)).toEqual([
      'лютий 2026 р.',
      'березень 2026 р.',
      'квітень 2026 р.',
    ]);
    // A week that crosses a month names both months, abbreviated, in the locale.
    const weeks = chart({ locale: 'uk' }, 'week');
    expect(labelsOf(rowsOf(weeks.root)[1]!).some((label) => /^30 бер\.? – 5 кві/.test(label))).toBe(
      true,
    );
  });

  it('FR-I18N-1: a locale change relabels the cells in place: the nodes stay, only the text moves', () => {
    const { core, root, redraw } = chart();
    const [months, days] = rowsOf(root);
    const before = [...cellsOf(months!), ...cellsOf(days!)];
    const log = watch(root);

    core.setOptions({ locale: 'uk' });
    redraw();

    const after = [...cellsOf(rowsOf(root)[0]!), ...cellsOf(rowsOf(root)[1]!)];
    expect(after).toEqual(before);
    const ukrainian = ['лютий 2026 р.', 'березень 2026 р.', 'квітень 2026 р.'];
    expect(labelsOf(rowsOf(root)[0]!)).toEqual(ukrainian);
    // Day numbers read the same in both: their text node is not written again.
    expect(
      log
        .take()
        .filter((record) => record.type === 'characterData')
        .map((record) => (record.target as Text).data),
    ).toEqual(ukrainian);
    log.stop();
  });

  it('FR-I18N-1: a locale with its own digits and calendar year labels the cells in them', () => {
    const buddhist = chart({ locale: 'th-TH-u-ca-buddhist' });
    const arabic = chart({ locale: 'ar-EG' });

    expect(labelsOf(rowsOf(buddhist.root)[0]!).every((label) => label.includes('2569'))).toBe(true);
    expect(labelsOf(rowsOf(arabic.root)[1]!).every((label) => /^[٠-٩]+$/.test(label))).toBe(true);
  });

  it('FR-I18N-1: going back to the first locale restores the first labels', () => {
    const { core, root, redraw } = chart();
    const first = labelsOf(rowsOf(root)[0]!);

    core.setOptions({ locale: 'uk' });
    redraw();
    core.setOptions({ locale: 'en' });
    redraw();

    expect(labelsOf(rowsOf(root)[0]!)).toEqual(first);
  });

  it('FR-SCALE-4: a cell is as wide as its real interval, so a month is one merged cell', () => {
    const { root } = chart();

    const march = cellAt(rowsOf(root)[0]!, 'March 2026')!;
    expect(num(march, 'left')).toBe(520);
    expect(num(march, 'width')).toBe(31 * 40);
  });

  it('FR-SCALE-4: cells are clipped to the content, never extending the scroller', () => {
    const { core, root, redraw } = chart();
    const { contentWidth } = core.getSnapshot();
    core.scroll({ left: contentWidth, top: 0 });
    redraw();
    const first = chart();

    for (const view of [root, first.root]) {
      for (const cell of allCells(view)) {
        const x = num(cell, 'left');
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + num(cell, 'width')).toBeLessThanOrEqual(contentWidth);
      }
    }
    // February starts before the content: its cell starts at 0 with the visible part only.
    const february = cellAt(rowsOf(first.root)[0]!, 'February 2026')!;
    expect(num(february, 'left')).toBe(0);
    expect(num(february, 'width')).toBe(520);
  });

  it('FR-THEME-6: geometry goes through the CSSOM as left / width / height only', () => {
    const set = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    const { core, root, redraw } = chart();
    core.send({ type: 'move', pointerId: 1, time: 0, ...overBar(core, 'design') });
    redraw();

    // Rows, cells, the marker and the range: no custom properties, no style text.
    expect(new Set(set.mock.calls.map(([name]) => name))).toEqual(
      new Set(['height', 'left', 'width']),
    );
    const [first] = allCells(root);
    expect(first!.style.getPropertyValue('left')).toMatch(/^\d+(\.\d+)?px$/);
    expect(first!.style.getPropertyValue('width')).toMatch(/^\d+(\.\d+)?px$/);
    expect(
      root.querySelector<HTMLElement>('.gantt__header-range')!.style.getPropertyValue('width'),
    ).not.toBe('');
  });

  it('FR-SCALE-5: a cell that begins on a major grid line has data-major', () => {
    const { root } = chart();

    // The day mode has major lines at week starts: Mondays, 2026-03-02 is one.
    const days = rowsOf(root)[1]!;
    expect(cellAt(days, '2')!.hasAttribute('data-major')).toBe(true);
    expect(cellAt(days, '9')!.hasAttribute('data-major')).toBe(true);
    expect(cellAt(days, '3')!.hasAttribute('data-major')).toBe(false);
    expect(cellAt(days, '4')!.hasAttribute('data-major')).toBe(false);
  });
});

describe('header virtualization (NFR-PERF-3, FR-SCALE-4)', () => {
  it('NFR-PERF-3: only the cells near the viewport exist, however long the range is', () => {
    // 20 years in the hour mode: 960 px a day, about 7 million px of content.
    const { core, root } = chart(
      {
        tasks: [
          { id: 'early', name: 'Early', start: '2020-01-06', end: '2020-01-10' },
          { id: 'late', name: 'Late', start: '2040-01-06', end: '2040-01-10' },
        ],
      },
      'hour',
    );

    expect(core.getSnapshot().contentWidth).toBeGreaterThan(5_000_000);
    const [days, hours] = rowsOf(root).map(cellsOf);
    // 800 px of viewport + 2 × 400 px of overscan, 40 px an hour.
    expect(hours!.length).toBeGreaterThan(30);
    expect(hours!.length).toBeLessThan(60);
    expect(days!.length).toBeLessThan(6);
  });

  it('NFR-PERF-3: a viewport that is wider draws more cells, in proportion', () => {
    const narrow = chart();
    const wide = chart();
    wide.core.setViewport({ width: 1600, height: 400 });
    wide.redraw();

    const count = (view: Chart): number => cellsOf(rowsOf(view.root)[1]!).length;
    expect(count(wide)).toBeGreaterThan(count(narrow));
    expect(count(wide)).toBeLessThan(count(narrow) * 2 + 5);
  });

  it('NFR-PERF-1: a scroll inside the drawn window keeps every node and writes nothing', () => {
    const { core, root, redraw } = chart();
    const before = allCells(root);
    const changes = watch(root);

    // Still inside the 4th (x 640…680): no boundary is crossed either.
    core.scroll({ left: 650, top: 0 });
    redraw();
    core.scroll({ left: 675, top: 0 });
    redraw();

    expect(allCells(root)).toEqual(before);
    allCells(root).forEach((cell, i) => {
      expect(cell).toBe(before[i]);
    });
    expect(changes.take()).toEqual([]);
    changes.stop();
  });

  it('NFR-PERF-1: a scroll past the drawn window keeps the nodes of the cells that stay', () => {
    const { core, root, redraw } = chart();
    const before = allCells(root);
    const days = (): HTMLElement[] => cellsOf(rowsOf(root)[1]!);
    const firstDay = days()[0]!;

    core.scroll({ left: 1000, top: 0 });
    redraw();

    const after = allCells(root);
    expect(after).not.toEqual(before);
    // The cells in both windows are the same nodes; the ones that left are detached.
    expect(after.filter((cell) => before.includes(cell)).length).toBeGreaterThan(10);
    expect(firstDay.isConnected).toBe(false);
    expect(days().at(-1)!.isConnected).toBe(true);
  });

  it('NFR-PERF-1: an unchanged snapshot, and a hover that changes nothing here, write nothing', () => {
    const { root, refresh } = chart();
    const changes = watch(root);

    refresh();
    refresh();

    expect(changes.take()).toEqual([]);
    changes.stop();
  });

  it('NFR-PERF-2: reads no layout', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const { core, redraw } = chart();

    core.scroll({ left: 2000, top: 0 });
    redraw();

    expect(rect).not.toHaveBeenCalled();
  });
});

describe('header sticky label (FR-SCALE-4)', () => {
  const stickyLabels = (root: Element): string[] =>
    rowsOf(root).map(
      (row) => cellsOf(row).find((cell) => cell.querySelector('[data-sticky]'))?.textContent ?? '',
    );

  it('FR-SCALE-4: the label of the cell under the left edge is sticky, once per row', () => {
    const { root } = chart();

    // The chart opens at x = 640: March in the month row, the 4th in the day row.
    expect(root.querySelectorAll('[data-sticky]')).toHaveLength(2);
    expect(stickyLabels(root)).toEqual(['March 2026', '4']);
    expect(root.querySelector('[data-sticky]')?.classList.contains('gantt__header-label')).toBe(
      true,
    );
  });

  it('FR-SCALE-4: the flag moves to the next cell as the left edge crosses a boundary', () => {
    const { core, root, redraw } = chart();
    const changes = watch(root);

    // 500 is inside the drawn window: February (x 0…520) and the 28th (x 480…520).
    core.scroll({ left: 500, top: 0 });
    redraw();

    expect(stickyLabels(root)).toEqual(['February 2026', '28']);
    const records = changes.take();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.attributeName === 'data-sticky')).toBe(true);
    changes.stop();
  });

  it('FR-SCALE-4: a scroll within a cell leaves the flag where it is', () => {
    const { core, root, redraw } = chart();
    const before = root.querySelectorAll('[data-sticky]');

    core.scroll({ left: 660, top: 0 });
    redraw();

    expect(root.querySelectorAll('[data-sticky]')[0]).toBe(before[0]);
    expect(stickyLabels(root)).toEqual(['March 2026', '4']);
  });

  it('FR-SCALE-4: the flag follows the left edge across a redraw', () => {
    const { core, root, redraw } = chart();

    core.scroll({ left: 1800, top: 0 });
    redraw();

    expect(stickyLabels(root)).toEqual(['April 2026', '2']);
    expect(root.querySelectorAll('[data-sticky]')).toHaveLength(2);
  });
});

describe('header today marker (FR-UI-1)', () => {
  it('FR-UI-1: marks the cell that contains now and puts the marker at now', () => {
    const { core, root } = chart();

    const [months, days] = rowsOf(root);
    expect(months!.querySelectorAll('[data-current]')).toHaveLength(1);
    expect(labelOf(months!.querySelector('[data-current]')!)).toBe('March 2026');
    expect(days!.querySelectorAll('[data-current]')).toHaveLength(1);
    expect(labelOf(days!.querySelector('[data-current]')!)).toBe('4');
    const marker = root.querySelector<HTMLElement>('.gantt__today-marker')!;
    const x = core.getSnapshot().header.scale.dateToX(Date.UTC(2026, 2, 4, 10, 30) as never);
    expect(num(marker, 'left')).toBeCloseTo(x, 6);
    expect(x).toBe(657.5);
  });

  it('FR-UI-1: display.today = false removes the marker and the current cell', () => {
    const { harness, root, refresh } = chart();
    expect(root.querySelector('.gantt__today-marker')).not.toBeNull();

    harness.setDisplay({ today: false });
    refresh();

    expect(root.querySelector('.gantt__today-marker')).toBeNull();
    expect(root.querySelector('[data-current]')).toBeNull();

    harness.setDisplay({ today: true });
    refresh();

    expect(root.querySelector('.gantt__today-marker')).not.toBeNull();
    expect(root.querySelectorAll('[data-current]')).toHaveLength(2);
  });

  it('FR-UI-1: a today outside the content has no marker and no current cell', () => {
    vi.setSystemTime(new Date(2030, 0, 1));
    const { root } = chart();

    expect(root.querySelector('.gantt__today-marker')).toBeNull();
    expect(root.querySelector('[data-current]')).toBeNull();
  });

  it('FR-UI-1: the marker and the current cell follow the clock', () => {
    const { core, root, redraw } = chart();
    const marker = root.querySelector<HTMLElement>('.gantt__today-marker')!;

    vi.setSystemTime(new Date(2026, 2, 5, 10, 30));
    core.refreshNow();
    core.scroll({ left: 660, top: 0 });
    redraw();

    expect(root.querySelector('.gantt__today-marker')).toBe(marker);
    expect(num(marker, 'left')).toBe(697.5);
    expect(labelOf(rowsOf(root)[1]!.querySelector('[data-current]')!)).toBe('5');
  });

  it('FR-UI-1: draws the core`s `now`, not the system clock, and moves only on `refreshNow`', () => {
    // The system clock says 2026-03-04 10:30; the chart's `now` option says another day.
    const { core, root, redraw } = chart({ now: () => '2026-03-10T06:00' });
    const marker = root.querySelector<HTMLElement>('.gantt__today-marker')!;
    expect(num(marker, 'left')).toBe(
      core.getSnapshot().header.scale.dateToX(Date.UTC(2026, 2, 10, 6) as never),
    );
    expect(labelOf(rowsOf(root)[1]!.querySelector('[data-current]')!)).toBe('10');

    // A clock that ran on does nothing until the core is told to read it again.
    vi.setSystemTime(new Date(2027, 0, 1));
    redraw();
    expect(num(marker, 'left')).toBe(
      core.getSnapshot().header.scale.dateToX(Date.UTC(2026, 2, 10, 6) as never),
    );
  });

  it('FR-UI-1: crossing midnight moves the marker and the current cell after `refreshNow`', () => {
    let clock = new Date(2026, 2, 4, 23, 59, 30);
    const { core, root, redraw } = chart({ now: () => clock });
    expect(labelOf(rowsOf(root)[1]!.querySelector('[data-current]')!)).toBe('4');

    clock = new Date(2026, 2, 5, 0, 0, 10);
    core.refreshNow();
    redraw();

    expect(labelOf(rowsOf(root)[1]!.querySelector('[data-current]')!)).toBe('5');
    expect(root.querySelectorAll('[data-current]')).toHaveLength(2);
  });
});

describe('header range highlight (FR-BAR-4)', () => {
  const range = (root: Element): HTMLElement | null =>
    root.querySelector<HTMLElement>('.gantt__header-range');

  it('FR-BAR-4: shows the range of the hovered bar and removes it when the pointer leaves', () => {
    const { core, root, redraw } = chart();
    expect(range(root)).toBeNull();
    const bar = core.getBarRect('design')!;

    core.send({ type: 'move', pointerId: 1, time: 0, ...overBar(core, 'design') });
    redraw();

    const element = range(root)!;
    expect(num(element, 'left')).toBe(bar.x);
    expect(num(element, 'width')).toBe(bar.width);

    // Another bar: the same element follows.
    core.send({ type: 'move', pointerId: 1, time: 1, ...overBar(core, 'build') });
    redraw();
    expect(range(root)).toBe(element);
    expect(num(element, 'left')).toBe(core.getBarRect('build')!.x);

    core.send({ type: 'move', pointerId: 1, time: 2, x: 5, y: 150 });
    redraw();
    expect(range(root)).toBeNull();
  });

  it('FR-BAR-4: follows the dragged bar while it is dragged', () => {
    const { core, root, redraw } = chart();
    const start = overBar(core, 'design');

    core.send({ type: 'move', pointerId: 1, time: 0, ...start });
    core.send({ type: 'down', pointerId: 1, time: 1, ...start });
    core.send({ type: 'move', pointerId: 1, time: 2, x: start.x + 80, y: start.y });
    const snapshot = redraw();

    expect(snapshot.feedback.phase).toBe('dragging');
    const dragged = snapshot.layout.getBarRect('design')!;
    expect(dragged.x).toBeGreaterThan(560);
    expect(num(range(root)!, 'left')).toBe(dragged.x);
  });

  it('FR-BAR-4: display.headerRangeHighlight = false hides it', () => {
    const { core, harness, root, redraw, refresh } = chart();
    core.send({ type: 'move', pointerId: 1, time: 0, ...overBar(core, 'design') });
    redraw();
    expect(range(root)).not.toBeNull();

    harness.setDisplay({ headerRangeHighlight: false });
    refresh();

    expect(range(root)).toBeNull();
  });

  it('FR-ROW-3: a hovered row without a bar (a placeholder) highlights nothing', () => {
    const { core, root, redraw } = chart({
      tasks: [
        { id: 'plan', name: 'Plan', type: 'placeholder' },
        { id: 'real', name: 'Real', start: '2026-03-02', end: '2026-03-04' },
      ],
    });

    core.send({ type: 'move', pointerId: 1, time: 0, x: 700, y: 20 });
    redraw();

    expect(range(root)).toBeNull();
  });
});

describe('header lifecycle', () => {
  it('FR-API-1: destroy removes the rows, the range and the marker', () => {
    const { core, layer, root, redraw } = chart();
    core.send({ type: 'move', pointerId: 1, time: 0, ...overBar(core, 'design') });
    redraw();
    expect(root.querySelector('.gantt__header-range')).not.toBeNull();
    expect(root.querySelector('.gantt__today-marker')).not.toBeNull();

    layer.destroy();

    expect(root.childNodes).toHaveLength(0);
  });

  it('FR-API-1: destroy before any update, and an update before mount, do nothing', () => {
    const harness = createLayerHarness('header');
    const layer = createHeaderLayer();
    const core = createTestCore();
    core.setViewport({ width: 800, height: 400 });

    layer.update(core.getSnapshot(), undefined);
    layer.mount(harness.context);
    layer.destroy();
    layer.destroy();

    expect(harness.root.childNodes).toHaveLength(0);
  });
});

/** The core a fixture describes, as the playground creates it. */
function coreOf(fixture: Fixture) {
  return createTestCore({
    tasks: fixture.tasks,
    links: fixture.links,
    ...(fixture.calendar && { calendar: fixture.calendar }),
    ...fixture.options,
  });
}

describe('real data (@ganttlane/fixtures)', () => {
  it.each(
    fixtureCatalog
      .filter((entry) => entry.id !== 'generated-10k')
      .map((entry) => [entry.id, entry] as const),
  )('FR-SCALE-4: draws the header of the fixture %s and removes it again', (_id, entry) => {
    const core = coreOf(entry.load());
    core.setViewport({ width: 900, height: 500 });
    const harness = createLayerHarness('header');
    const layer = createHeaderLayer();
    layer.mount(harness.context);

    const snapshot = core.getSnapshot();
    layer.update(snapshot, undefined);

    expect(rowsOf(harness.root)).toHaveLength(snapshot.viewMode.headers.length);
    for (const row of rowsOf(harness.root)) expect(cellsOf(row).length).toBeGreaterThan(0);
    layer.destroy();
    expect(harness.root.childNodes).toHaveLength(0);
  });
});
