/**
 * What an app pays for importing ONE function of `@ganttlane/core`: the size of
 * `import { name } from '@ganttlane/core'` for every value export of the built entry, min + gzip.
 * Plan step 6.2, ADR-019; `docs/perf.md` explains the numbers. Run `pnpm build` first.
 *
 *   pnpm size:each                       # every export, largest first
 *   pnpm size:each --compare other.js    # next to the same entry of another build of the package
 *   pnpm size:each --json                # machine-readable
 *
 * The numbers are exactly those of `pnpm size` for an entry with `import: '{ name }'`: every export
 * goes through size-limit itself, with the same plugins as `.size-limit.ts`
 * (`@size-limit/preset-small-lib`: Rolldown, tree-shaking, minification, the dependencies inlined,
 * annotation comments dropped, gzip) and its own correction for the code that the generated entry
 * adds. A copy of the bundling here was 0.03 to 0.04 kB off.
 *
 * `--compare` takes a built `index.js` that sits next to the `node_modules` of the dependencies
 * (for example a copy of an older `dist/index.js` in `packages/core/dist-before/`), so that the
 * effect of a change shows per export; an export that the other build does not have is shown as
 * `new`. A relative path is resolved against the directory the command was typed in (`INIT_CWD`,
 * which pnpm sets; the working directory otherwise), as the `--json` path of `pnpm bench` is.
 * `pnpm size:report --import name` breaks one import down by module and dependency.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import preset from '@size-limit/preset-small-lib';
import sizeLimit from 'size-limit';

const rootDir = resolve(import.meta.dirname, '..');
/** What a relative path of an option is relative to: where the command was typed. */
const baseDir = process.env.INIT_CWD ?? process.cwd();

const { values: args } = parseArgs({
  // `pnpm size:each -- --json` passes the `--` through.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    compare: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const current = resolve(rootDir, 'packages/core/dist/index.js');
const other = args.compare === undefined ? undefined : resolve(baseDir, args.compare);
for (const file of [current, other]) {
  if (file !== undefined && !existsSync(file)) {
    process.stderr.write(`size-each: ${file} is missing (run pnpm build)\n`);
    process.exit(1);
  }
}

/** The names a built entry exports (`import()` takes a file URL, not a path, on Windows). */
const exportsOf = async (file) => Object.keys(await import(pathToFileURL(file).href));

/** The gzip size, as `pnpm size` reports it, of an app that imports only `name` from `file`. */
async function gzipSizeOf(file, name) {
  const [{ size }] = await sizeLimit(preset, {
    checks: [{ files: [file], import: { [file]: `{ ${name} }` }, gzip: true }],
  });
  return size;
}

const names = await exportsOf(current);
const otherNames = other === undefined ? undefined : new Set(await exportsOf(other));
const rows = [];
for (const name of names) {
  const size = await gzipSizeOf(current, name);
  // An export that the old build lacks has no "before": importing it there is an error.
  const before =
    other === undefined || !otherNames.has(name) ? undefined : await gzipSizeOf(other, name);
  rows.push({ name, size, before });
}
rows.sort((a, b) => b.size - a.size);

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (args.json) {
  process.stdout.write(
    `${JSON.stringify(
      rows.map(({ name, size, before }) => ({ name, size, before: before ?? null })),
      null,
      2,
    )}\n`,
  );
} else {
  const kB = (bytes) => (bytes / 1000).toFixed(2).padStart(7);
  const width = Math.max(...names.map((name) => name.length), 'export'.length);
  const head =
    other === undefined
      ? ['export'.padEnd(width), 'gzip kB'.padStart(8)]
      : ['export'.padEnd(width), 'before'.padStart(8), 'now'.padStart(8), 'saved'.padStart(8)];
  process.stdout.write(`${head.join('  ')}\n`);
  for (const { name, size, before } of rows) {
    const cells =
      other === undefined
        ? [name.padEnd(width), kB(size)]
        : [
            name.padEnd(width),
            before === undefined ? 'new'.padStart(8) : kB(before),
            kB(size),
            before === undefined ? '-'.padStart(8) : kB(before - size),
          ];
    process.stdout.write(`${cells.join('  ')}\n`);
  }
  const compared = rows.filter((row) => row.before !== undefined);
  process.stdout.write(
    `\n${rows.length} exports; median single import ${(median(rows.map((row) => row.size)) / 1000).toFixed(2)} kB gzip` +
      (other === undefined
        ? ''
        : compared.length === 0
          ? ', none of them in the other build'
          : `, before ${(median(compared.map((row) => row.before)) / 1000).toFixed(2)} kB` +
            (compared.length < rows.length
              ? ` (of the ${compared.length} exports in both; new in this build: ${rows.length - compared.length})`
              : '')) +
      '.\n',
  );
}
