/**
 * The little Node API a test of this package uses (`styles.test.ts` reads the stylesheet and the
 * README from disk), declared here so that the package does not pull in all of `@types/node`:
 * the renderer must stay free of Node globals. Vitest's `?raw` is no option for `styles.css`,
 * because it empties every CSS import, and happy-dom replaces `URL`.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

interface ImportMeta {
  /** The directory of the current module (Node, and Vitest's runner). */
  readonly dirname: string;
}
