/**
 * Marks a branch the type checker proves unreachable, typically the `default` of a `switch` over
 * a union. Reaching it at run time means a caller bypassed the types (untyped JS), which is a
 * programming error, so it throws instead of returning an `Issue`.
 *
 * @param value - The value TypeScript narrowed to `never`.
 * @param message - What was expected, used in the error message.
 * @returns Never returns.
 * @throws TypeError always.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new TypeError(`${message}: ${String(value)}`);
}
