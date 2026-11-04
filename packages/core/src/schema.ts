/**
 * Entry point `@ganttlane/core/schema`: the valibot schemas of `Task` and `Link`, to validate data
 * from an API before it reaches the chart and to extend with your own payload:
 * `v.object({ ...TaskSchema.entries, data: MyDataSchema })`. They check the shape only (types of
 * fields and allowed literals), exactly what `createGanttCore` checks at its boundary; dates,
 * references and cycles are reported later, as issues.
 *
 * @packageDocumentation
 */

export { LinkSchema, TaskSchema } from './model';
