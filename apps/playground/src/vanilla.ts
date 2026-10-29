/**
 * Vanilla page of the playground: a fixture debug table and a chart made by `createGantt`
 * (plan step 4.12, `docs/api.md` §3 and §6), which is all the page uses of the library.
 *
 * - **Fixtures:** the picker covers the sample project, the 1k / 10k generated plans, the edge
 *   cases and the FR-SCH-7 scenarios; a new fixture destroys the chart and creates the next.
 * - **Runtime options through `setOptions`:** theme, locale (with a Ukrainian pack of strings),
 *   mode (`editing`); the view mode through `setViewMode`, and `scrollToTask`.
 * - **Edit mode:** "Begin editing" opens an edit session, "Save" commits it, "Cancel" rolls it
 *   back (`edit.begin` / `commit` / `rollback`), and the panel shows `edit.getChanges()`.
 * - **Life cycle:** "Destroy" and "Mount" show that nothing is left behind and that a chart can
 *   be created again.
 *
 * Query string (all optional): `fixture`, `theme` (`light` | `dark` | `auto`), `mode` (`view` |
 * `edit`, default `edit`), `locale`, `strings` (`uk` or a JSON object), `display` (display
 * options as JSON, popover groups included), `infinite`, `height` (`auto` or px: `layout.height`),
 * `shadow` (mount the chart inside an open shadow root, as a web component would host it).
 *
 * The strings of the chart follow the locale picker: the Ukrainian pack goes with `uk`, and the
 * `?strings=` overrides stay on top of it whatever the locale, also when the chart is mounted
 * again.
 *
 * `window.__ganttPlayground` is the hook of the e2e specs: `core()` and `gantt()` of the mounted
 * chart, `mount()` and `unmount()`. Specs drive the chart with the real mouse and keyboard.
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import type {
  DisplayOptions,
  Gantt,
  GanttOptions,
  GanttStringsInput,
  ThemeOption,
} from '@ganttlane/dom';
import { createGantt, DEFAULT_STRINGS, VERSION } from '@ganttlane/dom';
import type { Fixture } from '@ganttlane/fixtures';
import { findFixture } from '@ganttlane/fixtures';

import type { DebugRow } from './fixture-view';
import {
  DEBUG_COLUMNS,
  entriesOf,
  FIXTURE_GROUPS,
  readSelection,
  summarize,
  toDebugRows,
  writeSelection,
} from './fixture-view';
import { describeChanges } from './session-view';
import { UKRAINIAN } from './strings-uk';

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new Error('#app not found');

/** Creates an element with properties and children (text children become text nodes). */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

/** A `<select>` with the given values as options. */
function selectOf(id: string, values: readonly string[], selected: string): HTMLSelectElement {
  const select = el('select', { id, name: id });
  for (const value of values) select.append(el('option', { value, textContent: value }));
  select.value = selected;
  return select;
}

const params = new URLSearchParams(window.location.search);

const select = el('select', { id: 'fixture', name: 'fixture' });
for (const { group, label } of FIXTURE_GROUPS) {
  const optgroup = el('optgroup', { label });
  for (const entry of entriesOf(group)) {
    optgroup.append(el('option', { value: entry.id, textContent: entry.label }));
  }
  select.append(optgroup);
}

/** Query parameter that holds the chart's theme (`@ganttlane/dom/styles.css`, FR-THEME-2). */
const THEME_PARAM = 'theme';
const THEMES: readonly ThemeOption[] = ['auto', 'light', 'dark'];
/** The theme named by `value`; `auto` (the renderer's default) for anything else. */
const themeOf = (value: string | null): ThemeOption =>
  THEMES.find((theme) => theme === value) ?? 'auto';
const themeSelect = selectOf('theme', THEMES, themeOf(params.get(THEME_PARAM)));

/** The view modes of the presets (`docs/api.md` §3). */
const VIEW_MODES = ['hour', 'quarter-day', 'half-day', 'day', 'week', 'month', 'year'] as const;
const viewModeSelect = selectOf('view-mode', VIEW_MODES, 'day');

