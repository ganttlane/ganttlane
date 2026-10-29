/**
 * The little Node API the tests of this package use (`styles.test.ts` reads the stylesheet and
 * the README from disk, `shipped-comments.test.ts` lists and reads the sources of the packages),
 * declared here so that the package does not pull in all of `@types/node`: the renderer must stay
 * free of Node globals. Vitest's `?raw` is no option for `styles.css`, because it empties every
 * CSS import, and happy-dom replaces `URL`.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(
    path: string,
    options: { readonly withFileTypes: true },
  ): readonly { readonly name: string; isDirectory(): boolean }[];
}

interface ImportMeta {
  /** The directory of the current module (Node, and Vitest's runner). */
  readonly dirname: string;
}
