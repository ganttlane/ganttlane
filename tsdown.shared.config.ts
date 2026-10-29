import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { TsdownHooks, UserConfig } from 'tsdown';

/**
 * Comments kept in the published JavaScript: legal comments and the `@__PURE__` /
 * `@__NO_SIDE_EFFECTS__` annotations that let a consumer's bundler drop unused code. JSDoc goes:
 * the declaration files keep the full TSDoc, and in the JS it only made the tarballs larger
 * (core's `index.js` 512 → 308 kB). The source maps still embed the sources, comments included.
 */
export const outputOptions: NonNullable<UserConfig['outputOptions']> = {
  comments: { legal: true, annotation: true, jsdoc: false },
};

/** A declaration file's closing `//# sourceMappingURL=<url>` line (the last line, no newline). */
const TRAILING_MAP_COMMENT = /\r?\n\/\/# sourceMappingURL=(\S+)[ \t]*\r?\n?$/;

/**
 * tsdown `build:done` hook: removes the `//# sourceMappingURL=….d.ts.map` comment that
 * Rolldown appends to every declaration file when `sourcemap` is on, from a `.d.ts` whose map
 * was not emitted.
 *
 * We ship no declaration maps (they point at `src`, which is not published), but neither
 * `dts: true` nor `dts: { sourcemap: false }` keeps the comment out: it is added for the
 * bundle's `sourcemap: true` (the JS `.js.map` files stay, they embed `sourcesContent`). A comment
 * without its file makes editors and debuggers look for a map that is not there. A map that
 * *was* emitted keeps its comment, so turning declaration maps on again needs no change here.
 * `scripts/check-pack.mjs` (part of `pnpm check`) asserts the result on the packed files.
 */
export const stripDanglingDeclarationMapComments: TsdownHooks['build:done'] = ({ chunks }) => {
  for (const chunk of chunks) {
    if (!/\.d\.[cm]?ts$/.test(chunk.fileName)) continue;
    const file = resolve(chunk.outDir, chunk.fileName);
    const text = readFileSync(file, 'utf8');
    const match = TRAILING_MAP_COMMENT.exec(text);
    const url = match?.[1];
    if (match === null || url === undefined) continue;
    if (existsSync(resolve(dirname(file), url))) continue;
    writeFileSync(file, text.slice(0, match.index) + '\n');
  }
};
