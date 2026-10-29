import { deepFreeze, workingDayScenarios } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar, type WorkCalendarOptions } from '../calendar';
import { buildHierarchy, type Hierarchy, visibleRows } from '../hierarchy';
import { createLayout, layoutRows, type LinkPoint, type RowLayout } from '../layout';
import {
  type DurationMode,
  type Link,
  type NormalizedModel,
  normalizeModel,
  type Task,
  type TaskId,
} from '../model';
import {
  createTimeScale,
  resolveSnap,
  type SnapInput,
  VIEW_MODE_PRESETS,
  type ViewModeId,
} from '../scale';
import { buildLinkGraph, type Change, type PropagationOptions } from '../schedule';
import {
  asDateTimeMs,
  createFloatingAdapter,
  type DateTimeMs,
  DAY,
  type DurationInput,
  parseDateInput,
  toISODate,
  toISODateTime,
} from '../time';
import {
  type AutoScrollOptions,
  ensureContains,
  planExtension,
  rebaseTimeline,
  type TimelineState,
} from '../viewport';
import {
  barHandles,
  createInteraction,
  type EditingOption,
  type HitTarget,
  type Interaction,
  type InteractionContext,
  type InteractionEffect,
  type InteractionEvent,
  type InteractionModifiers,
  type InteractionOptions,
  type PointerInput,
  type TaskPart,
} from './index';

const adapter = createFloatingAdapter();

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

/** What a test chart is made of; every field has a default. */
interface Setup {
  readonly tasks: readonly Task[];
  readonly links?: readonly Link[];
  /** Default `'day'` (40 px per day). */
  readonly viewMode?: ViewModeId;
  readonly granularity?: DurationInput;
  readonly snap?: SnapInput;
  readonly keepDayPrecision?: boolean;
  /** Default: Saturdays and Sundays off. */
  readonly calendar?: WorkCalendarOptions;
  readonly durationMode?: DurationMode;
  readonly editing?: EditingOption;
  readonly propagation?: PropagationOptions;
  readonly autoScroll?: AutoScrollOptions | false;
  readonly busy?: boolean;
  /** Default 2026-03-01 … 2026-04-01. */
  readonly range?: readonly [string, string];
  readonly scrollLeft?: number;
  /** Default 2000 px: no autoscroll unless a test narrows it. */
  readonly viewportWidth?: number;
  /** Vertical scroll offset of the body, default 0. */
  readonly scrollTop?: number;
}

interface Data {
  readonly model: NormalizedModel;
  readonly hierarchy: Hierarchy;
  readonly rows: RowLayout;
}

function dataOf(setup: Setup): Data {
  const { calendar } = createWorkCalendar(setup.calendar ?? { weekends: [0, 6] });
  const model = normalizeModel(
    { tasks: deepFreeze([...setup.tasks]), links: deepFreeze([...(setup.links ?? [])]) },
    { calendar, granularity: setup.granularity, durationMode: setup.durationMode },
  );
  expect(model.issues).toEqual([]);
  const hierarchy = buildHierarchy(model);
  return { model, hierarchy, rows: layoutRows(visibleRows(hierarchy, 'all')) };
}

function contextOf(setup: Setup, data: Data, timeline: TimelineState): InteractionContext {
  const { model, hierarchy, rows } = data;
  const viewMode = VIEW_MODE_PRESETS.find((mode) => mode.id === (setup.viewMode ?? 'day'))!;
  const { snap, issues } = resolveSnap({
    viewMode,
    option: setup.snap,
    granularity: model.options.granularity,
    keepDayPrecision: setup.keepDayPrecision,
  });
  expect(issues).toEqual([]);
  return {
    model,
    hierarchy,
    graph: buildLinkGraph(model),
    layout: createLayout({ rows, tasks: model.taskById, scale: timeline.scale }),
    timeline,
    snap,
    adapter,
    propagation: setup.propagation,
    editing: setup.editing,
    autoScroll: setup.autoScroll,
    busy: setup.busy,
    scrollTop: setup.scrollTop,
  };
}

/**
 * Drives a machine like an input adapter: the pointer lives in viewport pixels and every event
 * carries content x (`viewport x + scrollLeft`) and body y (`viewport y + scrollTop`) of the
 * current context. Effects are logged as text (`effectText`), feedback left out.
 */
class Harness {
  readonly interaction: Interaction;
  readonly log: string[] = [];
  readonly effects: InteractionEffect[] = [];
  setup: Setup;
  data: Data;
  ctx: InteractionContext;
  vx = 0;
  y = 0;
  time = 0;

  constructor(setup: Setup, options?: InteractionOptions) {
    this.interaction = createInteraction(options);
    this.setup = setup;
    this.data = dataOf(setup);
    const viewMode = VIEW_MODE_PRESETS.find((mode) => mode.id === (setup.viewMode ?? 'day'))!;
    const [first, last] = setup.range ?? ['2026-03-01', '2026-04-01'];
    const range = { start: at(first), end: at(last) };
    const scale = createTimeScale({ origin: range.start, pxPerDay: viewMode.pxPerDay });
    this.ctx = contextOf(setup, this.data, {
      range,
      scale,
      scrollLeft: setup.scrollLeft ?? 0,
      viewportWidth: setup.viewportWidth ?? 2000,
    });
  }

  send(event: InteractionEvent): readonly InteractionEffect[] {
    const out = this.interaction.send(event, this.ctx);
    expect(Object.isFrozen(out)).toBe(true);
    this.effects.push(...out);
    for (const effect of out)
      if (effect.type !== 'feedback') this.log.push(effectText(effect, this));
    return out;
  }

  pointer(type: PointerInput['type'], extra: Partial<PointerInput> = {}): this {
    this.time += 16;
    const x = this.vx + this.ctx.timeline.scrollLeft;
    const y = this.y + (this.ctx.scrollTop ?? 0);
    this.send({ type, pointerId: 1, x, y, time: this.time, ...extra });
    return this;
  }

  /** Presses at a content point (e.g. {@link Harness.on}). */
  down(point: LinkPoint, extra?: Partial<PointerInput>): this {
    this.vx = point.x - this.ctx.timeline.scrollLeft;
    this.y = point.y - (this.ctx.scrollTop ?? 0);
    return this.pointer('down', extra);
  }

  /** Moves the pointer by viewport pixels. */
  move(dx: number, dy = 0, extra?: Partial<PointerInput>): this {
    this.vx += dx;
    this.y += dy;
    return this.pointer('move', extra);
  }

  /** Moves the pointer to a content point. */
  moveTo(point: LinkPoint, extra?: Partial<PointerInput>): this {
    this.vx = point.x - this.ctx.timeline.scrollLeft;
    this.y = point.y - (this.ctx.scrollTop ?? 0);
    return this.pointer('move', extra);
  }

  up(extra?: Partial<PointerInput>): this {
    return this.pointer('up', extra);
  }

  click(point: LinkPoint, extra?: Partial<PointerInput>): this {
    return this.down(point, extra).up(extra);
  }

  /** Presses at `point`, moves by `dx` viewport px (in two steps) and releases. */
  drag(point: LinkPoint, dx: number, extra?: Partial<PointerInput>): this {
    return this.down(point, extra)
      .move(dx / 2, 0, extra)
      .move(dx / 2, 0, extra)
      .up(extra);
  }

  key(key: string, modifiers?: InteractionModifiers): this {
    this.send({ type: 'key', key, modifiers });
    return this;
  }

  cancel(pointerId?: number): this {
    this.send({ type: 'cancel', pointerId });
    return this;
  }

  wait(ms: number): this {
    this.time += ms;
    return this;
  }

  /** Replaces the timeline (scroll, extension, rebase) and reports it; the layout follows. */
  retime(timeline: TimelineState): this {
    this.ctx = { ...this.ctx, timeline, layout: contextOf(this.setup, this.data, timeline).layout };
    this.send({ type: 'timeline' });
    return this;
  }

  scroll(dx: number): this {
    return this.retime({ ...this.ctx.timeline, scrollLeft: this.ctx.timeline.scrollLeft + dx });
  }

  /** Scrolls the body vertically by `dy` px under the still pointer and reports it. */
  scrollY(dy: number): this {
    this.update({ scrollTop: (this.setup.scrollTop ?? 0) + dy });
    this.send({ type: 'timeline' });
    return this;
  }

  /** Changes the chart (data, options, busy) mid-gesture, keeping the timeline. */
  update(patch: Partial<Setup>): this {
    this.setup = { ...this.setup, ...patch };
    if (patch.tasks !== undefined || patch.links !== undefined) this.data = dataOf(this.setup);
    this.ctx = contextOf(this.setup, this.data, this.ctx.timeline);
    return this;
  }

