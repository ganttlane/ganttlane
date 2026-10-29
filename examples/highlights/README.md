---
title: Highlighted days
description: Days marked for the eye as dates, ranges and rules, with labels and colours, and how the weekends and holidays are drawn.
category: Time scale
order: 140
height: 460
---

# Highlighted days

The `highlights` option marks days of the timeline: an offsite, a code freeze, every Friday. A
highlight is **for the eye only**: it changes no date, no duration and no calendar, and a bar can
be dragged across it. What the calendar says is a different thing, drawn by a different option:
the weekends and the holidays are **non-working days**, and `display.nonWorkingDays` chooses how
they look. Both show a **label** when you hover a day, and the two are joined when they meet on one
day.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): eight tasks in March, and their links.
- [`options.ts`](options.ts): the highlights, the calendar's holiday, `display` and `highlightTooltip`.
- [`styles.css`](styles.css): one class, for the Fridays: your own stylesheet.
- [`helpers.ts`](helpers.ts): `describe`, which writes the status line from the settings.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the controls, with `setOptions` and props.

## Options

| Option                          | Value                                              | What it does                                                                          |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `highlights[].id`               | `'offsite'`, `'demo'`, `'freeze'`, `'retro'`       | The name of a highlight (required, and unique); it is `data-highlight` on its days    |
| `highlights[].range`            | `{ start, end }`                                   | A run of days, both ends included                                                     |
| `highlights[].dates`            | `['2026-03-04', '2026-03-18']`                     | Single days                                                                           |
| `highlights[].match`            | `(day) => day.weekday === 5`                       | A rule, asked about each day on the screen; `weekday` is 0 for Sunday                 |
| `highlights[].label`            | a string, or `(day) => string`                     | The text shown when a day is hovered                                                  |
| `highlights[].color`            | `'#3b82f6'`                                        | The colour of its days (the CSS custom property `--gantt-highlight-color`)            |
| `highlights[].className`        | `'is-retro'`                                       | An extra class on its days, for your own stylesheet                                   |
| `display.highlights`            | `true`                                             | Whether highlighted days are drawn at all (the default)                               |
| `display.nonWorkingDays`        | `'fill'`, `'stripes'` or `false`                   | How the weekends and holidays are drawn: shaded (the default), hatched, or not at all |
| `highlightTooltip.followCursor` | `false`                                            | The label stays where it opened (the default), or follows the cursor                  |
| `calendar.holidays`             | `[{ date: '2026-03-20', name: 'Public holiday' }]` | A named day off: a non-working day, drawn like a weekend, whose name joins the label  |
| `viewMode`                      | `'week'`                                           | The scale of the timeline (React: `defaultViewMode`, as nothing here changes it)      |
| `scroll.initial`                | `'first-task'`                                     | Opens on the plan                                                                     |
| `layout.rowHeight`, `barHeight` | `32`, `20`                                         | Compact rows, so that every task fits                                                 |

Any mix of `dates`, `range` and `match` makes the days of one highlight. A `range` of years costs
only the days that are on the screen.

## What to try

Hover the blue days (_Team offsite_), the green ones (_Demo day_) and the red ones (_Code freeze_).
Friday the 20th is a Friday **and** the public holiday, so its label joins the two: _Retro, 20/3 ·
Public holiday_. Switch **Non-working days** to `'stripes'`, and the weekends and the holiday are
hatched; to `false`, and they are not drawn at all (the calendar still treats them as days off).
Untick **Highlights**: every colour but the weekends goes. Untick **Fridays**: that is a new list
of highlights without the rule, handed to `setOptions({ highlights })`. Tick **Label follows the
cursor** and hover a day again.

## Notes

- **The list is replaced as a whole.** `setOptions({ highlights })` takes a new list (React: a new
  `highlights` prop), and the chart draws that. Fields of `display` are merged one by one:
  `setOptions({ display: { nonWorkingDays: 'stripes' } })` leaves `display.highlights` as it was.
- **Overlap.** Highlights that share a day are all drawn, the later one in the list on top, and the
  label shown is the one of the highlight on top.
- **A day label is joined** from the highlight's `label` and the calendar's name for the day
  (`holidays[].name`), in that order, with a dot between them. A weekend has no name, so a weekend
  with no highlight shows nothing.
- **Bad input is reported, not thrown.** A highlight without a string `id`, or with an `id` an
  earlier one has, is dropped; a field of the wrong kind is dropped from its highlight. Each is an
  `invalid-option` issue at `highlights[i].<field>`, in `getIssues().options` and `onIssues`.
- **Colours follow the theme.** A highlight with no `color` takes `--gantt-highlight-color`, and the
  strength of every highlight is `--gantt-highlight-opacity` (lower in the dark theme). The
  `is-retro` class of this example turns it down for the Fridays; see [`styles.css`](styles.css).
- **Days narrower than 2 px are not drawn.** In the year view (1 px a day) neither highlights nor
  non-working days appear; the month view (4 px a day) and everything above it show them.
- **Highlights are not holidays.** To forbid work on a day, put it in `calendar.holidays` or
  `calendar.weekends` (see [Working days at one-hour granularity](../working-calendar-hourly/README.md));
  to just mark it, put it in `highlights`.
