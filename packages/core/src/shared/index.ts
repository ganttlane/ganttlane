/**
 * Base types and helpers shared by every core module: `Issue`, `Result`, `assertNever`, the
 * build flag `DEV` with the short production messages, and small runtime checks. Depends on
 * nothing; every module may import it.
 *
 * @module
 */

export { assertNever } from './assert';
export { isFiniteNumber, isObject, isRecord, isSize } from './check';
export { DEV } from './dev';
export type { Issue, IssueSeverity } from './issue';
export { shortMessage } from './issue';
export type { Result } from './result';
export { err, ok } from './result';
