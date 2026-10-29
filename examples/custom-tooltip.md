# Custom tooltip

The tooltip of a task is the `tooltip` option. Its `render(context)` function returns what to show,
and the type of the answer decides how it is inserted, so that nothing is ever parsed as HTML by
accident:

| `render` returns                        | Shown as                                                               |
| --------------------------------------- | ---------------------------------------------------------------------- |
| a `string`                              | text                                                                   |
| `{ title, subtitle, details, actions }` | three lines of text and buttons that call `onSelect(context)`          |
| a DOM `Node`                            | the node, as it is                                                     |
| `{ node, dispose }`                     | a node that is told (`dispose()`) when the tooltip is done with it     |
| `{ html }`                              | markup, parsed as it is: the one way in, and sanitising it is your job |
| `null`, `''`, whitespace, `{}`          | nothing: no tooltip                                                    |

`render` runs when its inputs change (another task, new dates while dragging), not on every mouse
move. The context carries the task's `TaskRecord`, the `preview` of a drag in progress, the
predecessors and successors with their lags, the parent, the chart's `locale` and `api.hide()`.

## Vanilla

```ts
import '@ganttlane/dom/styles.css';
import { createGantt } from '@ganttlane/dom';

const container = document.querySelector<HTMLElement>('#chart'); // give it a height in CSS
if (!container) throw new Error('#chart not found');

createGantt(container, {
  tasks: [
    { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
    { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  ],
  links: [{ source: 'design', target: 'build' }],
  scroll: { initial: 'first-task' },
  tooltip: {
    trigger: 'hover', // or 'click': then it stays open, so that its buttons can be reached
    delay: 100, // ms before a hovered bar shows it
    placement: 'bottom', // it flips by itself when there is no room
    render: ({ task, preview, isDragging, predecessors, locale, api }) => {
      // While a bar is dragged, show where it would land.
      const start = preview?.start ?? task.start;
      const end = preview?.end ?? task.end;
      if (!start || !end) return null;
      const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
      // A link record names its tasks by id; `api` reads them.
      const after = predecessors.map((link) => api.getTask(link.source)?.name).join(', ');
      return {
        title: task.name,
        subtitle: `${day.format(start)} to ${day.format(end)}${isDragging ? ' (moving)' : ''}`,
        details: [`${Math.round(task.progress)}% done`, after && `after ${after}`]
          .filter(Boolean)
          .join(' · '),
        actions: [{ label: 'Open', onSelect: () => console.log('open', task.id) }],
      };
    },
  },
});
```

A tooltip with `actions` stays open until a press outside it or `Escape`, so its buttons can be
used. For anything the sections cannot say, return a node:

```ts
import { createGantt } from '@ganttlane/dom';

const container = document.querySelector<HTMLElement>('#chart'); // give it a height in CSS
if (!container) throw new Error('#chart not found');

createGantt(container, {
  tasks: [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' }],
  scroll: { initial: 'first-task' },
  tooltip: {
    render: ({ task }) => {
      const card = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = task.name; // textContent: the name is data, never markup
      const bar = document.createElement('progress');
      bar.max = 100;
      bar.value = task.progress;
      card.append(name, bar);
      return card;
    },
  },
});
```

## React

With `@ganttlane/react` the tooltip is a React element, drawn through a portal into the node the chart
shows. It sees your context providers and your state, and may use hooks. Keep the logic in a
component:

```tsx
import '@ganttlane/react/styles.css';

import { Gantt, type TaskTooltipContext } from '@ganttlane/react';

function TaskCard({ context }: { context: TaskTooltipContext }) {
  const { task, preview, isDragging, api } = context;
  const start = preview?.start ?? task.start;
  const end = preview?.end ?? task.end;
  if (!start || !end) return null; // an empty tooltip is not shown
  return (
    <div>
      <strong>{task.name}</strong>
      <div>
        {start.toLocaleDateString(context.locale)} to {end.toLocaleDateString(context.locale)}
        {isDragging ? ' (moving)' : null}
      </div>
      <progress max={100} value={task.progress} />
      <button type="button" onClick={api.hide}>
        Close
      </button>
    </div>
  );
}

export function Plan() {
  return (
    <Gantt
      style={{ height: 420 }}
      defaultTasks={[
        { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
        { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
      ]}
      scroll={{ initial: 'first-task' }}
      tooltip={{ trigger: 'click' }} // a tooltip with a button is easier to reach after a click
      renderTooltip={(context) => <TaskCard context={context} />}
    />
  );
}
```

`renderLinkMenu` (the menu a click on an arrow opens) and `renderBarLabel` (the text on a bar) work
the same way. A tooltip, menu or label that renders to nothing (`null`, `false`, an empty
element) is not shown.
