/**
 * Writes the version of `@ganttlane/core` into the `VERSION` constant it exports, which Changesets
 * knows nothing about. Part of `pnpm version-packages`, after `changeset version`:
 *
 *   node scripts/sync-version.mjs
 *
 * The packages are versioned together (`fixed` in `.changeset/config.json`) and `@ganttlane/dom`
 * re-exports the constant, so this is the one place. A test of `@ganttlane/dom` fails when the
 * constant and the manifest disagree.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const manifest = `${import.meta.dirname}/../packages/core/package.json`;
const entry = `${import.meta.dirname}/../packages/core/src/index.ts`;
const constant = /^export const VERSION: string = '[^']*';$/m;

const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
const source = readFileSync(entry, 'utf8');
if (!constant.test(source)) throw new Error(`no VERSION constant in ${entry}`);
writeFileSync(entry, source.replace(constant, `export const VERSION: string = '${version}';`));
