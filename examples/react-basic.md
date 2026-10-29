# React basic

The same plan as [Vanilla basic](vanilla-basic.md) with [`@ganttlane/react`](../packages/react/README.md).
The chart owns the data (uncontrolled): `defaultTasks` and `defaultLinks` are where it starts, and
the handlers tell you what happened.

```sh
pnpm add @ganttlane/react react react-dom
```

`Plan.tsx`:

```tsx
import '@ganttlane/react/styles.css';

import { Gantt, type Link, type Task } from '@ganttlane/react';

// Defined outside the component, so the arrays are the same on every render.
const TASKS: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20', progress: 10 },
  { id: 'test', name: 'Test', start: '2026-03-23', duration: 5 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-30' },
];

const LINKS: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'test' },
  { source: 'test', target: 'launch' },
];

export function Plan() {
  return (
    <Gantt
      style={{ height: 420 }}
      defaultTasks={TASKS}
      defaultLinks={LINKS}
      defaultViewMode="week"
      scroll={{ initial: 'first-task' }}
      onTaskClick={(record) => {
        console.log('clicked', record.name);
      }}
      onTasksChange={(changeSet) => {
        console.log(
          changeSet.reason,
          changeSet.changes.map((change) => change.id),
        );
      }}
    />
  );
}
```

- `<Gantt>` renders one `div`; give it a height with `style` or `className`.
- Every option of `createGantt` is a prop (`calendar`, `scheduling`, `display`, `theme`, `locale`, …),
  and the `on<Event>` handlers are props too. A prop that changes later changes the chart without
  recreating it. Object props such as `scroll={{ initial: 'first-task' }}` may be written inline:
  they are compared by content.
- To read the chart or call its methods, give it a `ref` (`useRef<GanttHandle>(null)`, then
  `ref.current?.scrollToTask('test')`).
- To keep the data in your own state instead, see
  [React controlled data, Save and Cancel](react-controlled.md).
