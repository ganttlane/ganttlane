---
title: Locale and strings
description: Switch the locale of the chart (header, dates and numbers) and override every text it writes with the strings option, with a full Ukrainian set as the example.
category: Customization
order: 560
height: 500
---

# Locale and strings

Two options make a chart speak your language, and they are separate on purpose:

- **`locale`**, a BCP 47 tag (`'en'` by default, not the browser's language, so that a server and a
  browser draw the same text), says how **dates and numbers** are written, with `Intl`: the labels
  of the header (months, weekdays, the range of a week), and the dates and numbers of the tooltip.
- **`strings`** says which **words** the chart uses for the text it writes itself: the lines of the
  tooltip, the title and the action of the link menu, and the accessible name of the chart. They
  are English until you override them, whatever the locale is. The words and the grammar are yours.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks that last 1, 3, 12, 5 and 2 working days (and a milestone), so the
  tooltip meets the plural forms of a language.
- [`options.ts`](options.ts): `locale`, the first scroll, and the list of locales in the select.
- [`strings.ts`](strings.ts): `uk`, a **full** Ukrainian `strings` object, with the plural rules of
  Ukrainian, `linkMenuOnly`, a set of two strings, and `wordings`, the list the select shows.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the three selects and the status line, which
  reads the `aria-label` of the chart from the DOM.

## Options

| Option           | Value                                                               | What it does                                                                 |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `locale`         | `'en'`; the select: `'uk'`, `'de'`, `'ja'`, `'th-TH-u-ca-buddhist'` | The tag for `Intl`: header labels, dates and numbers in the tooltip          |
| `strings`        | none; the select: `uk`, `linkMenuOnly`                              | The words of the chart. Any subset works; `undefined` puts English back      |
| `viewMode`       | `'week'`; the select: `'day'`, `'month'`                            | The scale, so you can see the header rows of each (React: a controlled prop) |
| `scroll.initial` | `'first-task'`                                                      | Opens on the plan                                                            |

The keys of `strings`, with their English default and what they are used for:

| Key                                                                        | English                                     | Used for                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `chartLabel`                                                               | `Gantt chart`                               | The `aria-label` of the chart's focusable region              |
| `progress(percent, locale)`                                                | `60% done`                                  | The progress line of the task tooltip                         |
| `workingDays(days, locale)`                                                | `1 working day`, `2.5 working days`         | The length line of the task tooltip                           |
| `dateRange(from, to, locale)`                                              | `Mar 2, 2026 – Mar 6, 2026`                 | The dates line of the task tooltip                            |
| `linkTitle(source, target, locale)`                                        | `Design → Build`                            | The title of the link menu                                    |
| `removeLink`                                                               | `Remove dependency`                         | The action of the link menu                                   |
| `today`, `zoomIn`, `zoomOut`, `viewMode`                                   | `Today`, `Zoom in`, `Zoom out`, `View mode` | The toolbar: reserved, nothing draws it yet                   |
| `hour`, `quarterDay`, `halfDay`, `day`, `week`, `month`, `quarter`, `year` | `Hour`, `Quarter day`, … `Year`             | The names of the view modes: reserved, nothing draws them yet |

## What to try

Choose a locale and look at the header: the month names, the order of day and month, the range of a
week and the era of the year (the Thai locale writes Buddhist years) all change, and the dates in the
tooltip with them. Hover a bar: the words of the tooltip are still English. Choose the Ukrainian
strings: the tooltip, the link menu (click an arrow), and the `aria-label` in the status line speak
Ukrainian. Hover Brief ("1 робочий день"), Design ("3 робочі дні") and Docs ("5 робочих днів"): the
word for "day" changes with the number, which is what `Intl.PluralRules` is for. Choose the third set: only two strings
change, and the rest stay English, whatever you chose before. Then mix them: locale `de` with
Ukrainian words writes the numbers the German way.

## Notes

- **A string with a number or a name in it is a function** of the value and the chart's locale
  (`workingDays: (days, locale) => …`); the others are text. The function does the grammar, plurals
  included: other languages have more forms than "one" and "other". In `strings.ts` the plural
  rules are Ukrainian (`new Intl.PluralRules('uk')`) whatever the locale is, because the grammar
  belongs to the words, and the locale only formats the numbers.
- **`strings` is merged key by key** with what was set before, in `setOptions` and in the React prop
  alike. A key you leave out keeps its value, so switching from a full set to a small one means
  going back to English first: `setOptions({ strings: undefined })`, then the new set (a React prop
  that changes is reset field by field for you). A value of the wrong kind (a function where a string
  goes, an empty string) puts that key's default back.
- **The week starts on Monday in every locale** in this version. The locale decides how a week is
  written in the header (`2–8`, `Mar 30 – Apr 5`), not where it begins; week starts and weekend
  defaults from the locale are planned. Which days are days off is the
  [`calendar.weekends`](../working-calendar-hourly/README.md) option, not the locale.
- **Not available yet: right-to-left.** `direction: 'rtl'` is accepted and reported as an
  `unsupported-option`; the chart is always drawn left to right.
- **What is not a string:** task names and the labels of highlighted days and holidays (yours), the
  output of `tooltip.render`, `linkMenu.render` and `display.renderBarLabel` (also yours: they receive
  `locale` and can use `Intl` with it), and the messages of issues, which are for developers and
  English.
- **Locales the runtime does not know.** A tag that is well formed but that the runtime has no data
  for (`'xx'`) draws English, never the runtime's own language. A tag that is not a tag is an issue
  (`invalid-option`). `context.locale` in a render function is the tag you gave, so format with
  `[locale, 'en']` as the library does if you want the same fallback.
- **A calendar of another kind** (`th-TH-u-ca-buddhist`) writes its years; the cells themselves stay
  Gregorian.
