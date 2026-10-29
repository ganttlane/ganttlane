/**
 * Editing page of plan step 4.7 (FR-EDIT-1 … FR-EDIT-8, FR-LINK-4): a chart to drag bars on, by
 * hand or from the e2e specs (`e2e/edit-*.spec.ts`), with a log of what the chart reports.
 *
 * It shows a fixture (`?fixture=<id>`, the sample project by default) and exposes
 * `window.__ganttEdit`, the test hook:
 *
 * - `mount(config)` replaces the chart with one made from `config`: any serialisable core
 *   option (`tasks`, `links`, `calendar`, `viewMode`, `scheduling`, `timeline`, `scroll`, …) plus
 *   `fixture` (start from a catalog fixture), `today` (a fixed "today", an ISO date), `width`
 *   (px) and `answer`, how a "lands on a non-working day" prompt is answered (the FR-SCH-7
 *   scenarios): `'accept'` moves the edge to the next working day, `'ignore'` keeps it. The page
 *   around the chart can be shaped too: `height: 'auto'` (the chart is as tall as its rows and
 *   the page scrolls it), `above` / `below` (px of filler, so that the page itself scrolls) and
 *   `scale` (a CSS `scale()` on the chart, from its top left corner);
 * - `changes` are the change sets `onTasksChange` reported, as the core made them (floating
 *   milliseconds), `events` the other things the chart reported (`click:<id>`, `dblclick:<id>`,
 *   `linkClick:<id>`, `linkCreate:<source>><target>`, `refused:<gesture>:<reason>`), in order;
 * - `core` is the chart's core, for reading the snapshot, and `chart` the chart itself
 *   (`createGantt`'s `Gantt`), for calling its methods; `update(patch)` is `gantt.setOptions`
 *   (a locale brings the strings of its language along) and `owned(id)` a task as the chart
 *   holds it. The hook is the contract of `harness.ts`, which `/react-edit/` implements too, so
 *   that the shared scenarios (`e2e/journeys/`) run on both.
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import { propagate } from '@ganttlane/core';
import type { Gantt, GanttStringsInput, Task } from '@ganttlane/dom';
import { createGantt, DEFAULT_STRINGS } from '@ganttlane/dom';
import { findFixture } from '@ganttlane/fixtures';

import type { EditHarness, HarnessConfig, OwnedTask, RuntimeOptions } from './harness';
import { createRecorder } from './recorder';
import { UKRAINIAN } from './strings-uk';

/** What `mount` takes: serialisable options of the chart and the page's own switches. */
export type EditConfig = HarnessConfig & {
  /** A catalog fixture to start from (its tasks, links, calendar and options); the rest wins. */
  readonly fixture?: string;
  /** The answer to "lands on a non-working day" (FR-SCH-7), see the file comment. */
  readonly answer?: 'accept' | 'ignore';
  /** `'auto'`: the chart is as tall as its rows and the page scrolls it (FR-SCROLL-3). */
  readonly height?: 'auto';
  /** Px of filler above and below the chart, so that the page scrolls. */
  readonly above?: number;
  readonly below?: number;
  /** A CSS `scale()` of the chart, from its top left corner (default: none). */
  readonly scale?: number;
};

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app not found');

const chart = Object.assign(document.createElement('div'), { id: 'gantt', className: 'chart' });
/** Filler around the chart: the page scrolls past it (`above`, `below`). */
const filler = (): HTMLElement =>
  Object.assign(document.createElement('div'), { className: 'scroll-filler' });
const above = filler();
const below = filler();
const log = document.createElement('ol');
log.dataset.testid = 'edit-log';
log.className = 'chart-status';
app.append(
  Object.assign(document.createElement('h1'), { textContent: 'Editing · drag the bars' }),
  Object.assign(document.createElement('p'), {
    textContent:
      'Drag a bar to move it, its edges to resize it, the lower end of the done part for the progress, ' +
      'a circle beside a bar onto another bar for a link (or click both). Escape cancels a drag.',
  }),
  above,
  chart,
  below,
  log,
);

