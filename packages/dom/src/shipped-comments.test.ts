import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The comments of the library sources ship: TSDoc goes into the `.d.ts` files and the API
 * reference, and the source maps embed the sources. So they must not refer to documents that are
 * not public: requirement and decision IDs, the design documents and their sections, plan steps,
 * priority labels, and the history of the code the library replaced.
 *
 * This scans every source file of the three packages that is not a test. It lives in one place
 * because `@ganttlane/core` may not use Node built-ins, not even in its tests.
 */

const PACKAGES = ['core', 'dom', 'react'] as const;
const PACKAGES_DIR = `${import.meta.dirname}/../..`;

/** What a source file must not contain, with the reason shown in a failure. */
const FORBIDDEN: readonly (readonly [reason: string, pattern: RegExp])[] = [
  ['requirement ID (FR-…, NFR-…)', /\bN?FR-[A-Z]/],
  ['decision ID (ADR-…)', /\bADR-\d/],
  ['decision question (Q12, …)', /\bQ\d{1,3}\b/],
  [
    'internal document (docs/…, api.md, architecture.md, decisions.md, requirements.md, PLAN.md)',
    /\bdocs\/|\b(?:api|architecture|decisions|requirements|PLAN)\.md\b/,
  ],
  ['section of a document (§3.1)', /§/],
  [
    'plan step or phase (plan step 3.9, step 4.7, phase 2)',
    /\bplan steps?\b|\b[Ss]teps? \d+\.\d+|\b[Pp]hase \d/,
  ],
  ['priority label (P0, P1, P2)', /\bP[0-2]\b/],
  ['defect ID of the code this one replaced (D4, I11)', /\b[DI]\d{1,2}\b/],
  ['"the fork" of the code this one replaced', /\bfork(?:'s)?\b/i],
  ['a legacy name or behaviour that only explains history', /\blegacy\b/i],
];

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|css)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Every source file under `dir` that is not a test, as a path. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

/** The lines of `text` that match a forbidden pattern, as `line: reason: the line`. */
function findReferences(text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, index) => {
    for (const [reason, pattern] of FORBIDDEN) {
      if (pattern.test(line)) found.push(`${index + 1}: ${reason}: ${line.trim()}`);
    }
  });
  return found;
}

describe('the comments of the library sources', () => {
  it.each([
    ['(FR-CAL-4)', 'requirement ID'],
    ['an NFR-PERF-1 budget', 'requirement ID'],
    ['see ADR-015', 'decision ID'],
    ['(`docs/decisions.md` Q12)', 'decision question'],
    ['`docs/api.md` §3', 'internal document'],
    ['described in architecture.md', 'internal document'],
    ['the layers (§3.1)', 'section of a document'],
    ['done in plan step 3.9', 'plan step'],
    ['step 4.7 resolves it', 'plan step'],
    ['Reserved for P1', 'priority label'],
    ['(fork bugs D4 / D5)', 'defect ID'],
    ["the fork's `day_width`", '"the fork"'],
    ['(legacy `frozen`)', 'legacy'],
  ])('the scan finds a reference such as %s', (line, reason) => {
    expect(findReferences(line).join('\n')).toContain(reason);
  });

  it('the scan leaves ordinary comments alone', () => {
    for (const line of [
      'The state of the plan after a change set: every task with a bar.',
      'A step of 15 min; the third step of the drag (step 3).',
      'Migration: frappe-gantt `view_mode` is now `viewMode`.',
      'Keeps the I18N strings and the #d45 colour, see {@link GanttStrings}.',
      'Planned: not available yet.',
    ]) {
      expect(findReferences(line)).toEqual([]);
    }
  });

  describe.each(PACKAGES)('@ganttlane/%s', (name) => {
    const root = `${PACKAGES_DIR}/${name}/src`;
    const files = sourceFiles(root);

    it('has the sources the scan is meant to check', () => {
      expect(files.length).toBeGreaterThan(10);
      expect(files).toContain(`${root}/index.ts`);
    });

    it('has no non-test source file that refers to a document that is not public', () => {
      const references = files.flatMap((file) =>
        findReferences(readFileSync(file, 'utf8')).map(
          (found) => `packages/${name}/src${file.slice(root.length)}:${found}`,
        ),
      );
      expect(references).toEqual([]);
    });
  });
});
