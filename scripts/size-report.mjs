/**
 * Size report of `@ganttlane/core` or `@ganttlane/dom` by module folder and by dependency (plan
 * steps 3.9 and 4.5, NFR-SIZE-1). Run `pnpm build` first, then:
 *
 *   pnpm size:report                      # core, production entry, every export
 *   pnpm size:report --dev                # core, development build (full issue messages)
 *   pnpm size:report --import createGanttCore[,other]   # what a consumer importing those pays
 *   pnpm size:report --package dom        # @ganttlane/dom on top of core (core is external, as
 *                                         # in .size-limit.ts), by layer, shared helper and file
 *   pnpm size:report --files              # also list the largest source files
 *   pnpm size:report --json               # machine-readable output
 *
 * How it measures: the built `dist` file is bundled again the way size-limit does it (Rolldown,
 * tree-shaking, minify, no annotation comments) with a source map. The dist source map is fed
 * back in, so every minified byte is attributed to the `src/` file or the dependency it came
 * from. Minified bytes are exact; gzip sizes per group are estimates: each group's minified text
 * is gzipped on its own and the results are scaled so that they add up to the gzip size of the
 * whole bundle (which is exact and matches size-limit up to its fixed "empty project" offset).
 *
 * Rolldown comes from `tsdown` (`Rolldown` re-export), so the script needs no extra dependency.
 */
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import { Rolldown } from 'tsdown';

const rootDir = resolve(import.meta.dirname, '..');

const { values: args } = parseArgs({
  // `pnpm size:report -- --dev` passes the `--` through.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    package: { type: 'string', default: 'core' },
    dev: { type: 'boolean', default: false },
    import: { type: 'string' },
    files: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    top: { type: 'string', default: '25' },
  },
});

if (args.package !== 'core' && args.package !== 'dom') {
  process.stderr.write(`size-report: --package is core or dom, not ${args.package}\n`);
  process.exit(1);
}
const packageName = args.package;
const pkgDir = join(rootDir, 'packages', packageName);
const pkgSrc = join(pkgDir, 'src');
if (packageName === 'dom' && args.dev) {
  process.stderr.write('size-report: dom has no development build, --dev is for core\n');
  process.exit(1);
}

const distFile = join(pkgDir, 'dist', args.dev ? 'index.development.js' : 'index.js');
if (!existsSync(distFile)) {
  process.stderr.write(`size-report: ${relative(rootDir, distFile)} is missing, run pnpm build\n`);
  process.exit(1);
}
const VIRTUAL_ENTRY = '\0size-report-entry';

/** Loads our own dist files together with their source maps, so Rolldown chains them to `src`. */
const distSourceMaps = {
  name: 'size-report:dist-source-maps',
  load(id) {
    if (!id.startsWith(join(pkgDir, 'dist') + sep) || !id.endsWith('.js')) return null;
    const code = readFileSync(id, 'utf8');
    // A re-export-only entry (`dom/dist/index.js`) has no map: its code is not attributed.
    if (!existsSync(`${id}.map`)) return { code };
    const map = JSON.parse(readFileSync(`${id}.map`, 'utf8'));
    return { code, map };
  },
};

