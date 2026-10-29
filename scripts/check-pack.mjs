/**
 * Checks that what the published packages ship is self-consistent: every `sourceMappingURL`
 * comment in a shipped text file points at a file that is shipped too. Run after `pnpm build`
 * (it is part of `pnpm check`, between `build` and `size`):
 *
 *   node scripts/check-pack.mjs
 *
 * A package's file list is what `npm pack --dry-run --json` reports for it (the `files` field of
 * its manifest, so exactly what `pnpm publish` ships); the scripts of the package are not run
 * (`--ignore-scripts`), so the check leaves no copies of LICENSE and NOTICE behind. A comment
 * that points at a file that is not in the tarball makes editors and debuggers look for a map that
 * does not exist: this is what `dts: true` did to the declaration files (`index.d.ts.map`) until
 * `tsdown.shared.config.ts` stripped the comment. JavaScript source maps (`*.js.map`) are shipped
 * and embed `sourcesContent`; a `data:` URL is self-contained and always fine.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import process from 'node:process';

import { spawnCommandSync } from './spawn-command.mjs';

const rootDir = join(import.meta.dirname, '..');
const packagesDir = join(rootDir, 'packages');

/** Files in which a source map reference can occur (shipped sources, declarations, styles). */
const TEXT_FILE = /\.(?:[cm]?js|d\.[cm]?ts|css)$/;
/** `//# sourceMappingURL=<url>` (JS, declarations) or `/*# sourceMappingURL=<url> *\/` (CSS), alone on a line. */
const MAP_REFERENCE =
  /^(?:\/\/[#@]\s*sourceMappingURL=(\S+)|\/\*[#@]\s*sourceMappingURL=(\S+)\s*\*\/)[ \t]*$/gm;

/** The files `npm pack` would put in the tarball of the package in `dir`, as posix paths. */
function packedFiles(dir) {
  const result = spawnCommandSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`\`npm pack --dry-run\` failed in ${dir}:\n${result.stderr || result.stdout}`);
  }
  const [pack] = JSON.parse(result.stdout);
  return pack.files.map((file) => file.path);
}

/** The problems of one package: references to files that are not shipped. */
function check(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = packedFiles(dir);
  const shipped = new Set(files);
  const problems = [];
  let references = 0;
  for (const path of files.filter((file) => TEXT_FILE.test(file))) {
    const text = readFileSync(join(dir, path), 'utf8');
    for (const match of text.matchAll(MAP_REFERENCE)) {
      references++;
      const url = match[1] ?? match[2];
      if (url.startsWith('data:')) continue;
      // A URL with a scheme (`https:`) or a root-relative one is outside the tarball.
      const target = /^[a-z][a-z0-9+.-]*:|^\//i.test(url)
        ? null
        : posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(url)));
      if (target === null || !shipped.has(target)) {
        problems.push(`${manifest.name}: ${path} references "${url}", which is not shipped`);
      }
    }
  }
  return { name: manifest.name, fileCount: files.length, references, problems };
}

const dirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesDir, entry.name));

let failed = false;
for (const dir of dirs) {
  try {
    const { name, fileCount, references, problems } = check(dir);
    if (problems.length > 0) {
      failed = true;
      for (const problem of problems) process.stderr.write(`check-pack: ${problem}\n`);
    } else {
      process.stdout.write(
        `check-pack: ${name}: ${fileCount} files, ${references} source map references, all shipped\n`,
      );
    }
  } catch (error) {
    failed = true;
    process.stderr.write(`check-pack: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
if (failed) process.exitCode = 1;