/** `?locale=` can be any tag (an invalid one shows the option issue), so it is an option of its own. */
const initialLocale = params.get('locale') ?? 'en';
const localeSelect = selectOf('locale', ['en', 'uk'], 'en');
if (![...localeSelect.options].some((option) => option.value === initialLocale)) {
  localeSelect.prepend(el('option', { value: initialLocale, textContent: initialLocale }));
}
localeSelect.value = initialLocale;

const modeSelect = selectOf(
  'mode',
  ['edit', 'view'],
  params.get('mode') === 'view' ? 'view' : 'edit',
);

/** A control with its label beside it (not around it, so that the label's name is its text only). */
const labelled = (text: string, control: HTMLSelectElement): HTMLSpanElement =>
  el(
    'span',
    { className: 'control' },
    el('label', { htmlFor: control.id, textContent: text }),
    ' ',
    control,
  );

const button = (text: string, onClick: () => void, signal: AbortSignal): HTMLButtonElement => {
  const element = el('button', { type: 'button', textContent: text });
  element.addEventListener('click', onClick, { signal });
  return element;
};

const notice = el('p', { className: 'notice', hidden: true });
notice.setAttribute('role', 'status');
const description = el('p', { className: 'description' });
const summary = el('p', { className: 'summary' });
summary.dataset.testid = 'fixture-summary';
const caption = el('caption');
const headRow = el('tr');
for (const column of DEBUG_COLUMNS) {
  headRow.append(el('th', { scope: 'col', textContent: column.label }));
}
const tbody = el('tbody');
const table = el('table', { className: 'debug-table' }, caption, el('thead', {}, headRow), tbody);
table.dataset.testid = 'debug-table';

const ganttContainer = el('div', { id: 'gantt', className: 'chart' });

/**
 * The styles of the page as one sheet that a shadow root can adopt: the chart's
 * (`@ganttlane/dom/styles.css`, which the page imports) and the playground's, read from the CSSOM.
 * A page's styles do not reach into a shadow root, so a chart in one has to be given its own.
 */
function pageStyles(): CSSStyleSheet {
  const text = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
    .join('\n');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  return sheet;
}

/** Gives `host` an open shadow root with the page's styles, and a box that fills it. */
function shadowChartParent(host: HTMLElement): HTMLElement {
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [pageStyles()];
  const box = el('div');
  box.style.height = params.get('height') === 'auto' ? 'auto' : '100%';
  root.append(box);
  return box;
}

// The chart measures itself when it is mounted, so its stylesheet has to be in effect by then
// (a module script can run before it, in WebKit): the copy for a shadow root reads what is loaded.
if (params.has('shadow')) {
  await Promise.all(
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
      .filter((link) => link.sheet === null)
      .map(
        async (link) =>
          new Promise<void>((resolve) => {
            link.addEventListener('load', () => {
              resolve();
            });
            link.addEventListener('error', () => {
              resolve();
            });
          }),
      ),
  );
}
/**
 * What the chart is mounted into: `#gantt`, or with `?shadow` a box inside its open shadow root,
 * which has the page's styles adopted. The e2e selectors (`#gantt .gantt__bar`) pierce open
 * shadow roots, so they work in both.
 */
const chartParent = params.has('shadow') ? shadowChartParent(ganttContainer) : ganttContainer;
// A chart whose height follows its rows is not held to the 24rem of the picker's container.
if (params.get('height') === 'auto') ganttContainer.style.height = 'auto';
const status = el('p', { className: 'chart-status' });
status.dataset.testid = 'gantt-status';
const changesPanel = el('pre', { className: 'chart-status' });
changesPanel.dataset.testid = 'edit-changes';
const eventLog = el('ol', { className: 'chart-status' });
eventLog.dataset.testid = 'gantt-events';

const controller = new AbortController();
const { signal } = controller;

let gantt: Gantt | undefined;
let stopStatus: (() => void) | undefined;
let shown: Fixture | undefined;
/** The last answer of Save or Cancel, shown while no session is open. */
let lastResult = '';

