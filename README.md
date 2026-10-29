# ganttlane

An interactive Gantt chart library for the web: a framework-agnostic TypeScript core, a vanilla DOM
renderer with a themable stylesheet, and React bindings. Plans with thousands of tasks stay smooth
(only what is on screen is drawn), the schedule follows your work calendar, and a drag is one
`ChangeSet` you can veto, confirm, save or cancel.

> **Documentation: [ganttlane.github.io/ganttlane](https://ganttlane.github.io/ganttlane/).**
> Getting started, guides, live examples that run next to their code (vanilla and React), and the
> generated [API reference](https://ganttlane.github.io/ganttlane/api/).

> **Status:** pre-release (`0.0.0`), not published to npm yet. The API may still change before
> `0.1.0`. Packages will be published under the `@ganttlane` npm scope; until then, clone this
> repository and run `pnpm dev` for the playground.

## Packages

| Package                              | Description                                                                        | Install                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| [`@ganttlane/core`](packages/core)   | Headless core: dates, work calendar, time scale, scheduling, layout, state. No DOM | `pnpm add @ganttlane/core`                  |
| [`@ganttlane/dom`](packages/dom)     | Vanilla DOM renderer, `createGantt`, and the default CSS theme                     | `pnpm add @ganttlane/dom`                   |
| [`@ganttlane/react`](packages/react) | React components and hooks over the vanilla renderer (React 18.3 and 19)           | `pnpm add @ganttlane/react react react-dom` |

Install the one you import from: `@ganttlane/dom` brings `@ganttlane/core` with it, and
`@ganttlane/react` brings both (and re-exports the types and `patchTasks` you need, which matters
under strict pnpm). React and React DOM are peer dependencies: an app that already has them needs
only `pnpm add @ganttlane/react`. Use `@ganttlane/core` on its own to write a renderer, to schedule on
a server, or to test rules without a browser. All three are released together, on the same
version.

Each README is a reference of its package: install, quick start, concepts, options, events,
methods, theme, accessibility, browser support, size, limits and roadmap.

## A first chart

Vanilla:

```ts
import '@ganttlane/dom/styles.css';
import { createGantt } from '@ganttlane/dom';

createGantt(document.querySelector<HTMLElement>('#chart')!, {
  tasks: [
    { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
    { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  ],
  links: [{ source: 'design', target: 'build' }],
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  onTasksChange: (changeSet) => console.log(changeSet),
});
```

React:

```tsx
import '@ganttlane/react/styles.css';
import { Gantt } from '@ganttlane/react';

export const Plan = () => (
  <Gantt
    style={{ height: 420 }}
    defaultTasks={[
      { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
    ]}
    defaultLinks={[{ source: 'design', target: 'build' }]}
    defaultViewMode="week"
    scroll={{ initial: 'first-task' }}
  />
);
```

The container of a chart needs a height. `scroll: { initial: 'first-task' }` opens the chart on the
plan: the default is `'today'`, so a chart whose data is elsewhere in time opens at the nearest end
of its range. More examples (controlled data, an edit session with Save and Cancel, working days at
hourly granularity, a custom tooltip, a release plan, each in vanilla and in React) are in
[`examples/`](examples/README.md), one folder each. They run live, next to the code that runs them, on
the [documentation site](https://ganttlane.github.io/ganttlane/).

## Features

- **Time.** A linear time scale with real month and year lengths, seven view-mode presets (hour to
  year) you can override or extend, minute-level scheduling with drag snapping, and a data
  **granularity** that keeps every date a multiple of your step (`'1d'`, `'1h'`, `'15min'`).
- **Work calendar.** Weekends, named holidays, working-day exceptions and custom rules, with
  durations counted in working days or working time.
- **Dependencies.** Finish-to-start, start-to-start, finish-to-finish and start-to-finish links with
  lags and leads, cycle detection, and propagation of an edit along links and to pinned children.
- **Hierarchy.** Parent and child rows, expand and collapse, children pinned to their parent's edges,
  milestones and rows without a bar.
- **Editing.** Drag to move, resize and set progress; draw links by dragging or click-click; edit
  sessions with Save and Cancel; undo and redo (opt in with `history: true`); async before-hooks
  that confirm or rewrite a change; controlled and uncontrolled data.
- **Scrolling.** An infinite timeline that extends without a visible jump, programmatic scrolling to a
  date, today or a task, and automatic or fixed height with a sticky header.
- **Presentation.** Light and dark themes through `--gantt-*` custom properties in `@layer gantt`,
  an unstyled contract of stable classes and `data-*` attributes, tooltips and link menus with safe
  content types, localisable strings, and `ReactNode` slots in React.
- **Engineering.** Typed everywhere (`TData` flows from `task.data` to every handler), the caller's
  data is never mutated, bad data and options are issues (never a throw), every instance cleans up after
  itself, and React server rendering and StrictMode are supported.

What is not there yet (selection and keyboard editing, zoom gestures, a toolbar, a task list,
right-to-left) is listed in each package's "Limits and roadmap".

## Documentation

- The [documentation site](https://ganttlane.github.io/ganttlane/): getting started, guides, live
  examples and the [API reference](https://ganttlane.github.io/ganttlane/api/), generated from the
  TSDoc of the sources. `pnpm site:dev` serves it from this repository.
- [`packages/core`](packages/core/README.md), [`packages/dom`](packages/dom/README.md) and
  [`packages/react`](packages/react/README.md): the references.
- [`examples/`](examples/README.md): copy-pasteable examples, one folder each (data, options, vanilla
  and React code), which the site renders and the tests run.
- [`MIGRATION.md`](MIGRATION.md): moving from frappe-gantt, or from a modified fork of it.

### The playground

`pnpm dev` runs the playground, the runnable demo of the library. Its index, `/`, links to every
page: `/vanilla/`, `/edit/`, `/scroll/`, `/bench/`, `/react/`, `/react-edit/` and `/react-ssr/`.

| Page           | Package            | Shows                                                                                       |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `/vanilla/`    | `@ganttlane/dom`   | `createGantt` over a picker of datasets: theme, locale, view and edit mode, Save and Cancel |
| `/edit/`       | `@ganttlane/dom`   | Dragging bars, resizing, progress and links, with a log of what the chart reports           |
| `/scroll/`     | `@ganttlane/dom`   | The infinite timeline and the height modes, set from the query string                       |
| `/bench/`      | `@ganttlane/dom`   | A generated plan of 1k or 10k tasks, scrolled and dragged automatically, with timings       |
| `/react/`      | `@ganttlane/react` | Controlled data, edit mode with Save and Cancel, theme and locale as props, slots, a log    |
| `/react-edit/` | `@ganttlane/react` | `/edit/` for `<Gantt>`, with controlled data                                                |
| `/react-ssr/`  | `@ganttlane/react` | Server-rendered markup that the browser hydrates                                            |

## Browser and runtime support

The last two versions of Chrome, Edge, Firefox and Safari, and iOS Safari 16.4 or newer. Node 20 or
newer for `@ganttlane/core`. React 18.3 and 19. ESM only. The sizes (minified and gzipped) are about
56 kB for the core, 20 kB on top of it for the renderer and 6.5 kB more for the React bindings. The
stylesheet is shipped as written, 24 kB or 6.2 kB gzipped; a build that minifies CSS brings it to
about 13.7 kB, under 3 kB gzipped. `pnpm size` has the current numbers.

## Development

Requires Node 24 (see `.tool-versions` / `.nvmrc`; Node 22 is supported too) and pnpm 12 (the
`packageManager` field). Run `pnpm install` once, then:

| Command            | What it does                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`         | The playground (Vite) on package sources; its [pages](#the-playground) are `/vanilla/`, `/edit/`, `/scroll/`, `/bench/`, `/react/`, `/react-edit/` and `/react-ssr/` |
| `pnpm check`       | Everything CI runs: format, lint, dependency rules, types, tests with coverage, time-zone and performance tests, build, size. Must be green before a change is done  |
| `pnpm test`        | Unit tests (Vitest): `core` in Node, `dom` and `react` in happy-dom, `react-18` against React 18.3, `examples` (every example mounts, in vanilla and in React)       |
| `pnpm test:watch`  | The same, watching                                                                                                                                                   |
| `pnpm test:e2e`    | End-to-end tests (Playwright: Chromium, Firefox, WebKit) against a build of the playground. Run `pnpm test:e2e:install` once for the browsers                        |
| `pnpm site:dev`    | The documentation site (Astro Starlight, `apps/site`) with live examples, on package sources                                                                         |
| `pnpm site:build`  | Builds the site to `apps/site/dist` (what the Pages workflow deploys); `pnpm test:e2e:site` checks the build in a browser                                            |
| `pnpm size`        | Checks the min + gzip size of each entry against its budget (`.size-limit.ts`; build first)                                                                          |
| `pnpm size:report` | Breaks a build down by module and dependency (`--dev`, `--import createGanttCore`, `--package dom`, `--files`)                                                       |
| `pnpm lint:deps`   | dependency-cruiser: package boundaries and the module map of the core                                                                                                |
| `pnpm build`       | Builds the three packages (tsdown: ESM and declarations)                                                                                                             |
| `pnpm format`      | Prettier                                                                                                                                                             |
| `pnpm changeset`   | Adds a changeset for a user-facing change (see Releasing)                                                                                                            |

Layout: `packages/{core,dom,react}` are the published packages, `apps/playground` the demo and the
subject of the end-to-end tests (`e2e/`), `apps/site` the documentation site, `internal/fixtures` the
test data shared by tests and the playground, and `examples/` the examples (a private workspace
package, `@ganttlane/examples`).

### Development and production builds of `@ganttlane/core`

The core ships two builds of the same code. They report the same issues and behave the same; they
differ only in the issue `message`: short (`'<path>: <code>'`) by default, spelled out in the
build selected by the `development` export condition, which Vite and webpack choose in development
mode by themselves. See
[`@ganttlane/core`](packages/core/README.md#development-and-production-builds).

## Releasing

Versions and changelogs are managed with [Changesets](https://changesets.dev). The three packages
form a fixed group and are always released together with the same version.

- Every user-facing change comes with a changeset: run `pnpm changeset` (see
  [`.changeset/README.md`](.changeset/README.md)).
- `pnpm version-packages` applies pending changesets (versions, changelogs, lockfile);
  `pnpm release` builds and publishes everything not on npm yet. In CI,
  [`release.yml`](.github/workflows/release.yml) does both: it keeps a "Version Packages" pull
  request up to date and, once that is merged, publishes through npm trusted publishing with
  provenance.
- Tarballs contain `dist`, `LICENSE`, `NOTICE` and a `package.json` whose `exports` drop the
  `@ganttlane/source` condition of the repository (`publishConfig.exports`). `scripts/pack-hooks.mjs`
  copies the legal files in on `prepack` and checks that `publishConfig.exports` stays in sync.

Publishing stays off until the repository variable `RELEASE_ENABLED` is `'true'`; the one-time
steps before the first release are at the top of
[`.github/workflows/release.yml`](.github/workflows/release.yml).

## License

[MIT](LICENSE). ganttlane is a from-scratch rewrite inspired by
[frappe-gantt](https://github.com/frappe/gantt) (MIT, © Frappe Technologies Pvt. Ltd.) and by a
modified fork of it; ideas and parts of the domain logic originate from that project. See
[NOTICE](NOTICE) for the attribution.
