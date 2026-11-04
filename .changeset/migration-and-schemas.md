---
'@ganttlane/core': minor
'@ganttlane/dom': minor
'@ganttlane/react': minor
---

Moving from frappe-gantt, and checking your data. Nothing changes in the production build of
`createGanttCore`, and the main entry of the production build is as large as it was.

- `@ganttlane/core/migrate` exports `fromFrappeGanttOptions(options)`: it turns the options of
  frappe-gantt into options of ganttlane and reports what it could not turn. Every key is either in
  the result or in `unmapped`, with a reason (`'manual'`, `'unsupported'`, `'removed'` or `'unknown'`);
  `notes` mark what was converted but behaves differently (`padding`, `column_width`). Tasks and event
  handlers are not converted.
- `@ganttlane/core/schema` exports `TaskSchema` and `LinkSchema`, the valibot schemas the core checks
  its input with, to validate data from an API and to extend a task with your own payload:
  `v.object({ ...TaskSchema.entries, data: MyDataSchema })`.
- The development build (export condition `development`, which Vite and webpack pick in dev mode)
  reports a top-level option key the core does not know as an `unknown-option` warning in
  `getIssues().options` and `onIssues`, and for a name from frappe-gantt it says where the option lives
  now (`bar_height` is `layout.barHeight`). The key is ignored as before. The production build does not
  look for unknown keys and does not carry the hints. A test of yours that runs with the `development`
  condition and expects `getIssues().options` to be empty will see the warning for a key the core does
  not know. The development build is about 0.9 kB larger.