const beginButton = button('Begin editing', () => beginEditing(), signal);
const saveButton = button('Save', () => closeSession('commit'), signal);
const cancelButton = button('Cancel', () => closeSession('rollback'), signal);
const destroyButton = button('Destroy', () => unmount(), signal);
const mountButton = button('Mount', () => mount(), signal);
const scrollButton = button(
  'Scroll to last task',
  () => {
    const last = shown?.tasks.at(-1);
    if (last) gantt?.scrollToTask(last.id, { behavior: 'smooth' });
  },
  signal,
);

container.append(
  el('h1', { textContent: 'Vanilla · fixtures' }),
  el(
    'p',
    { className: 'picker' },
    el('label', { htmlFor: 'fixture', textContent: 'Fixture' }),
    select,
    el('label', { htmlFor: 'theme', textContent: 'Theme' }),
    themeSelect,
  ),
  notice,
  description,
  summary,
  el('div', { className: 'table-wrap' }, table),
  el(
    'section',
    { className: 'stub' },
    el('h2', { textContent: `Renderer (@ganttlane/dom ${VERSION})` }),
    el(
      'p',
      { className: 'picker' },
      labelled('Mode', modeSelect),
      beginButton,
      saveButton,
      cancelButton,
    ),
    el(
      'p',
      { className: 'picker' },
      labelled('View mode', viewModeSelect),
      labelled('Locale', localeSelect),
      scrollButton,
      destroyButton,
      mountButton,
    ),
    ganttContainer,
    status,
    changesPanel,
    eventLog,
  ),
);