  /** A content point on a part of a task's bar. */
  on(id: TaskId, part: TaskPart = 'body'): LinkPoint {
    const bar = this.ctx.layout.getBarRect(id)!;
    const mid = bar.y + bar.height / 2;
    const handles = barHandles(bar);
    const centre = (rect: { x: number; y: number; width: number; height: number }): LinkPoint => ({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    });
    switch (part) {
      case 'body':
        return { x: bar.x + bar.width / 2, y: mid };
      case 'resize-start':
        return { x: bar.x + 2, y: mid };
      case 'resize-end':
        return { x: bar.x + bar.width - 2, y: mid };
      case 'progress':
        return { x: bar.x + bar.progressWidth, y: bar.y + bar.height + 2 };
      case 'link-start':
        return centre(handles.linkStart);
      case 'link-end':
        return centre(handles.linkEnd);
    }
  }

  /** Content x of a date. */
  x(iso: string): number {
    return this.ctx.timeline.scale.dateToX(at(iso));
  }

  /** Effects of one type. */
  of<T extends InteractionEffect['type']>(type: T): Extract<InteractionEffect, { type: T }>[] {
    return this.effects.filter((effect) => effect.type === type) as Extract<
      InteractionEffect,
      { type: T }
    >[];
  }
}

function targetText(target: HitTarget): string {
  switch (target.kind) {
    case 'task':
      return `task:${target.id}:${target.part}`;
    case 'link':
      return `link:${target.id}`;
    case 'empty':
      return target.rowId === undefined ? 'empty' : `empty:${target.rowId}`;
  }
}

/** A change as `id first..last` (day precision) or `id start..endExclusive`, plus progress. */
function changeText(change: Change, h: Harness): string {
  const model = h.ctx.model.taskById.get(change.id);
  const precision = change.after.precision ?? model?.precision ?? 'day';
  const { start, endExclusive, progress } = change.after;
  const span =
    precision === 'time'
      ? `${toISODateTime(start)}..${toISODateTime(endExclusive)}`
      : endExclusive === start
        ? toISODate(start)
        : `${toISODate(start)}..${toISODate(asDateTimeMs(endExclusive - DAY))}`;
  const done = progress === change.before.progress ? '' : ` ${Math.round(progress * 100) / 100}%`;
  return `${String(change.id)} ${span}${done}`;
}

function effectText(effect: InteractionEffect, h: Harness): string {
  switch (effect.type) {
    case 'preview':
    case 'commit':
      return `${effect.type} ${effect.changeSet.changes.map((c) => changeText(c, h)).join(', ')}`;
    case 'cancel-preview':
      return 'cancel-preview';
    case 'link-preview': {
      const { preview } = effect;
      if (preview === undefined) return 'link-preview off';
      const why = preview.refusal === undefined ? '' : ` (${preview.refusal})`;
      return `link-preview ${String(preview.source)}→${String(preview.target ?? '·')}${why}`;
    }
    case 'create-link': {
      const { source, target, type } = effect.link;
      return `create-link ${String(source)}-${String(type)}->${String(target)}`;
    }
    case 'autoscroll':
      return `autoscroll ${effect.velocity}`;
    case 'extend-range': {
      const { start, end } = effect.target;
      return start === end
        ? `extend-range at ${toISODate(start)}`
        : `extend-range ${toISODate(start)}..${toISODate(asDateTimeMs(end - DAY))}`;
    }
    case 'click':
    case 'double-click':
      return `${effect.type} ${targetText(effect.target)}`;
    case 'refused': {
      const to = effect.target === undefined ? '' : `->${String(effect.target)}`;
      return `refused ${effect.gesture} ${String(effect.id)}${to} ${effect.reason} at ${effect.at}`;
    }
    case 'feedback':
      return `feedback ${effect.feedback.phase} ${effect.feedback.cursor}`;
  }
}

/** Monday–Friday, 2026-03-02 … 03-06: x 40 … 240 in the day mode, row 0 (bar y 9 … 39). */
const A: Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' };
/** The next Monday–Friday, 03-09 … 03-13: x 320 … 520, row 1. */
const B: Task = { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' };
/** Two weeks, Monday 03-02 … Sunday 03-15. */
const P: Task = { id: 'p', name: 'P', start: '2026-03-02', end: '2026-03-15' };

/** A table row: a chart, a script of input events, and the effects it must produce. */
interface Case {
  readonly name: string;
  readonly setup: Setup;
  readonly script: (h: Harness) => unknown;
  readonly expected: readonly string[];
  readonly options?: InteractionOptions;
}

function run(cases: readonly Case[]): void {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const h = new Harness(c.setup, c.options);
    c.script(h);
    expect(h.log).toEqual(c.expected);
  });
}

describe('createInteraction: gestures', () => {
  run([
    {
      name: 'FR-EDIT-1: moving the body by two days previews and commits the move',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(2).move(78).up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'commit a 2026-03-04..2026-03-08'],
    },
    {
      name: 'FR-EDIT-5: the preview propagates to a linked successor',
      setup: { tasks: [A, B], links: [{ source: 'a', target: 'b' }] },
      script: (h) => h.drag(h.on('a'), 80),
      expected: [
        'preview a 2026-03-03..2026-03-07, b 2026-03-10..2026-03-14',
        'preview a 2026-03-04..2026-03-08, b 2026-03-11..2026-03-15',
        'commit a 2026-03-04..2026-03-08, b 2026-03-11..2026-03-15',
      ],
    },
    {
      name: 'FR-EDIT-5: the preview moves children with their parent',
      setup: {
        tasks: [A, { id: 'c', name: 'C', parentId: 'a', start: '2026-03-03', end: '2026-03-04' }],
      },
      script: (h) => h.down(h.on('a')).move(-80).up(),
      // Moved back onto a Saturday: the start skips back to Friday (FR-SNAP-8).
      expected: [
        'preview a 2026-02-27..2026-03-03, c 2026-02-28..2026-03-01',
        'extend-range 2026-02-27..2026-03-03',
        'commit a 2026-02-27..2026-03-03, c 2026-02-28..2026-03-01',
      ],
    },
    {
      name: 'FR-EDIT-1: the end handle resizes the end',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a', 'resize-end')).move(40).up(),
      expected: ['preview a 2026-03-02..2026-03-07', 'commit a 2026-03-02..2026-03-07'],
    },
    {
      name: 'FR-EDIT-1, FR-TL-5: the start handle resizes the start, past the range',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a', 'resize-start')).move(-80).up(),
      // The pointer left the viewport: autoscroll at full speed until the release. Only the
      // dragged edge has to come into the range.
      expected: [
        'preview a 2026-02-28..2026-03-06',
        'extend-range at 2026-02-28',
        'autoscroll -20',
        'commit a 2026-02-28..2026-03-06',
        'autoscroll 0',
      ],
    },
    {
      name: 'FR-SNAP-6: a resize keeps one step',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a', 'resize-end')).move(-150).up(),
      expected: ['preview a 2026-03-02..2026-03-02', 'commit a 2026-03-02..2026-03-02'],
    },
    {
      name: 'FR-SNAP-6: a resize of the start keeps one step',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a', 'resize-start')).move(600).up(),
      expected: ['preview a 2026-03-06..2026-03-06', 'commit a 2026-03-06..2026-03-06'],
    },
    {
      name: 'FR-BAR-6: a milestone moves',
      setup: { tasks: [{ id: 'm', name: 'M', type: 'milestone', start: '2026-03-04' }] },
      script: (h) => h.down(h.on('m')).move(40).up(),
      expected: ['preview m 2026-03-05', 'commit m 2026-03-05'],
    },
    {
      name: 'FR-PROG-3: dragging progress onto a Sunday skips to Monday',
      setup: { tasks: [P] },
      script: (h) =>
        h
          .down(h.on('p', 'progress'))
          .moveTo({ x: h.x('2026-03-08') + 10, y: h.y })
          .up(),
      expected: ['preview p 2026-03-02..2026-03-15 50%', 'commit p 2026-03-02..2026-03-15 50%'],
    },
    {
      name: 'FR-PROG-3: dragging progress back onto a Sunday skips to Saturday 00:00',
      setup: { tasks: [{ ...P, progress: 50 }] },
      script: (h) =>
        h
          .down(h.on('p', 'progress'))
          .moveTo({ x: h.x('2026-03-08') + 10, y: h.y })
          .up(),
      expected: [
        'preview p 2026-03-02..2026-03-15 35.71%',
        'commit p 2026-03-02..2026-03-15 35.71%',
      ],
    },
    {
      name: 'FR-PROG-3: without skipping the progress stays on the Sunday',
      setup: { tasks: [P], propagation: { skipNonWorkingDays: { progress: false } } },
      script: (h) =>
        h
          .down(h.on('p', 'progress'))
          .moveTo({ x: h.x('2026-03-08') + 10, y: h.y })
          .up(),
      expected: [
        'preview p 2026-03-02..2026-03-15 42.86%',
        'commit p 2026-03-02..2026-03-15 42.86%',
      ],
    },
    {
      name: 'FR-PROG-3: progress is clamped to the bar',
      setup: { tasks: [P] },
      script: (h) => h.down(h.on('p', 'progress')).move(800).up(),
      expected: ['preview p 2026-03-02..2026-03-15 100%', 'commit p 2026-03-02..2026-03-15 100%'],
    },
    {
      name: 'FR-PROG-3: progress dragged back to where it was commits nothing',
      setup: { tasks: [P] },
      script: (h) => h.down(h.on('p', 'progress')).move(120).move(-120).up(),
      expected: ['preview p 2026-03-02..2026-03-15 21.43%', 'cancel-preview'],
    },
    {
      name: 'FR-PROG-3, FR-SNAP-15: a progress drag that snaps back onto the handle keeps an unaligned progress',
      setup: { tasks: [{ ...A, progress: 33 }] },
      script: (h) => h.down(h.on('a', 'progress')).move(5).up(),
      expected: [],
    },
    {
      name: 'FR-PROG-3, FR-SNAP-15: a two-week task at 10 % keeps its progress on a short drag',
      setup: { tasks: [{ ...P, progress: 10 }] },
      script: (h) => h.down(h.on('p', 'progress')).move(5).up(),
      expected: [],
    },
    {
      name: 'FR-PROG-3: an unaligned progress dragged away and back onto the handle commits nothing',
      setup: { tasks: [{ ...P, progress: 10 }] },
      script: (h) => h.down(h.on('p', 'progress')).move(80).move(-80).up(),
      expected: ['preview p 2026-03-02..2026-03-15 21.43%', 'cancel-preview'],
    },
    {
      name: 'FR-SCH-4, FR-SNAP-6: a start resized past the minimum onto a weekend stops on the last working day',
      setup: {
        tasks: [{ ...A, end: '2026-03-08' }],
        propagation: { skipNonWorkingDays: { resize: true } },
      },
      // Saturday rolls to Monday, past the minimum: clamped to Sunday, then back to Friday.
      script: (h) => h.down(h.on('a', 'resize-start')).move(200).up(),
      expected: ['preview a 2026-03-06..2026-03-08', 'commit a 2026-03-06..2026-03-08'],
    },
    {
      name: 'FR-SCH-4, FR-SNAP-6: an end resized past the minimum onto a weekend stops on the first working day',
      setup: {
        tasks: [{ id: 'w', name: 'W', start: '2026-03-07', end: '2026-03-11' }],
        propagation: { skipNonWorkingDays: { resize: true } },
      },
      // The end of Saturday is the minimum: it rolls on to the end of Monday.
      script: (h) => h.down(h.on('w', 'resize-end')).move(-160).up(),
      expected: ['preview w 2026-03-07..2026-03-09', 'commit w 2026-03-07..2026-03-09'],
    },
    {
      name: 'FR-SCH-4: a resize that finds no working day before the minimum keeps the edge',
      setup: {
        tasks: [{ id: 'w', name: 'W', start: '2026-03-07', end: '2026-03-08' }],
        propagation: { skipNonWorkingDays: { resize: true } },
      },
      script: (h) => h.down(h.on('w', 'resize-start')).move(40).up(),
      expected: [],
    },
    {
      name: 'FR-EDIT-1: a drag back to the start commits nothing',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(80).move(-80).up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'cancel-preview'],
    },
    {
      name: 'FR-EDIT-1: a release outside the chart commits',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(40).move(1000, -900).up(),
      expected: [
        'preview a 2026-03-03..2026-03-07',
        'preview a 2026-03-30..2026-04-03',
        'extend-range 2026-03-30..2026-04-03',
        'commit a 2026-03-30..2026-04-03',
      ],
    },
  ]);
});

