/**
 * Throws what a "run everything, then report" loop collected: nothing for no errors, the error
 * itself for one, an `AggregateError` for several. Used where one failure must not stop the
 * others (disposing, frame tasks, layer updates).
 *
 * @param errors - The errors caught, in order.
 * @param message - Message of the `AggregateError`.
 */
export function throwCollected(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