/** An object given as JSON in the URL, `{}` when it is absent or unreadable. */
function jsonFromUrl(name: string): object {
  const raw = params.get(name);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** `layout.height` from `?height=`: `'auto'`, a number of px, or `undefined` for the container's. */
function heightFromUrl(): 'auto' | number | undefined {
  const raw = params.get('height');
  if (raw === 'auto') return raw;
  const height = Number(raw);
  return raw !== null && Number.isFinite(height) && height > 0 ? height : undefined;
}

/** The display options of the chart as JSON in the URL, split the way `createGantt` takes them. */
type VisualOptions = Pick<
  GanttOptions,
  'display' | 'highlights' | 'tooltip' | 'linkMenu' | 'highlightTooltip'
>;

/**
 * Display options as JSON in the URL, e.g. `?display={"tooltip":{"placement":"bottom"}}` (what
 * cannot be JSON, the callbacks, is not settable this way): the popover groups and the highlights
 * are options of their own in `createGantt`, the rest stays under `display`. Anything unreadable
 * is ignored.
 */
function visualFromUrl(): VisualOptions {
  const { highlightDays, tooltip, linkMenu, highlightTooltip, ...display } = jsonFromUrl(
    'display',
  ) as DisplayOptions;
  return {
    display,
    ...(highlightDays !== undefined && { highlights: highlightDays }),
    ...(tooltip !== undefined && { tooltip }),
    ...(linkMenu !== undefined && { linkMenu }),
    ...(highlightTooltip !== undefined && { highlightTooltip }),
  };
}

/**
 * The chart's strings from the URL: `?strings=uk` is the Ukrainian pack, a JSON object such as
 * `?strings={"chartLabel":"Plan"}` sets plain strings (functions cannot be JSON).
 */
function stringsFromUrl(): GanttStringsInput {
  const raw = params.get('strings');
  return raw === 'uk' ? UKRAINIAN : jsonFromUrl('strings');
}

/**
 * The strings the chart should have for the locale the picker shows: the Ukrainian pack goes
 * with `uk`, and what the URL asks for is laid over it, so that it survives a switch of locale
 * and a new mount (the mount and the switch both ask here).
 */
const stringsFor = (locale: string): GanttStringsInput => ({
  ...(locale === 'uk' ? UKRAINIAN : {}),
  ...stringsFromUrl(),
});

/** Every key of the strings set to `undefined`: what puts all of them back before a new set. */
const NO_STRINGS: GanttStringsInput = Object.fromEntries(
  Object.keys(DEFAULT_STRINGS).map((key) => [key, undefined]),
);

/** Shows what the core knows about the viewport and the scroll position (debug aid). */
function showStatus(instance: Gantt): void {
  const { timeline, viewportHeight, contentWidth, scrollTop } = instance.core.getSnapshot();
  const round = (value: number): string => String(Math.round(value));
  status.textContent = [
    `viewport ${round(timeline.viewportWidth)}×${round(viewportHeight)}`,
    `content ${round(contentWidth)} px`,
    `scroll ${round(timeline.scrollLeft)}, ${round(scrollTop)}`,
    // Floating wall-clock dates: the one under the left edge stays put while the range grows.
    `edge ${new Date(timeline.scale.xToDate(timeline.scrollLeft)).toISOString()}`,
    `range from ${new Date(timeline.range.start).toISOString()}`,
  ].join(' · ');
}

/** Appends to the log of what the chart reported (the newest on top, 30 at most). */
function note(text: string): void {
  eventLog.prepend(el('li', { textContent: text }));
  while (eventLog.children.length > 30) eventLog.lastElementChild?.remove();
}

/** Brings the edit controls and the changes panel in line with the chart. */
function showSession(): void {
  const open = gantt?.edit.isOpen ?? false;
  beginButton.disabled = gantt === undefined || modeSelect.value !== 'edit' || open;
  saveButton.disabled = !open;
  cancelButton.disabled = !open;
  destroyButton.disabled = gantt === undefined;
  mountButton.disabled = gantt !== undefined;
  const changes = gantt?.edit.getChanges();
  changesPanel.textContent =
    changes === undefined
      ? lastResult ||
        'No edit session. "Begin editing" opens one: Save keeps its changes, Cancel reverts them.'
      : `Editing, ${gantt?.edit.isDirty ? 'changed' : 'not changed yet'}:\n${describeChanges(changes)}`;
}

function beginEditing(): void {
  if (modeSelect.value !== 'edit') return;
  const result = gantt?.edit.begin();
  lastResult = '';
  note(`edit.begin: ${result?.status ?? 'no chart'}`);
  showSession();
}

function closeSession(how: 'commit' | 'rollback'): void {
  const result = gantt?.edit[how]();
  if (result === undefined) return;
  lastResult =
    'changes' in result
      ? `${how === 'commit' ? 'Saved' : 'Cancelled'}:\n${describeChanges(result.changes)}`
      : `${how}: ${result.status}`;
  note(`edit.${how}: ${result.status}`);
  showSession();
}

/** Drops the chart: the old one is destroyed (nodes, listeners, observers, core) first. */
function unmount(): void {
  stopStatus?.();
  stopStatus = undefined;
  gantt?.destroy();
  gantt = undefined;
  status.textContent = 'destroyed';
  showSession();
}

/** Creates the chart of the shown fixture with the options of the controls. */
function mount(): void {
  const fixture = shown;
  if (!fixture) return;
  unmount();
  const height = heightFromUrl();
  const instance = createGantt(chartParent, {
    tasks: fixture.tasks,
    links: fixture.links,
    ...(fixture.calendar && { calendar: fixture.calendar }),
    ...fixture.options,
    // `locale` is the core's, `strings` the renderer's (FR-I18N-*): `?locale=uk&strings=uk`. The
    // picker's locale decides the pack, so a chart mounted again keeps the words it had.
    locale: localeSelect.value,
    strings: stringsFor(localeSelect.value),
    theme: themeOf(themeSelect.value),
    // View mode: `editing: false`, no drag, no session; edit mode: drag, and sessions on demand.
    editing: modeSelect.value === 'edit',
    // `?infinite=1`: the infinite timeline, to watch the scroll compensation work.
    ...(params.has('infinite') && { timeline: { infinite: { extendBy: '2w' } } }),
    // `?height=auto` (the page scrolls the chart) or `?height=<px>`; otherwise the container's.
    ...(height !== undefined && { layout: { height } }),
    ...visualFromUrl(),
    onTasksChange: (changeSet) => {
      note(`tasksChange: ${changeSet.reason}, ${String(changeSet.changes.length)} tasks`);
      showSession();
    },
    onViewModeChange: (viewMode) => {
      viewModeSelect.value = viewMode.id;
      note(`viewModeChange: ${viewMode.id}`);
    },
    onDirtyChange: showSession,
    onEditRefused: ({ gesture, reason }) => {
      note(`editRefused: ${gesture} ${reason}`);
    },
    onIssues: ({ source, issues }) => {
      note(
        `issues (${source}): ${issues.map((issue) => issue.path ?? issue.code).join(', ') || 'none'}`,
      );
    },
  });
  gantt = instance;
  viewModeSelect.value = instance.core.getSnapshot().viewMode.id;
  stopStatus = instance.core.subscribe(() => {
    showStatus(instance);
  });
  showStatus(instance);
  showSession();
}

/**
 * For the e2e specs: the chart, its core, and the life cycle. Hover, clicks and drags are the
 * real mouse's (the renderer's input sends the core what it does); the hook is for reading the
 * state and for what no control does, such as scrolling to a task at once.
 */
Object.defineProperty(window, '__ganttPlayground', {
  configurable: true,
  value: { core: () => gantt?.core, gantt: () => gantt, mount, unmount },
});

function renderRow(row: DebugRow): HTMLTableRowElement {
  const tr = el('tr');
  if (row.flags.length > 0) tr.dataset.flagged = '';
  for (const { key } of DEBUG_COLUMNS) {
    const td = el('td');
    if (key === 'flags') {
      td.append(...row.flags.map((flag) => el('span', { className: 'flag', textContent: flag })));
    } else {
      td.textContent = String(row[key]);
    }
    if (key === 'name') td.style.paddingInlineStart = `${0.5 + row.depth * 1.25}rem`;
    tr.append(td);
  }
  return tr;
}

function render(id: string): void {
  const entry = findFixture(id);
  if (!entry) return;
  const fixture = entry.load();
  const rows = toDebugRows(fixture);
  select.value = entry.id;
  caption.textContent = `Fixture ${fixture.name}`;
  description.textContent = fixture.description;
  summary.textContent = summarize(fixture, rows);
  table.dataset.fixture = entry.id;
  const fragment = document.createDocumentFragment();
  for (const row of rows) fragment.append(renderRow(row));
  tbody.replaceChildren(fragment);
  shown = fixture;
  lastResult = '';
  mount();
}

const initial = readSelection(window.location.search);
if (initial.unknownId !== undefined) {
  notice.hidden = false;
  notice.textContent = `Unknown fixture "${initial.unknownId}", showing ${initial.entry.id}.`;
}
render(initial.entry.id);

select.addEventListener(
  'change',
  () => {
    notice.hidden = true;
    writeSelection(select.value);
    render(select.value);
  },
  { signal },
);

// The theme is `data-theme` on the chart's root: `setOptions` changes it in place, no remount.
themeSelect.addEventListener(
  'change',
  () => {
    const url = new URL(window.location.href);
    url.searchParams.set(THEME_PARAM, themeSelect.value);
    window.history.replaceState(null, '', url);
    gantt?.setOptions({ theme: themeOf(themeSelect.value) });
  },
  { signal },
);

// The locale and the words are two options, set together: the header and the tooltips follow
// the locale, the chart's name and the menu follow the strings. `strings` is merged key by key,
// so every key is put back first, and the pack of the new locale (with what the URL asked for)
// is set over it.
localeSelect.addEventListener(
  'change',
  () => {
    const locale = localeSelect.value;
    gantt?.setOptions({ locale, strings: { ...NO_STRINGS, ...stringsFor(locale) } });
  },
  { signal },
);

viewModeSelect.addEventListener(
  'change',
  () => {
    gantt?.setViewMode(viewModeSelect.value);
  },
  { signal },
);

// `editing` is an option like any other; leaving edit mode ends an open session, as Cancel.
modeSelect.addEventListener(
  'change',
  () => {
    if (modeSelect.value !== 'edit' && gantt?.edit.isOpen) closeSession('rollback');
    gantt?.setOptions({ editing: modeSelect.value === 'edit' });
    showSession();
  },
  { signal },
);

import.meta.hot?.dispose(() => {
  controller.abort();
  unmount();
  container.replaceChildren();
});