describe('createInteraction: FR-SCH-7 working-day scenarios by drag', () => {
  const scenarios = workingDayScenarios.filter((s) => s.action.onConflict !== 'accept');
  it.each(scenarios.map((s) => [s.id, s] as const))('FR-SCH-7: %s', (_id, scenario) => {
    const { task, calendar } = scenario.given;
    const h = new Harness({
      tasks: [task],
      calendar,
      durationMode: 'working',
      propagation: { skipNonWorkingDays: { move: true, resize: false } },
      range: ['2026-04-01', '2026-05-01'],
    });
    const { kind, to } = scenario.action;
    const record = h.ctx.model.taskById.get(task.id)!;
    const span = record.span!;
    const target = kind === 'resize-end' ? at(to) + DAY : at(to);
    const from = kind === 'resize-end' ? span.endExclusive : span.start;
    const part: TaskPart = kind === 'move' ? 'body' : kind;
    h.drag(h.on(task.id, part), ((target - from) / DAY) * 40);
    const [commit] = h.of('commit');
    const after = commit!.changeSet.changes[0]!.after;
    expect(toISODate(after.start)).toBe(scenario.expected.start);
    expect(toISODate(asDateTimeMs(after.endExclusive - DAY))).toBe(scenario.expected.end);
  });
});

