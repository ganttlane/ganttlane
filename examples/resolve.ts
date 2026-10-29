import { fileURLToPath } from 'node:url';

/** One entry of Vite's `resolve.alias`. */
export interface ExampleAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

/**
 * What every tool that runs the examples from source (the Vitest project `examples`, the
 * documentation site) adds to its Vite `resolve.alias`.
 *
 * `@ganttlane/react/styles.css` is, in the published package, a copy of the stylesheet of
 * `@ganttlane/dom` made by the build (`dist/styles.css`): it has no `@ganttlane/source` export
 * condition, because an export may not point out of its package. Run from source, the import of
 * an example (`import '@ganttlane/react/styles.css'`, as an application writes it) is this alias:
 * the same file, and no build in between.
 *
 * @returns The aliases.
 */
export function exampleAliases(): ExampleAlias[] {
  return [
    {
      find: /^@ganttlane\/react\/styles\.css$/,
      replacement: fileURLToPath(new URL('../packages/dom/src/styles.css', import.meta.url)),
    },
  ];
}
