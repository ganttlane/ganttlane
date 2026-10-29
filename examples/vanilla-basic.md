# Vanilla basic

A chart with four tasks, three links and two event handlers, made with
[`@ganttlane/dom`](../packages/dom/README.md). Install the package, then:

```sh
pnpm add @ganttlane/dom
```

`index.html`: the container needs a height, because the chart fills it and scrolls inside it.

```html
<div id="chart" style="height: 420px"></div>
<script type="module" src="./main.ts"></script>
```

`main.ts`:

```ts
import '@ganttlane/dom/styles.css';
import { createGantt } from '@ganttlane/dom';

const container = document.querySelector<HTMLElement>('#chart');
if (!container) throw new Error('#chart not found');

const gantt = createGantt(container, {
  tasks: [
    { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
    { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20', progress: 10 },
    { id: 'test', name: 'Test', start: '2026-03-23', duration: 5 },
    { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-30' },
  ],
  links: [
    { source: 'design', target: 'build' }, // finish-to-start, the default type
    { source: 'build', target: 'test' },
    { source: 'test', target: 'launch' },
  ],
  viewMode: 'week',
  // Open on the plan, not on today (the default), which is far away from these dates.
  scroll: { initial: 'first-task' },
  onTaskClick: (record) => {
    console.log('clicked', record.name, record.start, record.endExclusive);
  },
  // One event per drag, with every task it moved (here: the dragged one and what follows it).
  onTasksChange: (changeSet) => {
    console.log(
      changeSet.reason,
      changeSet.changes.map((change) => change.id),
    );
  },
});

// Everything can change later without recreating the chart.
gantt.setOptions({ theme: 'dark' }); // 'auto' (default), 'light' or 'dark'
gantt.setViewMode('day');
gantt.scrollToTask('test');
const stopListening = gantt.on('selectionChange', (keys) => {
  console.log('selected', keys);
});

// When the page is done with the chart: removes every node, listener and timer it added.
// Safe to call twice.
function cleanUp(): void {
  stopListening();
  gantt.destroy();
}
window.addEventListener('pagehide', cleanUp, { once: true });
```

What to try: drag a bar to move it (its successors follow along the links), drag its edges to
resize it, drag the little handle at the foot of a bar to change its progress, drag from the round
handle beside a bar onto another bar to link them, click an arrow to open its menu (remove the
dependency), hover a bar for its tooltip. `Escape` cancels a drag, and holding `Alt` while dragging
snaps to the data step instead of the view mode's.