describe('createInteraction: links', () => {
  run([
    {
      name: 'FR-LINK-4: dragging from a link handle to a bar creates a link',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo({ x: 300, y: 50 }).moveTo(h.on('b')).up(),
      expected: ['link-preview a→·', 'link-preview a→b', 'link-preview off', 'create-link a-FS->b'],
    },
    {
      name: 'FR-LINK-4: click on a link handle, then on a bar (click-click)',
      setup: { tasks: [A, B] },
      script: (h) => h.click(h.on('a', 'link-end')).moveTo(h.on('b')).click(h.on('b')),
      expected: ['link-preview a→·', 'link-preview a→b', 'link-preview off', 'create-link a-FS->b'],
    },
    {
      name: 'FR-LINK-4: the link starts at the start handle and uses the default type',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('b', 'link-start')).moveTo(h.on('a', 'link-end')).up(),
      expected: ['link-preview b→a', 'link-preview off', 'create-link b-FS->a'],
    },
    {
      name: 'FR-LINK-6: a link to the source itself is refused',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('a')).up(),
      expected: [
        'link-preview a→a (self)',
        'link-preview off',
        'refused link-create a->a self at commit',
      ],
    },
    {
      name: 'FR-LINK-4: clicking the armed handle again cancels quietly',
      setup: { tasks: [A, B] },
      script: (h) => h.click(h.on('a', 'link-end')).click(h.on('a', 'link-end')),
      expected: ['link-preview a→·', 'link-preview off'],
    },
    {
      name: 'FR-LINK-4: clicking empty space cancels click-click',
      setup: { tasks: [A, B] },
      script: (h) => h.click(h.on('a', 'link-end')).click({ x: 900, y: 20 }),
      expected: ['link-preview a→·', 'link-preview a→·', 'link-preview off'],
    },
    {
      name: 'FR-LINK-6: a target with linkable: false is refused',
      setup: { tasks: [A, { ...B, linkable: false }] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).up(),
      expected: [
        'link-preview a→b (permission)',
        'link-preview off',
        'refused link-create a->b permission at commit',
      ],
    },
    {
      name: 'FR-LINK-6, FR-LINK-7: a link closing a cycle is refused',
      setup: { tasks: [A, B], links: [{ source: 'b', target: 'a' }] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).up(),
      expected: [
        'link-preview a→b (cycle)',
        'link-preview off',
        'refused link-create a->b cycle at commit',
      ],
    },
    {
      name: 'FR-LINK-6: a duplicate link is refused',
      setup: { tasks: [A, B], links: [{ id: 'own', source: 'a', target: 'b' }] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).up(),
      expected: [
        'link-preview a→b (duplicate)',
        'link-preview off',
        'refused link-create a->b duplicate at commit',
      ],
    },
    {
      name: 'FR-LINK-6: an unrelated link with the default id of the new link is no duplicate',
      setup: {
        tasks: [A, B, { id: 'c', name: 'C', start: '2026-03-16', end: '2026-03-20' }],
        links: [{ id: 'a:FS:b', source: 'b', target: 'c' }],
      },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).up(),
      expected: ['link-preview a→b', 'link-preview off', 'create-link a-FS->b'],
    },
    {
      name: 'FR-EDIT-7: a source with linkable: false has no link handles',
      setup: { tasks: [{ ...A, linkable: false }, B] },
      script: (h) => h.down({ x: 250, y: 24 }).moveTo(h.on('b')).up(),
      expected: [],
    },
    {
      name: 'FR-EDIT-7: an explicit link handle target of a non-linkable task is refused',
      setup: { tasks: [{ ...A, linkable: false }, B] },
      script: (h) =>
        h.down({ x: 250, y: 24 }, { target: { kind: 'task', id: 'a', part: 'link-end' } }).move(40),
      expected: ['refused link-create a permission at start'],
    },
    {
      name: 'FR-EDIT-7: editing.links: false refuses click-click arming of an explicit handle',
      setup: { tasks: [A, B], editing: { links: false } },
      script: (h) =>
        h.click({ x: 250, y: 24 }, { target: { kind: 'task', id: 'a', part: 'link-end' } }),
      expected: ['refused link-create a permission at start'],
    },
    {
      name: 'FR-EDIT-7: links disabled before the release are refused at commit',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a', 'link-end'))
          .moveTo(h.on('b'))
          .update({ editing: { links: false } })
          .up(),
      expected: [
        'link-preview a→b',
        'link-preview a→b (permission)',
        'link-preview off',
        'refused link-create a->b permission at commit',
      ],
    },
    {
      name: 'FR-EDIT-4: Escape cancels click-click',
      setup: { tasks: [A, B] },
      script: (h) =>
        h.click(h.on('a', 'link-end')).moveTo(h.on('b')).key('Escape').click(h.on('b')),
      expected: ['link-preview a→·', 'link-preview a→b', 'link-preview off', 'click task:b:body'],
    },
    {
      name: 'FR-EDIT-4: Escape cancels a link drag and swallows the release',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).key('Escape').up(),
      expected: ['link-preview a→b', 'link-preview off'],
    },
    {
      name: 'FR-EDIT-4: a pointer cancel ends a link drag',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).cancel(2).cancel(1).up(),
      expected: ['link-preview a→b', 'link-preview off'],
    },
    {
      name: 'FR-LINK-4: a source bar gone mid-drag ends the gesture',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a', 'link-end'))
          .moveTo(h.on('b'))
          .update({ tasks: [B] })
          .move(5)
          .up(),
      expected: ['link-preview a→b', 'link-preview off'],
    },
  ]);

  it('FR-LINK-4: the preview line runs from the handle to the pointer, then to the target edge', () => {
    const h = new Harness({ tasks: [A, B] });
    h.down(h.on('a', 'link-end')).moveTo({ x: 300, y: 50 });
    const loose = h.interaction.feedback.link!;
    expect(loose.from).toEqual({ x: 250, y: 24 });
    expect(loose.to).toEqual({ x: 300, y: 50 });
    expect(loose.link).toBeUndefined();
    h.moveTo(h.on('b'));
    const snapped = h.interaction.feedback.link!;
    // FS: into the target's start edge, at mid-height.
    expect(snapped.to).toEqual({ x: 320, y: 72 });
    expect(snapped.link).toEqual({ source: 'a', target: 'b', type: 'FS' });
    expect(h.interaction.feedback.cursor).toBe('crosshair');
    h.moveTo(h.on('a'));
    expect(h.interaction.feedback.cursor).toBe('not-allowed');
  });

  it('FR-LINK-4: an FF default type ends at the target end edge', () => {
    const h = new Harness({ tasks: [A, B] });
    h.ctx = {
      ...h.ctx,
      model: { ...h.ctx.model, options: { ...h.ctx.model.options, defaultLinkType: 'FF' } },
    };
    h.down(h.on('a', 'link-end')).moveTo(h.on('b')).up();
    expect(h.of('link-preview')[0]!.preview!.to).toEqual({ x: 520, y: 72 });
    expect(h.log.at(-1)).toBe('create-link a-FF->b');
  });

  it('FR-EDIT-6: a link drag autoscrolls, click-click does not', () => {
    const h = new Harness({ tasks: [A, B], viewportWidth: 400 });
    h.down(h.on('a', 'link-end')).moveTo({ x: 395, y: 120 }).up();
    expect(h.log).toEqual([
      'link-preview a→·',
      'autoscroll 17.5',
      'link-preview off',
      'autoscroll 0',
    ]);
    const armed = new Harness({ tasks: [A, B], viewportWidth: 400 });
    armed.click(armed.on('a', 'link-end')).moveTo({ x: 395, y: 120 });
    expect(armed.of('autoscroll')).toEqual([]);
  });

  it('FR-LINK-4: the preview follows a vertical scroll under a still pointer', () => {
    const h = new Harness({ tasks: [A, B] });
    // Over the first row, right of A: empty.
    h.down(h.on('a', 'link-end')).moveTo({ x: h.on('b').x, y: h.on('a').y });
    expect(h.interaction.feedback.link).toMatchObject({ to: { x: 420, y: 24 }, target: undefined });
    // One row down: B's bar is under the pointer now, the line snaps to its start.
    h.scrollY(48);
    expect(h.interaction.feedback.link).toMatchObject({ to: { x: 320, y: 72 }, target: 'b' });
    h.up();
    expect(h.log.at(-1)).toBe('create-link a-FS->b');
  });

  it('FR-LINK-4: the preview follows the timeline under a still pointer', () => {
    const h = new Harness({ tasks: [A, B], viewportWidth: 400 });
    h.down(h.on('a', 'link-end')).moveTo({ x: 300, y: 72 });
    expect(h.interaction.feedback.link).toMatchObject({ to: { x: 300, y: 72 }, target: undefined });
    // The content moves 30 px under the pointer: it is over `b` now, the line snaps to its start.
    h.scroll(30);
    expect(h.interaction.feedback.link).toMatchObject({ to: { x: 320, y: 72 }, target: 'b' });
  });
});

describe('createInteraction: clicks and the drag threshold (FR-EDIT-3)', () => {
  run([
    {
      name: 'FR-EDIT-3: a press and release is a click',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a')),
      expected: ['click task:a:body'],
    },
    {
      name: 'FR-EDIT-3: a move below the threshold is still a click',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(2, 1).up(),
      expected: ['click task:a:body'],
    },
    {
      name: 'FR-EDIT-3: no click after a drag, even one that changes nothing',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(5).up(),
      expected: [],
    },
    {
      name: 'FR-EDIT-3: touch has a wider threshold',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a'), { pointerType: 'touch' }).move(5).up(),
      expected: ['click task:a:body'],
    },
    {
      name: 'FR-EDIT-3: a custom threshold',
      setup: { tasks: [A] },
      options: { dragThreshold: 50 },
      script: (h) => h.down(h.on('a')).move(45).up(),
      expected: ['click task:a:body'],
    },
    {
      name: 'FR-EDIT-3: two quick clicks are a double click, without blocking the next click',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a')).click(h.on('a')).click(h.on('a')),
      expected: [
        'click task:a:body',
        'click task:a:body',
        'double-click task:a:body',
        'click task:a:body',
      ],
    },
    {
      name: 'FR-EDIT-3: slow clicks are no double click',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a')).wait(600).click(h.on('a')),
      expected: ['click task:a:body', 'click task:a:body'],
    },
    {
      name: 'FR-EDIT-3: clicks far apart are no double click',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a')).click({ ...h.on('a'), x: h.on('a').x + 20 }),
      expected: ['click task:a:body', 'click task:a:body'],
    },
    {
      name: 'FR-EDIT-3: clicks on different targets are no double click',
      setup: { tasks: [A, B] },
      script: (h) => h.click(h.on('a')).click(h.on('b')),
      expected: ['click task:a:body', 'click task:b:body'],
    },
    {
      name: 'FR-EDIT-3: a drag between two clicks breaks the double click',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a')).drag(h.on('a'), 40).click(h.on('a')),
      expected: [
        'click task:a:body',
        'preview a 2026-03-03..2026-03-07',
        'commit a 2026-03-03..2026-03-07',
        'click task:a:body',
      ],
    },
    {
      name: 'FR-EDIT-3: two quick clicks on one bar are a double click across its resize zone',
      setup: { tasks: [A] },
      script: (h) => h.click({ x: 229, y: 24 }).click({ x: 234, y: 24 }),
      expected: ['click task:a:body', 'click task:a:resize-end', 'double-click task:a:resize-end'],
    },
    {
      name: 'FR-EDIT-3, FR-EDIT-4: a press cancelled with Escape breaks the double click',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a')).down(h.on('a')).key('Escape').up().click(h.on('a')),
      expected: ['click task:a:body', 'click task:a:body'],
    },
    {
      name: 'FR-EDIT-3, FR-EDIT-4: a press cancelled by the pointer breaks the double click',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a')).down(h.on('a')).cancel(1).click(h.on('a')),
      expected: ['click task:a:body', 'click task:a:body'],
    },
    {
      name: 'FR-SEL-1: a click on an explicit link target',
      setup: { tasks: [A, B], links: [{ source: 'a', target: 'b' }] },
      script: (h) => h.click({ x: 280, y: 48 }, { target: { kind: 'link', id: 'a:FS:b' } }),
      expected: ['click link:a:FS:b'],
    },
    {
      name: 'a click on empty space reports the row',
      setup: { tasks: [A] },
      script: (h) => h.click({ x: 900, y: 20 }).click({ x: 900, y: 300 }),
      expected: ['click empty:a', 'click empty'],
    },
    {
      name: 'a click on a resize handle is a click on the task',
      setup: { tasks: [A] },
      script: (h) => h.click(h.on('a', 'resize-end')),
      expected: ['click task:a:resize-end'],
    },
    {
      name: 'a press on empty space that moves is neither a click nor a drag',
      setup: { tasks: [A] },
      script: (h) => h.down({ x: 900, y: 20 }).move(60).up(),
      expected: [],
    },
    {
      name: 'secondary buttons are ignored',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a'), { button: 2 }).move(80).up(),
      expected: [],
    },
    {
      name: 'another pointer is ignored during a press and a drag',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a'))
          .pointer('move', { pointerId: 2, x: 900 })
          .pointer('up', { pointerId: 2 })
          .move(40)
          .pointer('down', { pointerId: 2, x: h.on('b').x, y: h.on('b').y })
          .pointer('move', { pointerId: 2, x: 0 })
          .pointer('up', { pointerId: 2 })
          .cancel(2)
          .up(),
      expected: ['preview a 2026-03-03..2026-03-07', 'commit a 2026-03-03..2026-03-07'],
    },
  ]);
});

