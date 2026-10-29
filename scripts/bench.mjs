/**
 * `pnpm bench` — the performance and size numbers of the library in one table (plan step 6.2,
 * NFR-PERF-1 … NFR-PERF-3, NFR-SIZE-1; `docs/perf.md` explains each row). It runs, in this order:
 *
 *   1. `pnpm build`, so that the packages are measured as published (skip with `--no-build`);
 *   2. the performance suites of every package (`GANTTLANE_PERF=1 vitest run`, the
 *      `*.perf.test.ts` files) with `scripts/bench-reporter.mjs`, which hands over their
 *      annotations;
 *   3. the benchmark page in the browsers of `playwright.config.ts` (`e2e/bench.spec.ts`,
 *      one worker so that the engines do not compete for the CPU), headless, with the playground
 *      built and served by the Playwright config as for `pnpm test:e2e`;
 *   4. `size-limit --json`, the size of every entry of `.size-limit.ts` against its budget.
 *
 * Then it prints the summary table and exits with 1 if a target is missed, a number is missing
 * (the format of an annotation changed: update the extractors below) or a step failed.
 *
 *   pnpm bench                        # everything, all browsers
 *   pnpm bench --project chromium     # one engine (repeat the option or use a comma list)
 *   pnpm bench --only perf,size       # a subset of: perf, browser, size
 *   pnpm bench --no-build             # the dist folders are fresh already
 *   pnpm bench --runs 3               # perf and browser steps three times, best number of each
 *   pnpm bench --json bench.json      # also write the numbers as JSON
 *
 * A relative `--json` path is resolved against the directory the command was typed in (`INIT_CWD`,
 * which pnpm sets; the working directory otherwise), as `--compare` of `pnpm size:each` is.
 *
 * Other processes only ever add time to a timing, so with `--runs N` the table shows the best
 * (lowest) number of the N runs; the header prints the load average, a busy machine inflates
 * everything. Needs the browsers of `pnpm test:e2e:install`. Numbers depend on the machine, so
 * compare runs of one machine, never machines; the header of the table says which machine this is.
 *
 * `GANTTLANE_E2E_PORT` picks the port of the playground (as for the e2e tests). The browser step
 * builds the playground and serves it itself, and never reuses a server it did not start: it
 * stops before anything else runs if something already answers on the port (a `vite preview` left
 * over from another checkout would be a stale build, measured without a word), and Playwright is
 * told not to reuse a server either (`GANTTLANE_E2E_NO_REUSE`, read by `playwright.config.ts`).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { cpus, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { spawnCommand } from './spawn-command.mjs';

const rootDir = resolve(import.meta.dirname, '..');
/** What a relative path of an option is relative to: where the command was typed. */
const baseDir = process.env.INIT_CWD ?? process.cwd();

const { values: args } = parseArgs({
  // `pnpm bench -- --only perf` passes the `--` through.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    project: { type: 'string', multiple: true, default: [] },
    only: { type: 'string', default: 'perf,browser,size' },
    'no-build': { type: 'boolean', default: false },
    runs: { type: 'string', default: '1' },
    json: { type: 'string' },
  },
});
const steps = new Set(args.only.split(',').map((step) => step.trim()));
for (const step of steps) {
  if (!['perf', 'browser', 'size'].includes(step)) {
    process.stderr.write(`bench: --only takes perf, browser and size, not ${step}\n`);
    process.exit(1);
  }
}
const projects = args.project.flatMap((value) => value.split(',')).filter(Boolean);
const runCount = Math.max(1, Math.floor(Number(args.runs)) || 1);

/** Frame budget at 60 Hz, in milliseconds. */
const FRAME_MS = 16.7;

// ---------------------------------------------------------------------------------------------
// Targets. Each row of the table is `{ label, nfr, target, … }` plus where its number comes from.
//
// `perf` rows read the annotation of a test of the performance suites: `test` matches the full
// name of the test (suite > test), `value` captures the number in the annotation (`scale`
// converts it to milliseconds). `browser` rows read a number of the benchmark page.

