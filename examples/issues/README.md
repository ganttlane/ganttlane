---
title: Issues
description: Deliberately bad data and options, and the list of issues the chart reports for them, drawn beside it from getIssues() and kept up to date by onIssues.
category: Scheduling
order: 280
height: 580
showsIssues: true
---

# Issues

A chart does not throw on bad input. A link to a task that is not there, a cycle, a date that is not
a date, an end before its start, a value that is not a multiple of the data step, an option that
is not one of its values: each is reported as an `Issue`, the rest of the data is kept, and what
can be drawn is drawn. This example feeds the chart one of each on purpose and lists what comes back,
from `getIssues()` and from the `onIssues` handler. _Fix the input_ puts a clean plan in, and the
list empties by itself.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): the plan with its mistakes, each one commented with the issue it gives, and the
  plan without them.
- [`options.ts`](options.ts): two options that are not among their values.
- [`helpers.ts`](helpers.ts): `locationOf` and `detailOf`, which turn an `Issue` into text.
- [`styles.css`](styles.css): the layout of the chart and the list, in your own stylesheet.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, the list and two buttons.

## Options

| Option                   | Value                       | What it does                                                                                           |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `onIssues`               | a function (in the example) | Called with `{ source, issues }` when the list of the data or of the options changes, also at creation |
| `gantt.getIssues()`      | `{ data, options }`         | The current issues, whenever you ask (a method, not an option)                                         |
| `scheduling.propagation` | `'sideways'` (not a value)  | An `invalid-option`: the default, `'preserve-lag'`, is used                                            |
| `display.gridLines`      | `'diagonal'` (not a value)  | An `invalid-option` of the renderer, with the full path of the value                                   |
| `viewMode`               | `'week'`                    | One column a week: the whole plan fits                                                                 |
| `scroll.initial`         | `'first-task'`              | Opens on the plan; the default, `'today'`, is far from these dates                                     |

## What to try

- **Read the list.** The _Data_ section has the five problems of the plan, the _Options_ section the
  two of the options. Each item is the `code`, the `path` (or the task or link it belongs to), the
  `message`, and what you gave (`value`) and what the chart used instead (`suggested`).
- **Look at the chart for what survived.** _Review_ and _QA_ have no bar: an error makes a task
  invalid and its row empty. _Release_ is there, aligned to the day: a warning corrects a value and
  keeps the task. The two links that form a cycle are drawn, dashed and red.
- **Press _Fix the input_.** `setTasks`, `setLinks` and `setOptions` give the chart a clean plan; the
  chart reports the new lists with `onIssues` (the line under the chart), and both sections empty.
- **Press _Break it again_** and the issues return.

## Notes

- **The codes in this plan.**

  | Code                | Where                    | What the chart does                                                           |
  | ------------------- | ------------------------ | ----------------------------------------------------------------------------- |
  | `end-before-start`  | `tasks[2].end`           | An error: the task is invalid, a row without a bar                            |
  | `invalid-date`      | `tasks[3].start`         | An error: the task is invalid                                                 |
  | `misaligned`        | `tasks[4].start`         | A warning: aligned as `scheduling.alignInput` says; `suggested` is the result |
  | `unknown-link-task` | `links[1]`               | An error: the link is dropped                                                 |
  | `cycle`             | its `taskIds`, `linkIds` | An error: the links are kept and drawn, and scheduling ignores them           |
  | `invalid-option`    | `scheduling.propagation` | An error: the default is used, and `suggested` is it                          |

- **Severity.** `'error'` means that the item is unusable and was left out or replaced; `'warning'`
  means that it was accepted, with a correction. A `ChangeSet` can carry issues too
  (`source: 'change-set'`), and an `updateTask` that is refused returns them.
- **`getIssues()` and `onIssues`.** `getIssues()` is the list now, as `{ data, options }`. `onIssues`
  is called with the whole new list of one of them (`source`: `'data'`, `'options'`) when it changes,
  and also while the chart is created, so it is the one to use to keep a list on the screen up to date.
  The handler is a chart-level option, and so is `gantt.on('issues', …)`.
- **Unknown keys are ignored, not reported.** A misspelled option, `scheduling: { propogation: 'none' }`,
  is not an `invalid-option`: the chart has never heard of the key. A known option with a value that
  is not one of its values is reported. TypeScript catches the first; the second is what a config
  file or a form can give you, which is why this example casts its two bad values.
- **Some values are reserved.** A few options are planned and not available yet (the toolbar, a
  right-to-left chart, `scheduling.propagation: 'push-forward'`): they are reported as
  `unsupported-option`, and the default is used.
- **`message` is for people.** The development build (export condition `development`, which Vite
  sets in development) spells it out; the production build keeps the short form `'<path>: <code>'`.
  Never parse it: `code`, `path`, `value` and `suggested` are the same in both builds.
- **React.** `onIssues` is a prop, and the list is state. `scheduling` and `display` are passed to
  `<Gantt>` after the spread of `options`, from state, and left out once the input is fixed: in
  React the props are the truth, so an option changed with `setOptions` on the ref would be
  overwritten by the next render.