describe('createInteraction: a lost release (FR-EDIT-1)', () => {
  const touch = (pointerId: number, isPrimary = true): Partial<PointerInput> => ({
    pointerId,
    pointerType: 'touch',
    isPrimary,
  });
  const restarted = [
    'preview a 2026-03-04..2026-03-08',
    'cancel-preview',
    'preview b 2026-03-10..2026-03-14',
    'commit b 2026-03-10..2026-03-14',
  ];
  run([
    {
      name: 'FR-EDIT-1: a mouse press during a drag whose release was lost rolls it back and starts over',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a')).move(80).down(h.on('b')).move(40).up(),
      expected: restarted,
    },
    {
      name: 'FR-EDIT-1: a new primary touch after a lost release starts over',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a'), touch(1))
          .move(80, 0, touch(1))
          .down(h.on('b'), touch(2))
          .move(40, 0, touch(2))
          .up(touch(2)),
      expected: restarted,
    },
    {
      name: 'FR-EDIT-1: a second finger during a touch drag is ignored',
      setup: { tasks: [A, B] },
      script: (h) => {
        h.down(h.on('a'), touch(1)).move(80, 0, touch(1));
        const b = h.on('b');
        h.pointer('down', { ...touch(2, false), x: b.x, y: b.y })
          .pointer('move', { ...touch(2, false), x: b.x + 40, y: b.y })
          .pointer('up', touch(2, false))
          .up(touch(1));
      },
      expected: ['preview a 2026-03-04..2026-03-08', 'commit a 2026-03-04..2026-03-08'],
    },
    {
      name: 'FR-EDIT-1: a primary press of another pointer type does not end a touch drag',
      setup: { tasks: [A, B] },
      script: (h) => {
        h.down(h.on('a'), touch(1)).move(80, 0, touch(1));
        const b = h.on('b');
        h.pointer('down', { pointerId: 9, pointerType: 'mouse', isPrimary: true, ...b })
          .pointer('up', { pointerId: 9, pointerType: 'mouse', isPrimary: true })
          .up(touch(1));
      },
      expected: ['preview a 2026-03-04..2026-03-08', 'commit a 2026-03-04..2026-03-08'],
    },
    {
      name: 'FR-EDIT-1: a secondary button during a drag changes nothing',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a')).move(80).pointer('down', { button: 2 }).up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'commit a 2026-03-04..2026-03-08'],
    },
    {
      name: 'FR-EDIT-1, FR-EDIT-3: a press whose release was lost is no click',
      setup: { tasks: [A, B] },
      script: (h) => h.click(h.on('b')).down(h.on('a')).down(h.on('b')).up(),
      expected: ['click task:b:body', 'click task:b:body'],
    },
    {
      name: 'FR-EDIT-1, FR-EDIT-4: a press after a cancelled press whose release was lost starts over',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a')).key('Escape').down(h.on('b')).move(40).up(),
      expected: ['preview b 2026-03-10..2026-03-14', 'commit b 2026-03-10..2026-03-14'],
    },
    {
      name: 'FR-EDIT-1, FR-LINK-4: a press after a link drag whose release was lost ends the link',
      setup: { tasks: [A, B] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).down(h.on('b')).move(40).up(),
      expected: [
        'link-preview a→b',
        'link-preview off',
        'preview b 2026-03-10..2026-03-14',
        'commit b 2026-03-10..2026-03-14',
      ],
    },
    {
      name: 'FR-EDIT-1, FR-LINK-4: a press after a lost target release of click-click ends the link',
      setup: { tasks: [A, B] },
      script: (h) => h.click(h.on('a', 'link-end')).down(h.on('b')).down(h.on('b')).up(),
      expected: ['link-preview a→·', 'link-preview a→b', 'link-preview off', 'click task:b:body'],
    },
    {
      name: 'FR-EDIT-1, FR-EDIT-6: a restart stops the autoscroll',
      setup: { tasks: [A, B], viewportWidth: 400 },
      script: (h) => h.down(h.on('a')).move(250).down(h.on('b')).up(),
      expected: [
        'preview a 2026-03-09..2026-03-13',
        'autoscroll 15',
        'cancel-preview',
        'autoscroll 0',
        'click task:b:body',
      ],
    },
  ]);
});

describe('createInteraction: Escape and pointer cancel (FR-EDIT-4)', () => {
  run([
    {
      name: 'FR-EDIT-4: Escape rolls the preview back and swallows the release',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(80).key('Escape').move(40).up().click(h.on('a')),
      expected: ['preview a 2026-03-04..2026-03-08', 'cancel-preview', 'click task:a:body'],
    },
    {
      name: 'FR-EDIT-4: Escape on a press prevents the click',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).key('Escape').up(),
      expected: [],
    },
    {
      name: 'FR-EDIT-4: a pointer cancel rolls the preview back',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(80).cancel(1).up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'cancel-preview'],
    },
    {
      name: 'FR-EDIT-4: a cancel without a pointer id cancels too',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(80).cancel().up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'cancel-preview'],
    },
    {
      name: 'FR-EDIT-4: a cancel of another pointer changes nothing',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(80).cancel(7).up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'commit a 2026-03-04..2026-03-08'],
    },
    {
      name: 'FR-EDIT-4: a cancelled press ends quietly',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).cancel(1).up().down(h.on('a')).key('Escape').cancel(),
      expected: [],
    },
    {
      name: 'other keys do not cancel',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).key('Shift').move(80).key('Shift').up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'commit a 2026-03-04..2026-03-08'],
    },
  ]);
});

