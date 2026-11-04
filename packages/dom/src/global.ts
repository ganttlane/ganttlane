/**
 * Entry of the two `<script>` builds (`dist/ganttlane.global.js` and `dist/ganttlane.global.prod.js`,
 * built by `tsdown.global.config.ts` at the repository root): everything `@ganttlane/dom` exports,
 * its facade, the task list and the converter of frappe-gantt options, in one namespace. The bundler wraps it in an IIFE that assigns
 * the namespace to `Ganttlane`; this module itself touches no global.
 */
export { createChart } from './facade';
export * from './index';
export { createTaskList, mediateTaskList } from './task-list/index';
export { fromFrappeGanttOptions } from '@ganttlane/core/migrate';
