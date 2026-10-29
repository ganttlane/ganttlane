/**
 * The data model (FR-DATA, `docs/architecture.md` §3, §5.2): public input types (`Task`, `Link`),
 * their valibot schemas (ADR-016) and the normalization of input data into immutable, numeric
 * task and link models with indexes and typed issues, and writing scheduled values back into
 * input tasks (`patchTask`). Depends on `time`, `calendar` and `progress` (§3.1).
 *
 * Other core modules import the model only through this file.
 *
 * @module
 */

export type { ModelIssue, ModelIssueCode } from './issues';
export type { LinkModel } from './link';
export { normalizeLink } from './link';
export type { ModelInput, NormalizedModel } from './normalize';
export { normalizeModel } from './normalize';
export type { AlignInput, NormalizeModelOptions, ResolvedModelOptions } from './options';
export type { PatchChanges, PatchTaskContext, PatchValues } from './patch';
export { patchTask, patchTasks } from './patch';
export { LinkSchema, TaskSchema } from './schema';
export type { TaskDuration, TaskModel, TaskSpan } from './task';
export { addTaskDuration } from './task';
export type {
  DurationMode,
  EditingFlags,
  Link,
  LinkType,
  Task,
  TaskDependency,
  TaskId,
  TaskType,
} from './types';
export { alignTo, isoText, reportMisaligned } from './values';