describe('createInteraction: permissions (FR-EDIT-7)', () => {
  run([
    {
      name: 'FR-EDIT-7: editing: false refuses the drag at its start',
      setup: { tasks: [A], editing: false },
      script: (h) => h.down(h.on('a')).move(80).up(),
      expected: ['refused move a permission at start'],
    },
    {
      name: 'FR-EDIT-7: a locked task does not move',
      setup: { tasks: [{ ...A, locked: true }] },
      script: (h) => h.down(h.on('a')).move(80).up(),
      expected: ['refused move a permission at start'],
    },
    {
      name: 'FR-EDIT-7: a locked task still links',
      setup: { tasks: [{ ...A, locked: true }, B] },
      script: (h) => h.down(h.on('a', 'link-end')).moveTo(h.on('b')).up(),
      expected: ['link-preview a→b', 'link-preview off', 'create-link a-FS->b'],
    },
    {
      name: 'FR-EDIT-7: editable overrides a read-only chart',
      setup: { tasks: [{ ...A, editable: { move: true } }], editing: false },
      script: (h) => h.drag(h.on('a'), 80),
      expected: [
        'preview a 2026-03-03..2026-03-07',
        'preview a 2026-03-04..2026-03-08',
        'commit a 2026-03-04..2026-03-08',
      ],
    },
    {
      name: 'FR-EDIT-7: fixedDuration turns the resize zone into the body: it moves',
      setup: { tasks: [{ ...A, fixedDuration: true }] },
      script: (h) => h.down(h.on('a', 'resize-end')).move(40).up(),
      expected: ['preview a 2026-03-03..2026-03-07', 'commit a 2026-03-03..2026-03-07'],
    },
    {
      name: 'FR-EDIT-7: editing.resize: false turns the resize zone into the body',
      setup: { tasks: [A], editing: { resize: false } },
      script: (h) => h.down(h.on('a', 'resize-start')).move(40).up(),
      expected: ['preview a 2026-03-03..2026-03-07', 'commit a 2026-03-03..2026-03-07'],
    },
    {
      name: 'FR-EDIT-7: an explicit resize target of a fixedDuration task is refused',
      setup: { tasks: [{ ...A, fixedDuration: true }] },
      script: (h) =>
        h
          .down(h.on('a', 'resize-end'), { target: { kind: 'task', id: 'a', part: 'resize-end' } })
          .move(40)
          .up(),
      expected: ['refused resize-end a permission at start'],
    },
    {
      name: 'FR-EDIT-7: editing.progress: false hides the progress handle',
      setup: { tasks: [{ ...P, progress: 50 }], editing: { progress: false } },
      script: (h) =>
        h
          .down({ ...h.on('p', 'progress'), y: 36 })
          .move(40)
          .up(),
      expected: ['preview p 2026-03-03..2026-03-16', 'commit p 2026-03-03..2026-03-16'],
    },
    {
      name: 'FR-EDIT-7: no drag starts while the controller is busy',
      setup: { tasks: [A], busy: true },
      script: (h) => h.down(h.on('a')).move(80).up().click(h.on('a')),
      expected: ['refused move a busy at start', 'click task:a:body'],
    },
    {
      name: 'FR-EDIT-7: permissions are checked again on release',
      setup: { tasks: [A] },
      script: (h) =>
        h
          .down(h.on('a'))
          .move(80)
          .update({ editing: { move: false } })
          .up(),
      expected: [
        'preview a 2026-03-04..2026-03-08',
        'cancel-preview',
        'refused move a permission at commit',
      ],
    },
    {
      name: 'FR-EDIT-7: a task locked mid-drag is refused on release',
      setup: { tasks: [A] },
      script: (h) =>
        h
          .down(h.on('a'))
          .move(80)
          .update({ tasks: [{ ...A, locked: true }] })
          .up(),
      expected: [
        'preview a 2026-03-04..2026-03-08',
        'cancel-preview',
        'refused move a permission at commit',
      ],
    },
    {
      name: 'FR-EDIT-7: a busy controller on release refuses the commit',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(80).update({ busy: true }).up(),
      expected: [
        'preview a 2026-03-04..2026-03-08',
        'cancel-preview',
        'refused move a busy at commit',
      ],
    },
    {
      name: 'a task removed mid-drag ends the drag',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a'))
          .move(80)
          .update({ tasks: [B] })
          .move(40)
          .up()
          .click(h.on('b')),
      expected: [
        'preview a 2026-03-04..2026-03-08',
        'cancel-preview',
        'refused move a unknown-task at commit',
        'click task:b:body',
      ],
    },
    {
      name: 'a task removed mid-drag is not refused when the drag is cancelled before the release',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a'))
          .move(80)
          .update({ tasks: [B] })
          .move(40)
          .key('Escape')
          .up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'cancel-preview'],
    },
    {
      name: 'a task removed before the drag starts is refused',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a'))
          .update({ tasks: [B] })
          .move(80)
          .up(),
      expected: ['refused move a unknown-task at start'],
    },
    {
      name: 'a task removed exactly at the release is refused',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a'))
          .move(80)
          .update({ tasks: [B] })
          .up(),
      expected: [
        'preview a 2026-03-04..2026-03-08',
        'cancel-preview',
        'refused move a unknown-task at commit',
      ],
    },
  ]);
});

describe('createInteraction: a task gone mid-drag', () => {
  it('is refused at the release, the commit it never had', () => {
    const h = new Harness({ tasks: [A, B] });
    h.down(h.on('a'))
      .move(80)
      .update({ tasks: [B] })
      .move(40);
    expect(h.log).toEqual(['preview a 2026-03-04..2026-03-08', 'cancel-preview']);
    expect(h.interaction.feedback.phase).toBe('idle');
    h.move(40).up();
    expect(h.log.slice(2)).toEqual(['refused move a unknown-task at commit']);
  });
});

describe('createInteraction: snapping', () => {
  const T: Task = { id: 't', name: 'T', start: '2026-03-02T10:00', end: '2026-03-02T12:00' };
  const hour: Setup = {
    tasks: [T],
    viewMode: 'hour',
    granularity: '15min',
    range: ['2026-03-02', '2026-03-04'],
  };
  const dayTask: Pick<Setup, 'tasks'> = {
    tasks: [{ id: 'd', name: 'D', start: '2026-03-02', end: '2026-03-02' }],
  };
  run([
    {
      name: 'FR-SNAP-2: the day mode snaps to the nearest day (1.4 days → 1)',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(56).up(),
      expected: ['preview a 2026-03-03..2026-03-07', 'commit a 2026-03-03..2026-03-07'],
    },
    {
      name: 'FR-SNAP-2: the day mode snaps to the nearest day (1.6 days → 2)',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(64).up(),
      expected: ['preview a 2026-03-04..2026-03-08', 'commit a 2026-03-04..2026-03-08'],
    },
    {
      name: 'FR-SNAP-5: the hour mode snaps to 15 minutes',
      setup: hour,
      script: (h) => h.down(h.on('t')).move(47).up(),
      expected: [
        'preview t 2026-03-02T11:15..2026-03-02T13:15',
        'commit t 2026-03-02T11:15..2026-03-02T13:15',
      ],
    },
    {
      name: 'FR-SNAP-4: a move snap of 1 h',
      setup: { ...hour, snap: { move: '1h' } },
      script: (h) => h.down(h.on('t')).move(47).up(),
      expected: [
        'preview t 2026-03-02T11:00..2026-03-02T13:00',
        'commit t 2026-03-02T11:00..2026-03-02T13:00',
      ],
    },
    {
      name: 'FR-SNAP-10: Alt falls back to the granularity',
      setup: { ...hour, snap: '1h' },
      script: (h) =>
        h
          .down(h.on('t'))
          .move(47, 0, { modifiers: { alt: true } })
          .up({ modifiers: { alt: true } }),
      expected: [
        'preview t 2026-03-02T11:15..2026-03-02T13:15',
        'commit t 2026-03-02T11:15..2026-03-02T13:15',
      ],
    },
    {
      name: 'FR-SNAP-10: pressing and releasing Alt mid-drag re-snaps',
      setup: { ...hour, snap: '1h' },
      script: (h) =>
        h
          .down(h.on('t'))
          .move(47)
          .key('Alt', { alt: true })
          .key('Alt', { alt: false })
          .key('Alt', { alt: true })
          .up({ modifiers: { alt: true } }),
      expected: [
        'preview t 2026-03-02T11:00..2026-03-02T13:00',
        'preview t 2026-03-02T11:15..2026-03-02T13:15',
        'preview t 2026-03-02T11:00..2026-03-02T13:00',
        'preview t 2026-03-02T11:15..2026-03-02T13:15',
        'commit t 2026-03-02T11:15..2026-03-02T13:15',
      ],
    },
    {
      name: 'FR-SNAP-6: a resize in the hour mode keeps 15 minutes',
      setup: hour,
      script: (h) => h.down(h.on('t', 'resize-end')).move(-200).up(),
      expected: [
        'preview t 2026-03-02T10:00..2026-03-02T10:15',
        'commit t 2026-03-02T10:00..2026-03-02T10:15',
      ],
    },
    {
      name: 'FR-SNAP-7: a day-precision task in the hour mode snaps to whole days',
      setup: { ...hour, tasks: [{ id: 'd', name: 'D', start: '2026-03-02', end: '2026-03-02' }] },
      script: (h) => h.down(h.on('d')).move(300).move(300).up(),
      expected: ['preview d 2026-03-03..2026-03-03', 'commit d 2026-03-03..2026-03-03'],
    },
    {
      name: 'FR-SNAP-7: without keepDayPrecision a day task dragged by hours becomes a timed task',
      setup: { ...hour, ...dayTask, granularity: '1h', snap: '1h', keepDayPrecision: false },
      script: (h) => h.down(h.on('d')).move(400).up(),
      expected: [
        'preview d 2026-03-02T10:00..2026-03-03T10:00',
        'commit d 2026-03-02T10:00..2026-03-03T10:00',
      ],
    },
    {
      name: 'FR-SNAP-7: without keepDayPrecision 14 hours stay 14 hours, not the next midnight',
      setup: { ...hour, ...dayTask, granularity: '1h', snap: '1h', keepDayPrecision: false },
      script: (h) => h.down(h.on('d')).move(560).up(),
      expected: [
        'preview d 2026-03-02T14:00..2026-03-03T14:00',
        'commit d 2026-03-02T14:00..2026-03-03T14:00',
      ],
    },
    {
      name: 'FR-SNAP-7: without keepDayPrecision a resized day task becomes timed at its edge',
      setup: { ...hour, ...dayTask, granularity: '1h', snap: '1h', keepDayPrecision: false },
      script: (h) => h.down(h.on('d', 'resize-end')).move(-400).up(),
      expected: [
        'preview d 2026-03-02T00:00..2026-03-02T14:00',
        'commit d 2026-03-02T00:00..2026-03-02T14:00',
      ],
    },
    {
      name: 'FR-SNAP-7: without keepDayPrecision a drag by whole days keeps the day precision',
      setup: { ...hour, ...dayTask, granularity: '1h', snap: '1h', keepDayPrecision: false },
      script: (h) => h.down(h.on('d')).move(960).up(),
      expected: ['preview d 2026-03-03..2026-03-03', 'commit d 2026-03-03..2026-03-03'],
    },
    {
      name: 'FR-SNAP-3: relative snapping keeps the time of day',
      setup: {
        tasks: [{ id: 'r', name: 'R', start: '2026-03-02T10:00', end: '2026-03-03T10:00' }],
        granularity: '1h',
        snap: { step: '1d', mode: 'relative' },
      },
      script: (h) => h.down(h.on('r')).move(48).up(),
      expected: [
        'preview r 2026-03-03T10:00..2026-03-04T10:00',
        'commit r 2026-03-03T10:00..2026-03-04T10:00',
      ],
    },
    {
      name: 'FR-SNAP-8: a move onto a Saturday skips to Monday',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).move(200).up(),
      expected: ['preview a 2026-03-09..2026-03-13', 'commit a 2026-03-09..2026-03-13'],
    },
    {
      name: 'FR-SNAP-8: a move back onto a Sunday skips to Friday',
      setup: { tasks: [B] },
      script: (h) => h.down(h.on('b')).move(-40).up(),
      expected: ['preview b 2026-03-06..2026-03-10', 'commit b 2026-03-06..2026-03-10'],
    },
    {
      name: 'FR-SNAP-8: without skipping a move stays on the weekend',
      setup: { tasks: [A], propagation: { skipNonWorkingDays: { move: false } } },
      script: (h) => h.down(h.on('a')).move(200).up(),
      expected: ['preview a 2026-03-07..2026-03-11', 'commit a 2026-03-07..2026-03-11'],
    },
  ]);
});

