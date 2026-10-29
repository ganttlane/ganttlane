# Examples

Short examples you can copy into a project. Each one is a complete file (or two) with its imports;
none needs anything beyond the packages it names and a bundler that understands TypeScript, CSS
imports and, for React, JSX (Vite does). The runnable demo of the whole library is the
playground: `pnpm dev` in the repository, then open `/vanilla/`, `/edit/`, `/scroll/`, `/bench/`,
`/react/`, `/react-edit/` or `/react-ssr/` (the root [README](../README.md#the-playground) says what
each one shows).

| Example                                                        | Package                             | Shows                                                                                            |
| -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Vanilla basic](vanilla-basic.md)                              | `@ganttlane/dom`                    | `createGantt` with tasks, links and events; methods; clean-up                                    |
| [Vanilla controlled data](vanilla-controlled.md)               | `@ganttlane/dom`, `@ganttlane/core` | Your state owns the tasks: `dataMode: 'controlled'`, `patchTasks`, `setTasks`, a refused save    |
| [React basic](react-basic.md)                                  | `@ganttlane/react`                  | `<Gantt>` with uncontrolled data and an event handler                                            |
| [React controlled data, Save and Cancel](react-controlled.md)  | `@ganttlane/react`                  | Your state owns the tasks; `patchTasks`; an edit session with Save and Cancel (`onEditRollback`) |
| [Working days at one-hour granularity](working-days-hourly.md) | `@ganttlane/dom`                    | A Monday-to-Friday calendar with holidays, tasks timed to the hour, a lag, a before-hook         |
| [Custom tooltip](custom-tooltip.md)                            | both                                | `tooltip.render` (text sections, a DOM node) and `renderTooltip` (React)                         |
| [A release plan](project-plan.md)                              | `@ganttlane/dom`                    | Phases with children pinned to them, milestones, locked work, links with lags, status styles     |

Two things are the same in every example: the stylesheet (`@ganttlane/dom/styles.css`, or
`@ganttlane/react/styles.css` for React) is a separate import, and the container of a chart needs a
height. The React examples install the package with React: `pnpm add @ganttlane/react react react-dom`
(an app that already has `react` and `react-dom` needs only `pnpm add @ganttlane/react`).

The plan data in the examples uses dates in March 2026. A chart opens at today by default
(`scroll.initial: 'today'`), which for a plan in the past or future is the nearest end of its
range, so the examples set `scroll: { initial: 'first-task' }`.