/** @type {{ label: string; nfr: string; target: number; test: RegExp; value: RegExp; scale?: number }[]} */
const PERF_ROWS = [
  {
    label: 'core layout, 1k tasks (rows + every bar)',
    nfr: 'NFR-PERF-1',
    target: 50,
    test: /rows and every bar of 1000 tasks/,
    value: /\b1000 rows in ([\d.]+) ms/,
  },
  {
    label: 'core layout, 10k tasks (rows + every bar)',
    nfr: 'NFR-PERF-1',
    target: 50,
    test: /rows and every bar of 10000 tasks/,
    value: /\b10000 rows in ([\d.]+) ms/,
  },
  {
    label: 'drag frame, core, 50 dependents, 1k tasks',
    nfr: 'NFR-PERF-1',
    target: 8,
    test: /dragging a task with 50 dependents .* \(1000 tasks\)/,
    value: /: ([\d.]+) ms per frame/,
  },
  {
    label: 'drag frame, core, 50 dependents, 10k tasks',
    nfr: 'NFR-PERF-1',
    target: 8,
    test: /dragging a task with 50 dependents .* \(10000 tasks\)/,
    value: /: ([\d.]+) ms per frame/,
  },
  {
    label: 'drag frame, core.send + all layers, 10k (DOM stub)',
    nfr: 'NFR-PERF-1',
    target: 8,
    test: /render path \(10000 generated tasks\) .*a drag frame/,
    value: /drag frame ([\d.]+) ms/,
  },
  {
    label: 'scroll frame, horizontal, 10k (DOM stub)',
    nfr: 'NFR-PERF-3',
    target: FRAME_MS,
    test: /render path \(10000 generated tasks\) .*a scroll frame, horizontal and vertical/,
    value: /horizontal scroll frame ([\d.]+) µs/,
    scale: 0.001,
  },
  {
    label: 'scroll frame, vertical, 10k (DOM stub)',
    nfr: 'NFR-PERF-3',
    target: FRAME_MS,
    test: /render path \(10000 generated tasks\) .*a scroll frame, horizontal and vertical/,
    value: /, vertical ([\d.]+) µs/,
    scale: 0.001,
  },
  {
    label: 'fling frame (everything redrawn), 10k (DOM stub)',
    nfr: 'NFR-PERF-3',
    target: FRAME_MS,
    test: /render path \(10000 generated tasks\) .*a fling past everything drawn/,
    value: /fling frame ([\d.]+) ms/,
  },
];

/** @type {{ label: string; nfr: string; target: number | null; unit?: string; bench: '1k' | '10k'; pick: (run: BrowserRun) => number }[]} */
const BROWSER_ROWS = [
  {
    label: 'core init (createGanttCore), 1k tasks',
    nfr: 'NFR-PERF-1',
    target: 50,
    bench: '1k',
    pick: (run) => run.coreMs,
  },
  {
    label: 'core init (createGanttCore), 10k tasks',
    nfr: 'NFR-PERF-1',
    target: null,
    bench: '10k',
    pick: (run) => run.coreMs,
  },
  {
    label: 'first paint, 1k tasks',
    nfr: 'NFR-PERF-1',
    target: 300,
    bench: '1k',
    pick: (run) => run.firstPaintMs,
  },
  {
    label: 'first paint, 10k tasks',
    nfr: 'NFR-PERF-3',
    target: null,
    bench: '10k',
    pick: (run) => run.firstPaintMs,
  },
  {
    label: 'scroll frame work, horizontal, 10k (p95)',
    nfr: 'NFR-PERF-3',
    target: FRAME_MS,
    bench: '10k',
    pick: (run) => run.workX[1],
  },
  {
    label: 'scroll frame work, vertical, 10k (p95)',
    nfr: 'NFR-PERF-3',
    target: FRAME_MS,
    bench: '10k',
    pick: (run) => run.workY[1],
  },
  {
    label: 'fling frame work, 10k (p95)',
    nfr: 'NFR-PERF-3',
    target: FRAME_MS,
    bench: '10k',
    pick: (run) => run.fling[5],
  },
  {
    // 60 fps is 16.7 ms a frame; the page measures `requestAnimationFrame` deltas, which jitter.
    label: 'scroll frame time, 10k (p95; worst of x, y, fling)',
    nfr: 'NFR-PERF-3',
    target: 20,
    bench: '10k',
    pick: (run) => Math.max(run.scrollX[1], run.scrollY[1], run.fling[1]),
  },
  {
    label: 'scroll frames over 50 ms, 10k (of 3 x 120; shown, not judged)',
    nfr: 'NFR-PERF-3',
    target: null,
    unit: 'frames',
    bench: '10k',
    pick: (run) => run.scrollX[3] + run.scrollY[3] + run.fling[3],
  },
  {
    label: 'drag, core.send per pointer move, 10k (mean)',
    nfr: 'NFR-PERF-1',
    target: 8,
    bench: '10k',
    pick: (run) => run.dragSend[0],
  },
  {
    label: 'drag, frame time, 10k (mean; 60 fps = 16.7)',
    nfr: 'NFR-PERF-1',
    target: 20,
    bench: '10k',
    pick: (run) => run.dragFrame[0],
  },
];