describe('createInteraction: anchoring, autoscroll and extension (FR-EDIT-6, FR-TL-5)', () => {
  const narrow: Setup = { tasks: [A], viewportWidth: 400 };
  run([
    {
      name: 'FR-EDIT-6: the edge zone starts and stops the autoscroll',
      setup: narrow,
      script: (h) => h.down(h.on('a')).move(250).move(-180).up(),
      // +6.25 days lands on Sunday: the move skips to Monday.
      expected: [
        'preview a 2026-03-09..2026-03-13',
        'autoscroll 15',
        'preview a 2026-03-04..2026-03-08',
        'autoscroll 0',
        'commit a 2026-03-04..2026-03-08',
      ],
    },
    {
      name: 'FR-EDIT-6: the left edge scrolls back',
      setup: { ...narrow, scrollLeft: 200 },
      script: (h) => h.down(h.on('a', 'resize-end')).moveTo({ x: 205, y: 24 }).up(),
      expected: [
        'preview a 2026-03-02..2026-03-05',
        'autoscroll -17.5',
        'commit a 2026-03-02..2026-03-05',
        'autoscroll 0',
      ],
    },
    {
      name: 'FR-EDIT-6: autoscroll carries the bar under the still pointer',
      setup: narrow,
      script: (h) => {
        h.down(h.on('a')).move(250);
        for (let frame = 0; frame < 8; frame++) h.scroll(15);
        h.up();
      },
      // 15 px per frame: +6.25 days (Sunday → Monday), … +8.5 (→ 9 in the drag direction), +9.25.
      expected: [
        'preview a 2026-03-09..2026-03-13',
        'autoscroll 15',
        'preview a 2026-03-10..2026-03-14',
        'preview a 2026-03-11..2026-03-15',
        'commit a 2026-03-11..2026-03-15',
        'autoscroll 0',
      ],
    },
    {
      name: 'FR-EDIT-6: scroll.autoScroll: false never autoscrolls',
      setup: { ...narrow, autoScroll: false },
      script: (h) => h.down(h.on('a')).move(250).up(),
      expected: ['preview a 2026-03-09..2026-03-13', 'commit a 2026-03-09..2026-03-13'],
    },
    {
      name: 'FR-TL-3: an extension of the start mid-drag keeps the bar under the pointer',
      setup: narrow,
      script: (h) => {
        h.down(h.on('a')).move(80);
        const change = planExtension(h.ctx.timeline)!;
        expect(change.reason).toBe('extend-start');
        expect(change.shift).toBeGreaterThan(0);
        h.retime(change).move(0).move(40).up();
      },
      expected: [
        'preview a 2026-03-04..2026-03-08',
        'preview a 2026-03-05..2026-03-09',
        'commit a 2026-03-05..2026-03-09',
      ],
    },
    {
      name: 'FR-SCALE-6: a zoom mid-drag keeps the drag anchored in time',
      setup: narrow,
      script: (h) => {
        h.down(h.on('a')).move(80);
        h.retime(rebaseTimeline(h.ctx.timeline, { pxPerDay: 80, anchorX: h.vx }));
        // 80 px are one day now.
        h.move(80).up();
      },
      expected: [
        'preview a 2026-03-04..2026-03-08',
        'preview a 2026-03-05..2026-03-09',
        'commit a 2026-03-05..2026-03-09',
      ],
    },
    {
      name: 'FR-TL-5: a bar dragged past the range end asks for it once per position',
      setup: { tasks: [A], range: ['2026-03-01', '2026-03-15'] },
      script: (h) => h.down(h.on('a')).move(400).move(1).move(40).up(),
      expected: [
        'preview a 2026-03-12..2026-03-16',
        'extend-range 2026-03-12..2026-03-16',
        'preview a 2026-03-13..2026-03-17',
        'extend-range 2026-03-13..2026-03-17',
        'commit a 2026-03-13..2026-03-17',
      ],
    },
    {
      name: 'FR-TL-5: a resize of the end past the range asks for the end only',
      setup: { tasks: [P], range: ['2026-03-01', '2026-03-17'] },
      script: (h) => h.down(h.on('p', 'resize-end')).move(80).up(),
      expected: [
        'preview p 2026-03-02..2026-03-17',
        'extend-range at 2026-03-18',
        'commit p 2026-03-02..2026-03-17',
      ],
    },
    {
      name: 'FR-TL-5: a bar wider than the viewport moved past the range end asks for its leading edge',
      setup: {
        tasks: [P],
        range: ['2026-03-01', '2026-03-17'],
        viewportWidth: 400,
        autoScroll: false,
      },
      script: (h) => h.down(h.on('p')).move(80).up(),
      expected: [
        'preview p 2026-03-04..2026-03-17',
        'extend-range at 2026-03-18',
        'commit p 2026-03-04..2026-03-17',
      ],
    },
    {
      name: 'FR-TL-5: a bar wider than the viewport moved past the range start asks for its leading edge',
      setup: { tasks: [P], viewportWidth: 400, autoScroll: false },
      // Back onto Saturday: the move skips back to Friday.
      script: (h) => h.down(h.on('p')).move(-80).up(),
      expected: [
        'preview p 2026-02-27..2026-03-12',
        'extend-range at 2026-02-27',
        'commit p 2026-02-27..2026-03-12',
      ],
    },
    {
      name: 'FR-TL-5: a milestone dragged onto the range end asks for an extension',
      setup: {
        tasks: [{ id: 'm', name: 'M', type: 'milestone', start: '2026-03-09' }],
        range: ['2026-03-01', '2026-03-11'],
      },
      script: (h) => h.down(h.on('m')).move(80).up(),
      expected: ['preview m 2026-03-11', 'extend-range at 2026-03-11', 'commit m 2026-03-11'],
    },
    {
      name: 'timeline events outside a drag change nothing',
      setup: narrow,
      script: (h) => h.scroll(10).down(h.on('a')).scroll(10).up(),
      expected: ['click task:a:body'],
    },
  ]);

  it('FR-TL-5: a long bar dragged past the range end asks for its edge only, which the range can hold', () => {
    // 30 days (1200 px) in a 400 px viewport. The range may span 60 days, less than the bar with
    // the padding of `ensureContains` (20 days) on both sides, but more than one edge with it.
    const long: Task = { id: 'l', name: 'L', start: '2026-03-02', end: '2026-03-31' };
    const h = new Harness({
      tasks: [long],
      range: ['2026-03-01', '2026-04-02'],
      viewportWidth: 400,
      autoScroll: false,
      propagation: { skipNonWorkingDays: { move: false } },
    });
    const maxSpan = { months: 0, ms: 60 * DAY };
    let trims = 0;
    h.down(h.on('l'));
    for (let day = 0; day < 20; day++) {
      const before = h.effects.length;
      h.move(40);
      const asked = h.effects.slice(before).find((effect) => effect.type === 'extend-range');
      if (asked?.type !== 'extend-range') continue;
      // What the facade does: grow the range, then the infinite timeline keeps it in its limits.
      const grown = ensureContains(h.ctx.timeline, asked.target, { maxSpan });
      if (grown !== undefined) h.retime(grown);
      const kept = planExtension(h.ctx.timeline, { maxSpan });
      if (kept === undefined) continue;
      if (kept.reason.startsWith('trim')) trims++;
      h.retime(kept);
    }
    h.up();
    // Each request brings the edge in with its padding: it stays in, nothing is trimmed away.
    const asks = h.of('extend-range');
    expect(asks.length).toBeLessThanOrEqual(2);
    expect(asks.every((effect) => effect.target.start === effect.target.end)).toBe(true);
    expect(trims).toBe(0);
    expect(h.log.at(-1)).toBe('commit l 2026-03-22..2026-04-20');
  });

  it('FR-TL-3: content x after an extension maps to the same pointer time', () => {
    const h = new Harness(narrow);
    h.down(h.on('a')).move(80);
    const before = h.ctx.timeline.scale.xToDate(h.vx + h.ctx.timeline.scrollLeft);
    h.retime(planExtension(h.ctx.timeline)!);
    expect(h.ctx.timeline.scale.xToDate(h.vx + h.ctx.timeline.scrollLeft)).toBe(before);
    expect(h.of('preview')).toHaveLength(1);
  });
});

