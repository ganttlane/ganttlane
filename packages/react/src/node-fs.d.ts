/**
 * The little Node API a test of this package uses (`package-manifest.test.ts` reads the
 * playground's manifest and the declaration stub of the stylesheet from disk), declared here so
 * that the package does not pull in all of `@types/node`: the package itself must stay free of
 * Node globals. (Not `new URL(import.meta.url)`: happy-dom replaces `URL`.)
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

interface ImportMeta {
  /** The directory of the current module (Node, and Vitest's runner). */
  readonly dirname: string;
}