/** What the chart reported: the lists the e2e specs read, and the visible log (text only). */
const recorder = createRecorder((text) => {
  log.append(Object.assign(document.createElement('li'), { textContent: text }));
});
let instance: Gantt | undefined;

function mount(config: EditConfig = {}): void {
  instance?.destroy();
  instance = undefined;
  recorder.reset();
  log.replaceChildren();
  const {
    fixture,
    today,
    width,
    answer,
    height,
    above: top,
    below: bottom,
    scale,
    ...options
  } = config;
  chart.style.width = width === undefined ? '' : `${String(width)}px`;
  chart.style.height = height === 'auto' ? 'auto' : '';
  chart.style.transform = scale === undefined ? '' : `scale(${String(scale)})`;
  chart.style.transformOrigin = '0 0';
  above.style.height = `${String(top ?? 0)}px`;
  below.style.height = `${String(bottom ?? 0)}px`;
  window.scrollTo(0, 0);
  const entry = fixture === undefined ? undefined : findFixture(fixture);
  const base = entry?.load();

  instance = createGantt(chart, {
    tasks: base?.tasks ?? [],
    links: base?.links,
    ...(base?.calendar && { calendar: base.calendar }),
    ...base?.options,
    ...options,
    ...(height === 'auto' && { layout: { height } }),
    ...(today !== undefined && { now: () => today }),
    ...recorder.handlers,
    ...(answer === 'accept' && {
      // "The bar lands on a non-working day: move it to the next working day" (FR-SCH-7).
      onBeforeTaskChange: ({ changeSet, conflicts }) => {
        const first = changeSet.changes[0];
        if (first === undefined || conflicts.length === 0) return true;
        const derived = instance?.core.getSnapshot().state.derived;
        if (derived === undefined) return true;
        const command =
          changeSet.reason === 'resize-end'
            ? ({
                kind: 'resize-end',
                id: first.id,
                endExclusive: first.after.endExclusive,
              } as const)
            : changeSet.reason === 'move' || changeSet.reason === 'resize-start'
              ? ({ kind: changeSet.reason, id: first.id, start: first.after.start } as const)
              : undefined;
        if (command === undefined) return true;
        return propagate(command, {
          ...derived,
          options: { skipNonWorkingDays: { resize: true } },
        });
      },
    }),
  });
}

/**
 * The strings that go with a locale: the Ukrainian pack for `uk`, the defaults for anything else.
 * `strings` is merged key by key, so every key is put back first.
 */
const NO_STRINGS: GanttStringsInput = Object.fromEntries(
  Object.keys(DEFAULT_STRINGS).map((key) => [key, undefined]),
);
const stringsOf = (locale: string): GanttStringsInput => ({
  ...NO_STRINGS,
  ...(locale === 'uk' ? UKRAINIAN : {}),
});

/** The calendar day of a `Date` that holds floating wall-clock values: `YYYY-MM-DD`. */
const dayOf = (date: Date): string =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');

function update({ locale, ...patch }: RuntimeOptions): void {
  instance?.setOptions({
    ...patch,
    ...(locale !== undefined && { locale, strings: stringsOf(locale) }),
  });
}

function owned(id: Task['id']): OwnedTask | undefined {
  const record = instance?.getTask(id);
  if (record?.start === undefined || record.end === undefined) return undefined;
  return { start: dayOf(record.start), end: dayOf(record.end), progress: record.progress };
}

const harness: EditHarness = {
  renderer: 'vanilla',
  mount,
  update,
  owned,
  changes: recorder.changes,
  events: recorder.events,
  get chart() {
    return instance;
  },
  get core() {
    return instance?.core;
  },
};
window.__ganttEdit = harness;

const initial = new URLSearchParams(window.location.search).get('fixture');
mount({ fixture: initial !== null && findFixture(initial) ? initial : 'sample-project' });

import.meta.hot?.dispose(() => {
  instance?.destroy();
  app.replaceChildren();
  delete window.__ganttEdit;
});