/**
 * @typedef {object} BrowserRun
 * @property {number} firstPaintMs
 * @property {number} coreMs
 * @property {number} mountMs
 * @property {number[]} scrollX mean, p95, max, long frames
 * @property {number[]} scrollY mean, p95, max, long frames
 * @property {number[]} workX mean, p95, max
 * @property {number[]} workY mean, p95, max
 * @property {number[]} fling mean, p95, max, long frames, work mean, work p95, work max
 * @property {number[]} dragSend mean, p95, max
 * @property {number[]} dragFrame mean, p95, max, long frames
 * @property {number[]} nodes after mount, max
 */

// ---------------------------------------------------------------------------------------------
// Running things.

/** Runs a command and collects its output (stdout and stderr together). */
function run(command, commandArgs, { env = {} } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCommand(command, commandArgs, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        output += chunk;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

const log = (message) => process.stderr.write(`bench: ${message}\n`);

const tmp = mkdtempSync(join(tmpdir(), 'ganttlane-bench-'));
/** Problems of the steps themselves, printed under the table. */
const problems = [];

// ---------------------------------------------------------------------------------------------
// Step 2: the performance suites.

/** @returns {Promise<{ annotations: { file: string; test: string; message: string }[]; issues: string[] }>} */
async function runPerfSuites() {
  log('performance suites (vitest, GANTTLANE_PERF=1) …');
  const out = join(tmp, 'perf.json');
  const result = await run(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      // One file at a time: timings taken next to other busy workers are noise.
      '--no-file-parallelism',
      '--reporter=dot',
      '--reporter=./scripts/bench-reporter.mjs',
    ],
    { env: { GANTTLANE_PERF: '1', GANTTLANE_BENCH_OUT: out } },
  );
  /** What went wrong in this run; a problem counts only when every run has it. */
  const issues = [];
  let report;
  try {
    report = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    issues.push(`the performance suites wrote no report:\n${result.output.slice(-2000)}`);
    return { annotations: [], issues };
  }
  for (const failed of report.failed) issues.push(`performance test failed: ${failed}`);
  for (const error of report.errors) issues.push(`vitest error: ${error}`);
  if (result.code !== 0 && report.failed.length === 0 && report.errors.length === 0) {
    issues.push(`vitest exited with ${result.code} without a failed test or error`);
  }
  return { annotations: report.annotations, issues };
}

/**
 * The number of the first annotation of the first test that matches the row, best of the runs. The
 * annotations of a test are those of its last attempt (`bench-reporter.mjs`), the one that decided
 * whether it passed.
 */
function perfValue(runs, row) {
  const found = [];
  for (const { annotations } of runs) {
    for (const { test, message } of annotations) {
      if (!row.test.test(test)) continue;
      const match = row.value.exec(message);
      if (match) {
        found.push(Number(match[1]) * (row.scale ?? 1));
        break;
      }
    }
  }
  return found.length === 0 ? undefined : Math.min(...found);
}

// ---------------------------------------------------------------------------------------------
// Step 3: the benchmark page in the browsers.

const NUMBER = '([0-9]+(?:\\.[0-9]+)?)';
const TRIPLE = `${NUMBER} / ${NUMBER} / ${NUMBER}`;

/**
 * Reads the `bench` annotation of `e2e/bench.spec.ts` (its `report()`):
 * `<browser> <1k|10k>: first paint … ms (core …, mount …); nodes … -> max …; scroll x m / p95 / max
 * ms, N long; scroll y …; work x m / p95 / max ms; work y …; fling m / p95 / max ms, N long, work
 * m / p95 / max ms; churn …; drag send m / p95 / max ms, drag frame m / p95 / max ms, N long; …`
 *
 * @returns {{ browser: string; bench: string; run: BrowserRun }}
 */
function parseBenchLine(line) {
  const head = /^(\w+) (1k|10k): /.exec(line);
  const grab = (label, pattern) => {
    const match = new RegExp(pattern).exec(line);
    if (!match) throw new Error(`no "${label}" in the bench annotation: ${line}`);
    return match.slice(1).map(Number);
  };
  if (!head) throw new Error(`unrecognised bench annotation: ${line}`);
  const [firstPaintMs, coreMs, mountMs] = grab(
    'first paint',
    `first paint ${NUMBER} ms \\(core ${NUMBER}, mount ${NUMBER}\\)`,
  );
  return {
    browser: head[1],
    bench: head[2],
    run: {
      firstPaintMs,
      coreMs,
      mountMs,
      nodes: grab('nodes', 'nodes (\\d+) -> max (\\d+)'),
      scrollX: grab('scroll x', `scroll x ${TRIPLE} ms, (\\d+) long`),
      scrollY: grab('scroll y', `scroll y ${TRIPLE} ms, (\\d+) long`),
      workX: grab('work x', `work x ${TRIPLE} ms`),
      workY: grab('work y', `work y ${TRIPLE} ms`),
      fling: grab('fling', `fling ${TRIPLE} ms, (\\d+) long, work ${TRIPLE} ms`),
      dragSend: grab('drag send', `drag send ${TRIPLE} ms`),
      dragFrame: grab('drag frame', `drag frame ${TRIPLE} ms, (\\d+) long`),
    },
  };
}

/** Annotations of type `bench` in the tree of the Playwright JSON report. */
function* benchAnnotations(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      for (const annotation of test.annotations) {
        if (annotation.type === 'bench') yield annotation.description;
      }
    }
  }
  for (const child of suite.suites ?? []) yield* benchAnnotations(child);
}

