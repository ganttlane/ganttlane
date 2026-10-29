# Examples

Runnable examples you can copy into a project, one folder each. Every example has the data, the
options, the vanilla code and the React code in files of their own, and a README that says what it
shows. None needs anything beyond the packages it names and a bundler that understands TypeScript,
CSS imports and, for React, JSX (Vite does).

The documentation site, [ganttlane.github.io/ganttlane](https://ganttlane.github.io/ganttlane/),
renders these very files: each example has a page with a live demo (vanilla and React) and the code
that runs it, and `pnpm site:dev` in the repository serves the site. The runnable demo of the whole
library is the playground: `pnpm dev`, then open `/vanilla/`, `/edit/`, `/scroll/`, `/bench/`,
`/react/`, `/react-edit/` or `/react-ssr/` (the root [README](../README.md#the-playground) says what
each one shows).

### Basics

| Example                        | Package                              | Shows                                                                       |
| ------------------------------ | ------------------------------------ | --------------------------------------------------------------------------- |
| [Basic chart](basic/README.md) | `@ganttlane/dom`, `@ganttlane/react` | `createGantt` and `<Gantt>` with tasks, links and events; methods; clean-up |

### Time scale

| Example | Package | Shows |
| ------- | ------- | ----- |

### Scheduling

| Example                                                                   | Package | Shows                                                                                    |
| ------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| [Working days at one-hour granularity](working-calendar-hourly/README.md) | both    | A Monday-to-Friday calendar with holidays, tasks timed to the hour, a lag, a before-hook |

### Data

| Example                                                 | Package | Shows                                                                                         |
| ------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| [Controlled data](controlled-data/README.md)            | both    | Your state owns the tasks: `dataMode: 'controlled'`, `patchTasks`, `setTasks`, a refused save |
| [Edit session, Save and Cancel](edit-session/README.md) | both    | An edit session between Edit, Save and Cancel (`edit.begin`, `commit`, `rollback`)            |
| [Data formats](data-formats/README.md)                  | both    | Date, ISO and epoch dates, `duration`, `precision`, `endInclusive`, `links` vs `dependencies` |

### Editing

| Example | Package | Shows |
| ------- | ------- | ----- |

### Customization

| Example                                    | Package | Shows                                                                    |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------ |
| [Custom tooltip](custom-tooltip/README.md) | both    | `tooltip.render` (text sections, a DOM node) and `renderTooltip` (React) |

### React

| Example                                              | Package            | Shows                                                                                                                         |
| ---------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [The ref handle](react-ref-handle/README.md)         | `@ganttlane/react` | `<Gantt ref>` and the `GanttHandle`: `scrollToTask`, `setViewMode`, `select`, `updateTask`, `undo`, `edit.begin` from buttons |
| [useGantt and useGanttState](react-hooks/README.md)  | `@ganttlane/react` | `useGantt` with `setContainer` and `slots`, and `useGanttState` driving a toolbar outside the chart                           |
| [Controlled state](react-controlled-state/README.md) | `@ganttlane/react` | `tasks`, `links`, `viewMode`, `selectedKeys` and `expandedKeys` in one reducer, with `patchTasks` and an inspector            |
| [Slots as React](react-slots/README.md)              | `@ganttlane/react` | `renderTooltip`, `renderLinkMenu` and `renderBarLabel` reading your context, `slotKey`, errors in `onError`                   |

### Plans

| Example                                  | Package | Shows                                                                                        |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| [A release plan](release-plan/README.md) | both    | Phases with children pinned to them, milestones, locked work, links with lags, status styles |

Two things are the same in every example: the stylesheet (`@ganttlane/dom/styles.css`, or
`@ganttlane/react/styles.css` for React) is a separate import, and the container of a chart needs a
height. The React examples install the package with React: `pnpm add @ganttlane/react react react-dom`
(an app that already has `react` and `react-dom` needs only `pnpm add @ganttlane/react`).

The plan data in the examples uses fixed dates in 2026. A chart opens at today by default
(`scroll.initial: 'today'`), which for a plan in the past or future is the nearest end of its
range, so the examples set `scroll: { initial: 'first-task' }`.

## Adding an example

An example is a folder, `examples/<slug>/`. The slug is its name in the URL
(`/examples/<slug>/`): short, lower-case, with hyphens. Nothing else needs a change: the site, the
sidebar and the tests find the folder by itself (`pnpm test` covers it, `pnpm site:dev` shows it).

| File         | What it is                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`  | The front matter (below), the title, what the example shows, **the options it uses** (a small table) and notes. The text of the example's page on the site                                                                       |
| `data.ts`    | `export const tasks: Task[]` and `export const links: Link[]` (types from `@ganttlane/core`): plain, readable data, fixed dates in 2026, no randomness. A large dataset may use a small deterministic generator in the same file |
| `options.ts` | `export const options = { … } satisfies Partial<GanttOptions>` (`GanttOptions` needs `tasks`): only the options this example is about, each commented; handlers that do not need the example's own state may live here too       |
| `vanilla.ts` | `export function mount(container: HTMLElement): () => void`: the code of a user of `@ganttlane/dom`; returns the clean-up                                                                                                        |
| `react.tsx`  | `export default function Example()`: the same with `<Gantt>` (or the hooks), importing `data` and `options`                                                                                                                      |

An example may have more files: shared helpers (`helpers.ts`), a stylesheet (`styles.css`, which
`vanilla.ts` and `react.tsx` both import as `import './styles.css'`: the site puts it on the page
while the demo is shown, and takes it away after). The site shows every `.ts`, `.tsx` and `.css`
file of the folder, the four above first. A React-only example (slots, `ref`, hooks) may omit
`vanilla.ts`, and a vanilla-only one `react.tsx`; its README says so ("React only", "Vanilla
only").

**The front matter** of the README (flat `key: value` lines between `---`):

| Key           | Meaning                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | The name of the example: the title of its page                                                                                        |
| `description` | One sentence: what it shows (the page's lead and its card in the gallery)                                                             |
| `category`    | The group of the sidebar and the gallery (`Basics`, `Data`, `Scheduling`, `Customization`, `Plans`, …)                                |
| `order`       | A number: the place in its category; the lowest `order` of a category places the category (the ones here use tens: 10, 20, 21, 30, …) |
| `height`      | Optional: the height in px of the live demo on the site (default 480)                                                                 |
| `showsIssues` | Optional: `true` when the example reports issues on purpose (the test then does not expect none)                                      |

**`vanilla.ts`.** User-style code: `import '@ganttlane/dom/styles.css'`, `createGantt(…)` from
`data` and `options`, and the buttons the example needs, built from DOM it creates itself (no
`innerHTML`). The chart needs a container with a height, so the function makes its own `div` with
one and appends it to `container`. The returned function calls `destroy()` and removes what the
example added: the container must be empty afterwards. Listeners go through an `AbortController`
that the clean-up aborts.

**`react.tsx`.** The same chart: `import '@ganttlane/react/styles.css'`, `<Gantt>` with the same data
and options. `options` is spread as props; where a prop differs in React (`viewMode`, `tasks`,
`links` and `hierarchy.expandedKeys` are controlled props, `defaultViewMode`, `defaultTasks`, … are
their uncontrolled twins, and `dataMode` does not exist), the component says so in a comment and
passes it itself.

**Rules.**

- Import the packages by name (`@ganttlane/dom`, `@ganttlane/core`, `@ganttlane/react`), never by
  path: the files are copied into projects. Files of the folder import each other as `./data`.
- Neutral example vocabulary: Design, Build, Review, Launch, QA, Release, Backend, Frontend, Docs.
- Never `innerHTML` with data; set `textContent` or build nodes.
- Link the folder from the table above (a test checks it).
- A test mounts every `vanilla.ts` and renders every `react.tsx` in happy-dom (bars are drawn, the
  clean-up leaves the container empty) and checks that `data` and `options` produce no issues.
  `pnpm test --project examples` runs it alone.
- Links in a README are relative to the file (`../basic/README.md`, `../../packages/dom/README.md`,
  `data.ts`): they work on GitHub, and the site turns them into site pages or GitHub links.

Run `pnpm typecheck` and `pnpm lint` after writing one; `pnpm format` formats the README.
