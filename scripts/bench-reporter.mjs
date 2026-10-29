/**
 * A Vitest reporter for `scripts/bench.mjs` (plan step 6.2): it keeps the annotations of the
 * performance suites (`await annotate('…')` in `*.perf.test.ts`) next to the name of their test,
 * and writes them as JSON to the file in `GANTTLANE_BENCH_OUT`, so that the benchmark command can
 * read the measured numbers instead of scraping the terminal. Not meant to be used on its own:
 *
 *   GANTTLANE_PERF=1 GANTTLANE_BENCH_OUT=perf.json vitest run --reporter=./scripts/bench-reporter.mjs
 *
 * The performance run retries a test that fails (`retry: 2` in `vitest.config.ts`: a busy machine
 * can blow a wall-clock budget once), and Vitest keeps the annotations of every attempt on the
 * test. Only those of the last attempt are written: that is the attempt that decided the test's
 * result, so a test that passed on its retry never shows the number of the attempt that failed.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';

export default class BenchReporter {
  /** @type {{ file: string; test: string; message: string; attempt: number }[]} */
  #annotations = [];

  onInit(vitest) {
    this.root = vitest.config.root;
  }

  onTestCaseAnnotate(testCase, annotation) {
    this.#annotations.push({
      file: testCase.module.moduleId.replace(`${this.root}/`, ''),
      test: testCase.fullName,
      message: annotation.message,
      // 0 for the first attempt, 1 for the first retry, … (live while the test runs).
      attempt: testCase.diagnostic()?.retryCount ?? 0,
    });
  }

  onTestRunEnd(testModules, errors) {
    const failed = [];
    for (const testModule of testModules) {
      for (const test of testModule.children.allTests()) {
        if (test.result().state === 'failed')
          failed.push(`${testModule.moduleId}: ${test.fullName}`);
      }
    }
    const out = process.env.GANTTLANE_BENCH_OUT;
    if (out === undefined) return;
    writeFileSync(
      out,
      `${JSON.stringify(
        { annotations: this.#lastAttempts(), failed, errors: errors.map((error) => error.message) },
        null,
        2,
      )}\n`,
    );
  }

  /** The annotations of the last attempt of every test, in the order they were made. */
  #lastAttempts() {
    /** @type {Map<string, number>} the highest attempt seen, by test */
    const last = new Map();
    const key = ({ file, test }) => `${file}\0${test}`;
    for (const annotation of this.#annotations) {
      last.set(key(annotation), Math.max(last.get(key(annotation)) ?? 0, annotation.attempt));
    }
    return this.#annotations
      .filter((annotation) => annotation.attempt === last.get(key(annotation)))
      .map(({ file, test, message }) => ({ file, test, message }));
  }
}