/** @returns {Promise<{ browsers: string[]; runs: Map<string, BrowserRun[]>; issues: string[] }>} */
async function runBrowserBench() {
  log(`benchmark page in ${projects.length > 0 ? projects.join(', ') : 'every browser'} …`);
  const out = join(tmp, 'playwright.json');
  const result = await run(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      'e2e/bench.spec.ts',
      '--reporter=json',
      '--workers=1',
      ...projects.map((project) => `--project=${project}`),
    ],
    // `GANTTLANE_E2E_NO_REUSE`: the server of the measurement is the one that was just built.
    { env: { PLAYWRIGHT_JSON_OUTPUT_FILE: out, GANTTLANE_E2E_NO_REUSE: '1' } },
  );
  /** @type {Map<string, BrowserRun[]>} keyed by `<browser> <size>`. */
  const runs = new Map();
  const browsers = [];
  /** What went wrong in this run; a problem counts only when every run has it. */
  const issues = [];
  let report;
  try {
    report = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    issues.push(`the benchmark page wrote no report:\n${result.output.slice(-2000)}`);
    return { browsers, runs, issues };
  }
  if (result.code !== 0) {
    const failed = [];
    const visit = (suite) => {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
          if (test.status === 'unexpected') failed.push(`${test.projectName}: ${spec.title}`);
        }
      }
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of report.suites) visit(suite);
    issues.push(
      `e2e/bench.spec.ts failed (${failed.join('; ') || `exit ${result.code}`}); ` +
        `run \`pnpm test:e2e e2e/bench.spec.ts\` for the details`,
    );
  }
  for (const suite of report.suites) {
    for (const description of benchAnnotations(suite)) {
      try {
        const { browser, bench, run: measured } = parseBenchLine(description);
        if (!browsers.includes(browser)) browsers.push(browser);
        const key = `${browser} ${bench}`;
        runs.set(key, [...(runs.get(key) ?? []), measured]);
      } catch (error) {
        // The format of the annotation in e2e/bench.spec.ts changed: say so, do not guess.
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { browsers, runs, issues };
}

/** The median of a list of numbers. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// ---------------------------------------------------------------------------------------------
// Step 4: sizes.

/** @returns {Promise<{ name: string; passed: boolean; size: number; sizeLimit: number }[]>} */
async function runSizes() {
  log('sizes (size-limit) …');
  const result = await run('pnpm', ['exec', 'size-limit', '--json']);
  try {
    return JSON.parse(result.output.slice(result.output.indexOf('[')));
  } catch {
    problems.push(`size-limit printed no JSON (is packages/*/dist built?):\n${result.output}`);
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Machine.

async function describeMachine(browserNames) {
  const cpu = cpus();
  const lines = [
    `${cpu[0]?.model ?? 'unknown CPU'}, ${cpu.length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`,
    `${platform()} ${release()}, node ${process.versions.node}`,
  ];
  if (browserNames.length > 0) {
    try {
      const playwright = await import('@playwright/test');
      const versions = [];
      for (const name of browserNames) {
        const browser = await playwright[name].launch();
        versions.push(`${name} ${browser.version()}`);
        await browser.close();
      }
      lines.push(`headless ${versions.join(', ')}`);
    } catch (error) {
      lines.push(`browser versions unknown (${error instanceof Error ? error.message : error})`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The table.

const ms = (value) => (value < 10 ? value.toFixed(2) : value.toFixed(1));
const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

/**
 * One line of the table. `status` is 'ok', 'FAIL' (target missed) or 'MISSING' (no number).
 * @typedef {{ label: string; nfr: string; value: string; target: string; status: string }} Row
 */

/**
 * Judges the numbers of a row (one per browser, or a single one) against its target: the worst
 * number must be under `target` (a target of 0 means "none at all"; `null`: no target, only shown).
 *
 * @param {{ label: string; nfr: string; target: number | null; unit?: string }} row
 * @param {(number | undefined)[]} values
 * @param {string[]} [names] a name for each value, shown in front of it
 * @returns {Row}
 */
function judge(row, values, names = []) {
  const unit = row.unit ?? 'ms';
  const format = (value) => (unit === 'ms' ? `${ms(value)} ms` : String(value));
  const limit = (value) => `< ${value}${unit === 'ms' ? ' ms' : ''}`;
  const target = row.target === null ? '-' : row.target === 0 ? 'none' : limit(row.target);
  const shown = values.map((value, index) => {
    const text = value === undefined ? 'n/a' : format(value);
    return names[index] === undefined ? text : `${names[index]} ${text}`;
  });
  const base = { label: row.label, nfr: row.nfr, value: shown.join(', '), target };
  if (values.length === 0 || values.some((value) => value === undefined || Number.isNaN(value))) {
    return { ...base, status: 'MISSING' };
  }
  const worst = Math.max(...values);
  const missed = row.target === null ? false : row.target === 0 ? worst > 0 : worst >= row.target;
  return { ...base, status: missed ? 'FAIL' : 'ok' };
}

/** The columns of a section as aligned text. */
function renderTable(rows) {
  const columns = ['label', 'nfr', 'value', 'target', 'status'];
  const heads = { label: 'metric', nfr: 'NFR', value: 'measured', target: 'target', status: '' };
  const width = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(heads[column].length, ...rows.map((row) => String(row[column]).length)),
    ]),
  );
  const line = (row) =>
    columns.map((column) => String(row[column]).padEnd(width[column])).join('  ');
  return [
    line(heads),
    columns.map((column) => '-'.repeat(width[column])).join('  '),
    ...rows.map(line),
  ]
    .map((text) => text.trimEnd())
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// Main.

/** Port of the playground, as in `playwright.config.ts`. */
const PORT = Number(process.env.GANTTLANE_E2E_PORT ?? 4173);

/** Whether something accepts connections on `localhost:port`, which is what Playwright would reuse. */
function isPortInUse(port) {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host: 'localhost' });
    const done = (inUse) => {
      socket.destroy();
      resolvePromise(inUse);
    };
    socket.once('connect', () => {
      done(true);
    });
    // Nothing there (ECONNREFUSED), or nowhere to connect to: nothing that could be reused.
    socket.once('error', () => {
      done(false);
    });
    // Something there that does not answer is in the way as well.
    socket.setTimeout(1000, () => {
      done(true);
    });
  });
}

// Before the build and the performance suites, which take minutes: the browser step would fail
// (or, worse, measure a stale server) only after them.
if (steps.has('browser') && (await isPortInUse(PORT))) {
  process.stderr.write(
    `bench: port ${PORT} is already in use. The benchmark builds the playground and serves it on ` +
      'that port itself; a server that is already there (a `vite preview` of this or another ' +
      'checkout, say) would be a stale build, and what it serves is not what is measured. Stop ' +
      `it, or pick a free port: GANTTLANE_E2E_PORT=${PORT + 1} pnpm bench\n`,
  );
  process.exit(1);
}

try {
  if (!args['no-build'] && steps.has('size')) {
    log('pnpm build …');
    const built = await run('pnpm', ['build']);
    if (built.code !== 0) {
      problems.push(`pnpm build failed:\n${built.output.slice(-2000)}`);
    }
  }

  const loadAtStart = loadavg()[0];
  const perfRuns = [];
  const browserRuns = [];
  for (let run = 1; run <= runCount; run++) {
    if (runCount > 1) log(`run ${run} of ${runCount}`);
    if (steps.has('perf')) perfRuns.push(await runPerfSuites());
    if (steps.has('browser')) browserRuns.push(await runBrowserBench());
  }
  // A timing test can fail on a busy machine in one run and pass in the next: only what every run
  // reports is a problem, as only the best number of the runs is in the table.
  for (const runs of [perfRuns, browserRuns]) {
    problems.push(
      ...(runs[0]?.issues ?? []).filter((issue) => runs.every((run) => run.issues.includes(issue))),
    );
  }
  const browsers = [...new Set(browserRuns.flatMap((run) => run.browsers))];
  const sizes = steps.has('size') ? await runSizes() : [];
  const machine = await describeMachine(browsers);
  const loadAtEnd = loadavg()[0];
  const cores = cpus().length;
  machine.push(
    `load average (1 min) ${loadAtStart.toFixed(1)} at the start, ${loadAtEnd.toFixed(1)} at the end, on ${cores} cores` +
      (Math.max(loadAtStart, loadAtEnd) > cores / 2
        ? ': the machine is busy, every timing below is inflated'
        : ''),
  );
  const best = runCount > 1 ? `, best of ${runCount} runs` : '';

  /** @type {{ title: string; rows: Row[] }[]} */
  const sections = [];

  if (steps.has('perf')) {
    sections.push({
      title: `Core and render path (Node, vitest; DOM stub = happy-dom, no layout or paint${best})`,
      rows: PERF_ROWS.map((row) => judge(row, [perfValue(perfRuns, row)])),
    });
  }

  if (steps.has('browser')) {
    const rows = BROWSER_ROWS.map((row) => {
      const perBrowser = browsers.map((name) => {
        // The median of the page's runs within one run of the spec, the best of those over the runs.
        const perRun = browserRuns.flatMap(({ runs }) => {
          const measured = runs.get(`${name} ${row.bench}`) ?? [];
          return measured.length === 0 ? [] : [median(measured.map(row.pick))];
        });
        return perRun.length === 0 ? undefined : Math.min(...perRun);
      });
      return judge(row, perBrowser, browsers);
    });
    sections.push({
      title: `Benchmark page (headless browsers, median of e2e/bench.spec.ts${best})`,
      rows,
    });
  }

  if (steps.has('size')) {
    sections.push({
      title: 'Sizes (min + gzip of packages/*/dist, size-limit; budgets in .size-limit.ts)',
      rows: sizes.map((entry) => ({
        label: entry.name,
        nfr: 'NFR-SIZE-1',
        value: kB(entry.size),
        target: `<= ${kB(entry.sizeLimit)}`,
        status: entry.passed ? 'ok' : 'FAIL',
      })),
    });
  }

  const out = [];
  out.push('ganttlane benchmark', ...machine.map((text) => `  ${text}`), '');
  for (const section of sections) out.push(section.title, renderTable(section.rows), '');
  const rows = sections.flatMap((section) => section.rows);
  const failing = rows.filter((row) => row.status !== 'ok');
  const distinctProblems = [...new Set(problems)];
  if (distinctProblems.length > 0) {
    out.push('Problems:', ...distinctProblems.map((text) => `  - ${text}`), '');
  }
  out.push(
    failing.length === 0 && distinctProblems.length === 0
      ? `All ${rows.length} targets met.`
      : `${failing.length} of ${rows.length} targets missed or missing, ${distinctProblems.length} problem(s).`,
  );
  process.stdout.write(`${out.join('\n')}\n`);

  if (args.json !== undefined) {
    writeFileSync(
      resolve(baseDir, args.json),
      `${JSON.stringify(
        {
          machine,
          sections,
          problems: distinctProblems,
          browser: browserRuns.map(({ runs }) => Object.fromEntries(runs)),
          perf: perfRuns.map(({ annotations }) => annotations),
          sizes,
        },
        null,
        2,
      )}\n`,
    );
  }
  process.exitCode = failing.length === 0 && distinctProblems.length === 0 ? 0 : 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
