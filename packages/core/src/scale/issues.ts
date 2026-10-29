import type { Issue } from '../shared';

/**
 * Issue codes produced by the `scale` module:
 * - `'invalid-view-mode'`: the `viewModes` option or one of its view modes is malformed
 *   (non-positive `pxPerDay`, unknown unit, bad step, empty headers, malformed snap, line or
 *   padding duration, duplicate or missing id). Errors drop the view mode (an override of a
 *   preset leaves the preset); warnings (unknown fields) only report what was ignored;
 * - `'invalid-snap'`: a snap setting (`scheduling.snap` or a view mode's `snap`) is malformed or
 *   mixes calendar and fixed units (`'1mo 1d'`); error, the setting is ignored;
 * - `'snap-below-granularity'`: an explicitly configured snap step is finer than
 *   `scheduling.granularity`; warning, the step is raised to the granularity (FR-SNAP-14);
 * - `'snap-not-multiple'`: an explicitly configured snap step is not a multiple of the
 *   granularity, is under a day but does not divide 24 h, or is over a day but not whole days;
 *   warning, the step is raised to the next step that fits (FR-SNAP-2, FR-SNAP-14).
 */
export type ScaleIssueCode =
  'invalid-view-mode' | 'invalid-snap' | 'snap-below-granularity' | 'snap-not-multiple';

/** An {@link Issue} raised by the `scale` module. */
export type ScaleIssue = Issue<ScaleIssueCode>;