/** `--import a,b`: a virtual entry that imports only those names, like size-limit's `import`. */
const importEntry = {
  name: 'size-report:import-entry',
  resolveId(id) {
    return id === VIRTUAL_ENTRY ? id : null;
  },
  load(id) {
    if (id !== VIRTUAL_ENTRY) return null;
    const names = (args.import ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    return `import { ${names.join(', ')} } from ${JSON.stringify(distFile)};\nconsole.log(${names.join(', ')});\n`;
  },
};

const bundle = await Rolldown.rolldown({
  input: args.import ? VIRTUAL_ENTRY : distFile,
  plugins: [distSourceMaps, importEntry],
  treeshake: true,
  // dom is measured on top of core, as size-limit does (`ignore: ['@ganttlane/core']`).
  external: packageName === 'dom' ? ['@ganttlane/core'] : [],
  onLog(level, log) {
    if (log.code === 'UNRESOLVED_IMPORT') throw new Error(log.message);
    if (level === 'warn') process.stderr.write(`rolldown: ${log.message}\n`);
  },
});
// Source paths in the map are relative to `dir` (nothing is written).
const outDir = join(pkgDir, 'dist');
const { output } = await bundle.generate({
  dir: outDir,
  minify: true,
  // 'hidden': no `//# sourceMappingURL` comment, so the code is what size-limit measures.
  sourcemap: 'hidden',
  comments: { annotation: false },
});
await bundle.close();

const chunk = output.find((item) => item.type === 'chunk' && item.isEntry);
if (!chunk?.map) throw new Error('size-report: no entry chunk with a source map');

// ---------------------------------------------------------------------------------------------
// Source map decoding (VLQ) and attribution of the minified bytes.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Map([...B64].map((char, index) => [char, index]));

/** Decodes the `mappings` of a source map into `[column, sourceIndex | -1]` segments per line. */
function decodeMappings(mappings) {
  const lines = [];
  let source = 0;
  for (const line of mappings.split(';')) {
    const segments = [];
    let column = 0;
    for (const segment of line.split(',')) {
      if (segment === '') continue;
      const fields = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = B64_VALUE.get(char);
        if (digit === undefined) throw new Error(`size-report: bad mapping character ${char}`);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      column += fields[0];
      if (fields.length > 1) source += fields[1];
      // Only the column and the source matter here; line, column and name deltas are skipped.
      segments.push([column, fields.length > 1 ? source : -1]);
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * Group of a source path: a core module folder (`core/time`), a dom layer (`dom/layers/bars`),
 * dom's shared helpers (`dom/shared`, `dom/dom-utils`) or renderer files (`dom (renderer)`), or a
 * dependency (`valibot`).
 */
function groupOf(path) {
  if (path === undefined) return '(export list, unmapped)';
  const nodeModules = path.lastIndexOf('node_modules/');
  if (nodeModules !== -1) {
    const parts = path.slice(nodeModules + 'node_modules/'.length).split('/');
    return `dep ${parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]}`;
  }
  const inSrc = relative(pkgSrc, path);
  if (!inSrc.startsWith('..')) {
    const parts = inSrc.split(sep);
    if (packageName === 'dom') {
      if (parts[0] === 'layers' && parts.length > 2) return `dom/layers/${parts[1]}`;
      if (parts[0] === 'layers') return 'dom/layers (contract, registry)';
      if (parts[0] === 'shared' || parts[0] === 'dom-utils') return `dom/${parts[0]}`;
      return `dom (renderer: ${parts[0].replace(/\.ts$/, '')})`;
    }
    return parts.length === 1 ? 'core (index)' : `core/${parts[0]}`;
  }
  return relative(rootDir, path);
}

/** Readable name of a source file for the `--files` listing. */
function fileOf(path) {
  if (path === undefined) return '(export list, unmapped)';
  const nodeModules = path.lastIndexOf('node_modules/');
  if (nodeModules !== -1) return path.slice(nodeModules + 'node_modules/'.length);
  const inSrc = relative(pkgSrc, path);
  return inSrc.startsWith('..')
    ? relative(rootDir, path)
    : `${packageName}/${inSrc.split(sep).join('/')}`;
}

const mapDir = dirname(join(outDir, chunk.fileName));
const sources = chunk.map.sources.map((source) => resolve(mapDir, source));
const code = chunk.code;
const codeLines = code.split('\n');
const mappingLines = decodeMappings(chunk.map.mappings);

/** @type {Map<string, string[]>} minified text per group / per file */
const textByGroup = new Map();
const textByFile = new Map();
function attribute(sourceIndex, text) {
  if (text === '') return;
  const path = sourceIndex >= 0 ? sources[sourceIndex] : undefined;
  for (const [key, target] of [
    [groupOf(path), textByGroup],
    [fileOf(path), textByFile],
  ]) {
    const list = target.get(key);
    if (list) list.push(text);
    else target.set(key, [text]);
  }
}

codeLines.forEach((lineText, lineIndex) => {
  const segments = mappingLines[lineIndex] ?? [];
  attribute(-1, lineText.slice(0, segments[0]?.[0] ?? lineText.length));
  segments.forEach(([column, sourceIndex], index) => {
    const end = segments[index + 1]?.[0] ?? lineText.length;
    attribute(sourceIndex, lineText.slice(column, end));
  });
  if (lineIndex < codeLines.length - 1) attribute(-1, '\n');
});

// ---------------------------------------------------------------------------------------------
// Totals and gzip estimates.

const totalMin = Buffer.byteLength(code);
const totalGzip = gzipSync(code, { level: 9 }).length;

function summarize(textMap) {
  const rows = [...textMap].map(([name, parts]) => {
    const text = parts.join('');
    return { name, min: Buffer.byteLength(text), rawGzip: gzipSync(text, { level: 9 }).length };
  });
  const rawGzipSum = rows.reduce((sum, row) => sum + row.rawGzip, 0);
  for (const row of rows) row.gzip = Math.round((row.rawGzip / rawGzipSum) * totalGzip);
  return rows.sort((a, b) => b.min - a.min).map(({ rawGzip: _raw, ...row }) => row);
}

const groups = summarize(textByGroup);
const files = summarize(textByFile);
const attributed = groups.reduce((sum, row) => sum + row.min, 0);
if (attributed !== totalMin) {
  throw new Error(`size-report: attributed ${attributed} B of ${totalMin} B`);
}

const label = args.import
  ? `import { ${args.import} } from '@ganttlane/${packageName}'${args.dev ? ' (development)' : ''}`
  : `@ganttlane/${packageName} ${args.dev ? 'development' : 'production'} entry (${relative(rootDir, distFile)})${packageName === 'dom' ? ', core external' : ''}`;

if (args.json) {
  process.stdout.write(
    `${JSON.stringify({ label, total: { min: totalMin, gzip: totalGzip }, groups, files }, null, 2)}\n`,
  );
} else {
  const kB = (bytes) => (bytes / 1000).toFixed(2).padStart(7);
  const pct = (bytes) => `${((bytes / totalMin) * 100).toFixed(1).padStart(5)}%`;
  const table = (title, rows) => {
    const width = Math.max(title.length, ...rows.map((row) => row.name.length));
    const out = [`${title.padEnd(width)}   min kB   share  ≈gzip kB`];
    for (const row of rows) {
      out.push(`${row.name.padEnd(width)}  ${kB(row.min)}  ${pct(row.min)}  ${kB(row.gzip)}`);
    }
    out.push(`${'total'.padEnd(width)}  ${kB(totalMin)}  100.0%  ${kB(totalGzip)}`);
    return out.join('\n');
  };
  const lines = [label, '', table('module / dependency', groups)];
  if (args.files) {
    lines.push('', table(`largest files (top ${args.top})`, files.slice(0, Number(args.top))));
  }
  lines.push(
    '',
    'min = minified bytes (exact). ≈gzip = per-group gzip scaled to the exact total ' +
      '(size-limit reports the total minus ~20 B for an empty project).',
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}
