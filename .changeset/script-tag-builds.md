---
'@ganttlane/dom': minor
---

Builds that load from a CDN with no bundler. The tarball now has, in `dist/`:

- `ganttlane.global.prod.js`: one minified file that sets the global `Ganttlane`, with everything
  `@ganttlane/dom` exports plus `createTaskList` and `fromFrappeGanttOptions`. The core,
  `@internationalized/date` and `valibot` are inside, so a plain `<script src>` is enough. About
  270 kB, 90 kB gzipped. The `jsdelivr` and `unpkg` fields point at it, so
  `https://cdn.jsdelivr.net/npm/@ganttlane/dom` serves it instead of a 404.
- `ganttlane.global.js`: the same, readable, with the full issue messages and the hints for old
  option names (the development build).
- `styles.min.css`: the stylesheet, minified (3.6 kB gzipped).
- `THIRD-PARTY-LICENSES.txt`: the licences of the code inside the scripts. Each script starts with a
  comment that names that code and points at this file.

The files are not in `exports`, so bundlers never pick them up, and the existing entries,
`sideEffects` and size budgets do not change. The ES module route (`+esm` on jsDelivr, esm.sh) works
as before; the installation guide, the README and the migration guide now describe both routes, and
how to pin a version and use Subresource Integrity.
