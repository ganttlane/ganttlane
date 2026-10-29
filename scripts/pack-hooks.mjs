/**
 * `prepack` / `postpack` hooks of the published packages (`packages/*`). pnpm runs them around
 * `pnpm pack` and `pnpm publish`, which is also what Changesets calls, so every tarball goes
 * through them. Run from the package directory:
 *
 *   node ../../scripts/pack-hooks.mjs prepack|postpack
 *
 * prepack:
 *   1. Checks that `publishConfig.exports` (what pnpm writes into the published manifest) equals
 *      `exports` without the `@ganttlane/source` condition, so a new entry point cannot be forgotten
 *      and the published package never points at `src/`, which is not shipped.
 *   2. Copies LICENSE and NOTICE from the repository root into the package (ADR-012,
 *      NFR-REL-1). pnpm only adds the root LICENSE by itself, not NOTICE.
 * postpack:
 *   Removes those copies again, so the repository root stays their only source.
 *
 * Note: `pnpm pack --dry-run` runs prepack but not postpack (pnpm 12), so it leaves the two
 * copies behind. They are byte-identical to the root files; the next real pack removes them.
 */
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

const SOURCE_CONDITION = '@ganttlane/source';
const LEGAL_FILES = ['LICENSE', 'NOTICE'];

const rootDir = join(import.meta.dirname, '..');
const pkgDir = process.cwd();
const pkgLabel = relative(rootDir, pkgDir) || '.';

/** Deep copy of an `exports` value with every `@ganttlane/source` condition removed. */
function withoutSourceCondition(value) {
  if (Array.isArray(value)) return value.map(withoutSourceCondition);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== SOURCE_CONDITION)
      .map(([key, entry]) => [key, withoutSourceCondition(entry)]),
  );
}

function checkPublishedExports() {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const expected = withoutSourceCondition(manifest.exports);
  const actual = manifest.publishConfig?.exports;
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${pkgLabel}/package.json: "publishConfig.exports" must equal "exports" without the ` +
        `"${SOURCE_CONDITION}" condition. Expected:\n${JSON.stringify(expected, null, 2)}`,
    );
  }
}

function isRootCopy(file) {
  const target = join(pkgDir, file);
  return existsSync(target) && readFileSync(target).equals(readFileSync(join(rootDir, file)));
}

function copyLegalFiles() {
  for (const file of LEGAL_FILES) {
    // A file that differs from the root one is not a leftover of an interrupted pack: refuse to
    // overwrite it (and so to delete it in postpack).
    if (existsSync(join(pkgDir, file)) && !isRootCopy(file)) {
      throw new Error(
        `${pkgLabel}/${file} differs from the repository root ${file}. Packages must not keep ` +
          `their own copy; remove it.`,
      );
    }
    copyFileSync(join(rootDir, file), join(pkgDir, file));
  }
}

function removeLegalFiles() {
  for (const file of LEGAL_FILES) {
    if (isRootCopy(file)) rmSync(join(pkgDir, file));
  }
}

const hook = process.argv[2];
try {
  if (pkgDir === rootDir) throw new Error('run this from a package directory, not the root');
  switch (hook) {
    case 'prepack':
      checkPublishedExports();
      copyLegalFiles();
      break;
    case 'postpack':
      removeLegalFiles();
      break;
    default:
      throw new Error(`unknown hook "${String(hook)}", expected "prepack" or "postpack"`);
  }
} catch (error) {
  process.stderr.write(`pack-hooks: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
