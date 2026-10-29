/**
 * Interactions (FR-EDIT, FR-LINK-4, FR-LINK-6, FR-PROG-3, `docs/architecture.md` §3, §4, §10):
 * the renderer-independent state machine that turns pixel-level pointer and key events into
 * effects (drag previews with live propagation, commits, link creation, autoscroll and range
 * extension intents, clicks and double clicks, cursor and tooltip feedback), the editing
 * permission matrix, and a geometric hit test over the layout for custom renderers. Depends on
 * `scale`, `schedule`, `progress`, `layout` and `viewport` (§3.1); never on the store or the
 * events, so the facade (plan step 3.8) wires the effects to the change controller.
 *
 * Other core modules import interactions only through this file.
 *
 * @module
 */

export { INTERACTION_DEFAULTS } from './defaults';
export type { BarHandles, HandleRect, HitTestInput } from './hit-test';
export { barHandles, hitTest, resolveHandles } from './hit-test';
export { createInteraction } from './machine';
export type { PermissionSource, TaskPermissions } from './permissions';
export { resolveEditing, resolvePermissions } from './permissions';
export type {
  AutoScrollEffect,
  CancelInput,
  CancelPreviewEffect,
  ClickEffect,
  CommitEffect,
  CreateLinkEffect,
  EditingOption,
  EmptyTarget,
  ExtendRangeEffect,
  FeedbackEffect,
  GestureKind,
  HandleOptions,
  HitTarget,
  Interaction,
  InteractionContext,
  InteractionCursor,
  InteractionEffect,
  InteractionEvent,
  InteractionFeedback,
  InteractionModifiers,
  InteractionOptions,
  InteractionPhase,
  KeyInput,
  LinkPreview,
  LinkPreviewEffect,
  LinkTarget,
  PointerInput,
  PreviewEffect,
  RefusalReason,
  RefusedEffect,
  ResolvedEditing,
  ResolvedHandles,
  TaskPart,
  TaskTarget,
  TimelineInput,
} from './types';
