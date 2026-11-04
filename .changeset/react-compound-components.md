---
'@ganttlane/react': minor
---

Compound components and a hook that follows one task. Nothing changes for an app that uses
`<Gantt>`, `useGantt`, `useGanttState(gantt, selector)` or `<TaskList gantt>`: they take the same
props, give the same results, and an app that imports only `<Gantt>` ships no code of the new parts.

- `<GanttRoot {...options}>` makes a chart (it takes the props of `<Gantt>`) and shares it with the
  components below it. It draws no element of its own, and the portals of the slots are inside it, so
  what `renderTooltip`, `renderLinkMenu` and `renderBarLabel` return sees its context.
- `<GanttChart>` is the `div` the chart is drawn into, with the `id`, `className`, `style`, `aria-*`
  and `data-*` props of `<Gantt>`. A root has one; a second one is reported in development.
- `useGanttContext()` is the chart of the root. `useGanttState(selector, isEqual?)` reads a slice of
  it, and `<TaskList>` takes it when it is given no `gantt`. They throw, with a message that names
  them, outside a root. A context cannot know the type of `task.data`: `GanttRoot` infers it from its
  props, below it you name it (`useGanttContext<MyData>()`).
- `useGanttBar(id, gantt?)` follows one task: its record, `draft` (the dates and progress the chart
  shows while the bar is dragged, or a change of controlled data that is not applied yet),
  `isDragging`, `isSelected`, `isFocused` and `box`, where its bar is drawn in px from the corner of the
  chart's element, for a panel that goes with the bar. It renders again only when one of these changes.
- Not components: the header, the grid, the bars and the links. The vanilla renderer draws them as
  one skeleton, so there is no `Gantt.Header` or `Gantt.Bars` to compose; style them with CSS.
- The `TaskListProps.gantt` prop is now optional in the types.
- A guide (Composing a chart in React), the `react-compound` example and the README of the package.
