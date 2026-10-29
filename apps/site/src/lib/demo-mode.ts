/** The two ways a demo can show its example: the vanilla code, or the React code. */
export type Mode = 'vanilla' | 'react';

/**
 * The event a `<Demo>` sends (on its root element) when its mode changes: `detail` is the new
 * mode. `demo-client.ts` sends it, and the React island listens.
 */
export const MODE_EVENT = 'ganttlane:demo-mode';

/**
 * Whether a value is a {@link Mode}.
 *
 * @param value - Anything.
 * @returns Whether it is.
 */
export function isMode(value: unknown): value is Mode {
  return value === 'vanilla' || value === 'react';
}
