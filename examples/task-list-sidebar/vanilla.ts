import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type Gantt, type TaskId } from '@ganttlane/dom';

import { links, tasks } from './data';
import {
  BAR_MARGIN,
  describeChange,
  describeExpanded,
  hoveredId,
  keepRowAt,
  type ListRow,
  listRows,
  ROW_HEIGHTS,
  THEMES,
  treeAction,
  VIEW_MODES,
} from './helpers';
import { options } from './options';

/** A new element with a class, and children. */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

/** Sets an attribute, or removes it for `undefined`; touches the DOM only when the value differs. */
function setAttr(node: Element, name: string, value: string | undefined): void {
  if (value === undefined) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) {
    node.setAttribute(name, value);
  }
}

/** Sets the text of a node; touches the DOM only when it differs. */
function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  // ---- The markup ----
  //
  //   .task-list-scroller          the box that scrolls vertically: the host of the chart
  //     .task-list-content
  //       .task-list               the list: a header and a tree of rows
  //       .task-list-chart         the chart, as tall as its rows, and the hover band
  const root = element('div', 'task-list-demo');
  const toolbar = element('div', '');
  toolbar.setAttribute('role', 'toolbar');
  const scroller = element('div', 'task-list-scroller');
  const content = element('div', 'task-list-content');
  const header = element('div', 'task-list__header');
  header.setAttribute('aria-hidden', 'true');
  header.append(
    element('span', 'task-list__header-name', 'Task'),
    element('span', 'task-list__header-dates', 'Dates'),
  );
  const tree = element('div', 'task-list__tree');
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Tasks');
  const list = element('div', 'task-list', header, tree);
  const chartColumn = element('div', 'task-list-chart');
  const chart = element('div', 'task-list-chart__gantt');
  const band = element('div', 'task-list__band');
  band.hidden = true;
  chartColumn.append(chart, band);
  content.append(list, chartColumn);
  scroller.append(content);
  const status = element('p', '');
  status.textContent =
    'Click a name to scroll to its bar, or a bar to select its row. Drag a bar and the Dates follow.';
  root.append(toolbar, scroller, status);
  container.append(root);

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // A click on a bar does not select it: that is up to you. Here it selects its task, and
    // `sync` shows it in the list.
    onTaskClick: (record) => {
      gantt.select([record.id]);
    },
    onTasksChange: (changeSet) => {
      status.textContent = describeChange(changeSet, nameOf);
    },
    onExpandedChange: (keys) => {
      status.textContent = describeExpanded(keys, nameOf);
    },
  });
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);

  // ---- The list ----

  /** The rows as drawn, the element of each task and the task of each element. */
  let rows: readonly ListRow[] = [];
  const rowElements = new Map<TaskId, HTMLElement>();
  const taskOf = new WeakMap<Element, TaskId>();
  /** The row that is the tab stop of the tree (roving tabindex), and the selection it followed. */
  let active: TaskId | undefined;
  let followed: readonly TaskId[] = [];
  /** The row the pointer is on in the list (the chart's own hover is in its snapshot). */
  let pointerOn: TaskId | undefined;
  /** The parts of the snapshot that `sync` last drew the rows and the sizes from. */
  let seenDerived: unknown;
  let seenLayout: unknown;

  /** Draws the row of one task, or the one it already has, from the values in `row`. */
  function paint(row: ListRow): HTMLElement {
    let node = rowElements.get(row.id);
    if (!node) {
      node = element('div', 'task-list__row');
      node.setAttribute('role', 'treeitem');
      node.dataset.taskId = String(row.id);
      node.tabIndex = -1;
      const toggle = element('span', 'task-list__toggle');
      toggle.setAttribute('aria-hidden', 'true');
      toggle.dataset.toggle = '';
      node.append(toggle, element('span', 'task-list__name'), element('span', 'task-list__dates'));
      rowElements.set(row.id, node);
      taskOf.set(node, row.id);
    }
    node.style.setProperty('--depth', String(row.depth));
    setAttr(node, 'aria-level', String(row.depth + 1));
    setAttr(node, 'aria-setsize', String(row.setSize));
    setAttr(node, 'aria-posinset', String(row.position));
    // `aria-expanded` is for groups only: a leaf has no state to report.
    setAttr(node, 'aria-expanded', row.isGroup ? String(row.isExpanded) : undefined);
    setAttr(node, 'data-group', row.isGroup ? '' : undefined);
    setAttr(node, 'data-stripe', String(row.stripe));
    const [, name, dates] = node.children;
    if (name && dates) {
      setText(name, row.name);
      setText(dates, row.dates);
      setAttr(name, 'title', row.name);
    }
    return node;
  }

  /** Puts the rows in the tree in order, keeping the elements (and the focus) that stay. */
  function place(): void {
    const present = new Set(rows.map((row) => row.id));
    for (const [id, node] of rowElements) {
      if (present.has(id)) continue;
      node.remove();
      rowElements.delete(id);
    }
    let next: Element | null = tree.firstElementChild;
    for (const row of rows) {
      const node = paint(row);
      if (node === next) next = next.nextElementSibling;
      else tree.insertBefore(node, next);
    }
  }

  /**
   * Brings the list in line with the chart. It runs for every change of the snapshot, and a scroll
   * frame, a hover and a drag preview are each one, so it starts by comparing: the parts of the
   * snapshot keep their identity until they change, and a new object means work to do.
   */
  function sync(): void {
    const snapshot = gantt.core.getSnapshot();

    // The sizes are the chart's: the list never has a number of its own.
    const layout = snapshot.layout.rows;
    if (layout !== seenLayout) {
      seenLayout = layout;
      root.style.setProperty('--task-list-row-height', `${String(layout.rowHeight)}px`);
      root.style.setProperty('--task-list-header-height', `${String(layout.headerHeight)}px`);
    }

    // The rows change with what is collapsed and with the data (a name, a date): then
    // `state.derived` is a new object.
    const { derived } = snapshot.state;
    if (derived !== seenDerived) {
      seenDerived = derived;
      rows = listRows(derived, gantt.getTask);
      place();
    }

    // The selection, wherever it was made (a bar, the list, `select`): the tab stop follows it.
    const selected = snapshot.selection.tasks;
    if (selected !== followed) {
      followed = selected;
      active = selected.at(-1) ?? active;
    }
    if (active === undefined || !rowElements.has(active)) active = rows[0]?.id;
    const hovered = pointerOn ?? hoveredId(snapshot.feedback.hover);
    for (const row of rows) {
      const node = rowElements.get(row.id);
      if (!node) continue;
      setAttr(node, 'aria-selected', String(selected.includes(row.id)));
      setAttr(node, 'data-hovered', row.id === hovered ? '' : undefined);
      setAttr(node, 'tabindex', row.id === active ? '0' : '-1');
    }

    // The band over the chart's row: where `getRowMetrics` says the row of the hovered task lies.
    const lying = hovered === undefined ? undefined : gantt.getRowMetrics(hovered);
    band.hidden = lying === undefined;
    if (lying)
      band.style.setProperty('--task-list-band-y', `${String(layout.headerHeight + lying.y)}px`);
  }
  // Called after every change of the snapshot. There is no event for "the rows changed".
  gantt.core.subscribe(sync);
  sync();

  /** A click on a name, or Enter on a row: select the task and scroll the chart to its bar. */
  function choose(id: TaskId): void {
    active = id;
    gantt.select([id]);
    // `scrollToTask` scrolls both ways; `keepRowAt` makes the vertical one stay where it is.
    gantt.scrollToTask(id, {
      align: 'center',
      alignY: keepRowAt(gantt.core.getSnapshot(), id),
      behavior: 'smooth',
    });
  }

  /** The id of the row an event happened in. */
  const rowOf = (event: Event): { id: TaskId; node: Element } | undefined => {
    const node = event.target instanceof Element ? event.target.closest('.task-list__row') : null;
    const id = node ? taskOf.get(node) : undefined;
    return node && id !== undefined ? { id, node } : undefined;
  };

  tree.addEventListener(
    'click',
    (event) => {
      const hit = rowOf(event);
      if (!hit) return;
      const row = rows.find((candidate) => candidate.id === hit.id);
      // The chevron opens and shuts a group; the rest of the row selects the task.
      if (
        row?.isGroup &&
        event.target instanceof Element &&
        event.target.closest('[data-toggle]')
      ) {
        active = hit.id;
        if (row.isExpanded) gantt.collapse(hit.id);
        else gantt.expand(hit.id);
      } else {
        choose(hit.id);
      }
    },
    { signal },
  );

  tree.addEventListener(
    'keydown',
    (event) => {
      const hit = rowOf(event);
      if (!hit || event.altKey || event.ctrlKey || event.metaKey) return;
      const action = treeAction(event.key, rows, hit.id);
      if (!action) return;
      // The arrows and Space would scroll the box otherwise.
      event.preventDefault();
      switch (action.type) {
        case 'focus':
          // Focusing a row scrolls the box to it, and the chart with it.
          rowElements.get(action.id)?.focus();
          break;
        case 'expand':
          gantt.expand(action.id);
          break;
        case 'collapse':
          gantt.collapse(action.id);
          break;
        case 'activate':
          choose(action.id);
          break;
      }
    },
    { signal },
  );

  // The tab stop is the row that has the focus.
  tree.addEventListener(
    'focusin',
    (event) => {
      const hit = rowOf(event);
      if (!hit || hit.id === active) return;
      active = hit.id;
      sync();
    },
    { signal },
  );

  // Hover: a mouse over a name lights the row of the chart (the band), and the other way round
  // (`sync` reads the chart's hover from its snapshot).
  tree.addEventListener(
    'pointerover',
    (event) => {
      if (event.pointerType !== 'mouse') return;
      pointerOn = rowOf(event)?.id;
      sync();
    },
    { signal },
  );
  tree.addEventListener(
    'pointerleave',
    () => {
      pointerOn = undefined;
      sync();
    },
    { signal },
  );

  // ---- The toolbar ----

  const addButton = (label: string, onClick: () => void): void => {
    const button = element('button', '', label);
    button.type = 'button';
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
  };

  const addSelect = <T extends string | number>(
    label: string,
    values: readonly T[],
    selected: T,
    onChange: (value: T) => void,
  ): void => {
    const field = element('label', '');
    const select = element('select', '');
    for (const value of values) {
      // `new Option()` does not exist in happy-dom, where the examples are tested.
      const item = document.createElement('option');
      item.value = item.textContent = String(value);
      item.selected = value === selected;
      select.append(item);
    }
    select.addEventListener(
      'change',
      () => {
        const value = values.find((candidate) => String(candidate) === select.value);
        if (value !== undefined) onChange(value);
      },
      { signal },
    );
    field.append(`${label} `, select);
    toolbar.append(field);
  };

  addButton('Expand all', () => gantt.expandAll());
  addButton('Collapse all', () => gantt.collapseAll());
  addSelect('View', VIEW_MODES, options.viewMode, (viewMode) => gantt.setViewMode(viewMode));
  // The rows get taller or shorter, and the list follows: it reads the sizes from the snapshot.
  addSelect('Row height', ROW_HEIGHTS, options.layout.rowHeight, (rowHeight) => {
    gantt.setOptions({ layout: { rowHeight, barHeight: rowHeight - BAR_MARGIN } });
  });
  addSelect('Theme', THEMES, 'auto', (theme) => gantt.setOptions({ theme }));

  return () => {
    controller.abort();
    // Also ends the subscription of `sync`.
    gantt.destroy();
    root.remove();
  };
}