describe('createInteraction: feedback (FR-EDIT-8)', () => {
  it('FR-EDIT-8: the hover cursor tells what a press would do', () => {
    const h = new Harness({ tasks: [A, { ...B, locked: true }] });
    const cursors = [
      h.on('a'),
      h.on('a', 'resize-end'),
      h.on('a', 'link-end'),
      h.on('a', 'progress'),
      { x: 900, y: 20 },
      h.on('b'),
    ].map((point) => {
      h.moveTo(point);
      return h.interaction.feedback.cursor;
    });
    expect(cursors).toEqual(['grab', 'ew-resize', 'crosshair', 'ew-resize', 'default', 'default']);
    h.moveTo({ x: 1, y: 1 }, { target: { kind: 'link', id: 'a:FS:b' } });
    expect(h.interaction.feedback).toMatchObject({ cursor: 'pointer', hover: { kind: 'link' } });
  });

  it('FR-EDIT-8: the feedback follows the gesture with the previewed values', () => {
    const h = new Harness({ tasks: [A] });
    h.moveTo(h.on('a'));
    const hover = h.interaction.feedback;
    h.moveTo({ ...h.on('a'), x: h.on('a').x + 1 });
    expect(h.interaction.feedback).toBe(hover);
    h.down(h.on('a'));
    expect(h.interaction.feedback).toMatchObject({
      phase: 'pressed',
      cursor: 'grabbing',
      gesture: 'move',
      id: 'a',
    });
    h.move(80);
    const dragging = h.interaction.feedback;
    expect(dragging).toMatchObject({
      phase: 'dragging',
      gesture: 'move',
      id: 'a',
      cursor: 'grabbing',
    });
    expect(toISODate(dragging.patch!.start)).toBe('2026-03-04');
    expect(Object.isFrozen(dragging)).toBe(true);
    const emitted = h.of('feedback').map((effect) => effect.feedback);
    expect(emitted.at(-1)).toBe(dragging);
    h.move(1);
    expect(h.interaction.feedback).toBe(dragging);
    h.up();
    expect(h.interaction.feedback).toMatchObject({ phase: 'idle', patch: undefined });
  });

  it('FR-EDIT-8: an unchanged drag shows the task values; a resize shows ew-resize', () => {
    const h = new Harness({ tasks: [A] });
    h.down(h.on('a', 'resize-end')).move(5);
    const { patch, cursor } = h.interaction.feedback;
    expect(cursor).toBe('ew-resize');
    expect(toISODate(patch!.start)).toBe('2026-03-02');
    h.key('Escape');
    expect(h.interaction.feedback).toMatchObject({ phase: 'idle', cursor: 'default' });
  });

  it('FR-EDIT-8: a busy controller shows the default cursor', () => {
    const h = new Harness({ tasks: [A], busy: true });
    h.moveTo(h.on('a'));
    expect(h.interaction.feedback.cursor).toBe('default');
  });
});

describe('createInteraction: input', () => {
  it('ignores unknown event types and never mutates the context', () => {
    const h = new Harness({ tasks: [A] });
    const before = h.ctx;
    expect(h.send({ type: 'wheel' } as unknown as InteractionEvent)).toEqual([]);
    h.drag(h.on('a'), 80);
    expect(h.ctx).toBe(before);
    expect(h.ctx.model.taskById.get('a')!.span!.start).toBe(at('2026-03-02'));
  });

  it('FR-EDIT-5: previews run without conflicts; a sub-step move emits nothing', () => {
    const h = new Harness({ tasks: [A, B], links: [{ source: 'a', target: 'b', lag: 0 }] });
    h.down(h.on('a')).move(80);
    const [preview] = h.of('preview');
    expect(preview!.changeSet.conflicts).toEqual([]);
    expect(h.move(3).of('preview')).toHaveLength(1);
  });

  run([
    {
      name: 'keys and cancels while idle do nothing',
      setup: { tasks: [A] },
      script: (h) => h.key('Escape').cancel().cancel(1).click(h.on('a')),
      expected: ['click task:a:body'],
    },
    {
      name: 'a cancel of another pointer keeps the press',
      setup: { tasks: [A] },
      script: (h) => h.down(h.on('a')).cancel(2).up(),
      expected: ['click task:a:body'],
    },
    {
      name: 'a cancelled press waits for its own pointer only',
      setup: { tasks: [A] },
      script: (h) =>
        h
          .down(h.on('a'))
          .key('Escape')
          .pointer('up', { pointerId: 2 })
          .cancel(2)
          .move(80)
          .up()
          .click(h.on('a')),
      expected: ['click task:a:body'],
    },
    {
      name: 'FR-LINK-4: other pointers do not disturb a link drag',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a', 'link-end'))
          .moveTo(h.on('b'))
          .pointer('down', { pointerId: 2 })
          .pointer('move', { pointerId: 2, x: 0, y: 0 })
          .pointer('up', { pointerId: 2 })
          .key('Shift')
          .up(),
      expected: ['link-preview a→b', 'link-preview off', 'create-link a-FS->b'],
    },
    {
      name: 'FR-LINK-4: click-click takes one target press at a time',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .click(h.on('a', 'link-end'))
          .down(h.on('b'))
          .pointer('down', { pointerId: 2 })
          .pointer('move', { pointerId: 2, x: 0, y: 0 })
          .pointer('up', { pointerId: 2 })
          .up(),
      expected: ['link-preview a→·', 'link-preview a→b', 'link-preview off', 'create-link a-FS->b'],
    },
    {
      name: 'FR-LINK-4: a source gone while armed ends click-click',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .click(h.on('a', 'link-end'))
          .update({ tasks: [B] })
          .moveTo(h.on('b'))
          .click(h.on('b')),
      expected: ['link-preview a→·', 'link-preview off', 'click task:b:body'],
    },
    {
      name: 'FR-LINK-4: a source gone exactly at the release ends quietly',
      setup: { tasks: [A, B] },
      script: (h) =>
        h
          .down(h.on('a', 'link-end'))
          .moveTo(h.on('b'))
          .update({ tasks: [B] })
          .up()
          .click(h.on('b')),
      expected: ['link-preview a→b', 'link-preview off', 'click task:b:body'],
    },
  ]);

  it('FR-SEL-1: double clicks compare link targets by id', () => {
    const h = new Harness({ tasks: [A, B], links: [{ source: 'a', target: 'b' }] });
    const link = (id: string): Partial<PointerInput> => ({ target: { kind: 'link', id } });
    h.click({ x: 280, y: 48 }, link('a:FS:b')).click({ x: 280, y: 48 }, link('other'));
    h.click({ x: 280, y: 48 }, link('other'));
    expect(h.log).toEqual([
      'click link:a:FS:b',
      'click link:other',
      'click link:other',
      'double-click link:other',
    ]);
  });
});
