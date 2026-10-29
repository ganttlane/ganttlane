/**
 * The modules a source file imports, in the order it imports them: the specifier of every
 * `import` statement that starts a line, with or without bindings (`import './styles.css'`,
 * `import { a } from './data'`, `import type { B } from '@ganttlane/core'`). A plain reader of
 * text, not a parser, with no Node API (like `meta.ts`): examples are formatted code, and a
 * statement inside a comment or a string does not start a line. The site reads it to find which
 * stylesheets an example imports (`apps/site/integrations/example-styles.ts`).
 *
 * @param source - The text of a `.ts` or `.tsx` file.
 * @returns The specifiers, as written, in source order.
 */
export function importedModules(source: string): string[] {
  return [...source.matchAll(/^[ \t]*import\b[^'";]*?['"]([^'"\n]+)['"]/gm)].map(
    (match) => match[1] ?? '',
  );
}
