import { existsSync, readFileSync } from 'node:fs';

import type { Link, Task } from '@ganttlane/core';
import { createGantt, type GanttOptions } from '@ganttlane/dom';
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readExamples } from './discover';
import { groupByCategory } from './meta';

/**
 * Every folder of `examples/` is an example (`README.md`, `data.ts`, `options.ts`, `vanilla.ts`,
 * `react.tsx`: see `examples/README.md`), and this file tests all of them, so that a new example
 * is covered by being added. Both the folders and their modules are found at run time: the folders
 * on disk (`readExamples`), the modules by an `import()` of their path. (`import.meta.glob` would
 * expand the list of files while the test file is transformed, and Vitest caches that result: a
 * folder added afterwards would be reported as missing until the cache is deleted.)
 */
const EXAMPLES_DIR = import.meta.dirname;

type Mount = (container: HTMLElement) => () => void;
interface ExampleModules {
  'vanilla.ts': { mount: Mount };
  'react.tsx': { default: ComponentType };
  'data.ts': { tasks: Task[]; links: Link[] };
  'options.ts': { options: Partial<GanttOptions> };
}

/**
 * A module of an example folder, imported when a test needs it: a broken one fails its own test
 * only.
 *
 * @param slug - The folder.
 * @param file - The file in it.
 * @returns The module.
 */
async function load<File extends keyof ExampleModules>(
  slug: string,
  file: File,
): Promise<ExampleModules[File]> {
  return (await import(
    /* @vite-ignore */ `${EXAMPLES_DIR}/${slug}/${file}`
  )) as ExampleModules[File];
}

/**
 * happy-dom does no layout, so the chart's scroller would be 0 by 0 and draw no bar. The page is
 * given the scroller's height too: a chart of automatic height (`layout.height: 'auto'`) is as tall
 * as its rows and asks the page, or the ancestor that scrolls, how much of them to draw.
 */
function stubScrollerSize(width: number, height: number): void {
  const isScroller = (element: Element): boolean => element.classList.contains('gantt__scroller');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) || this === document.documentElement ? height : 0;
  });
}

/** A path relative to a folder, resolved (no `URL`: happy-dom replaces it). */
function resolveFrom(folder: string, relative: string): string {
  const parts = folder.split('/');
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

const bars = (container: HTMLElement): number => container.querySelectorAll('.gantt__bar').length;

let container: HTMLElement;

beforeEach(() => {
  stubScrollerSize(1200, 500);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const examples = readExamples(EXAMPLES_DIR);
const index = readFileSync(`${EXAMPLES_DIR}/README.md`, 'utf8');

describe('NFR-DX-1: the examples', () => {
  it('NFR-DX-1: there are examples, and examples/README.md links each of them', () => {
    expect(examples.length).toBeGreaterThan(0);
    for (const { slug } of examples) {
      expect(index, `${slug} is not linked from examples/README.md`).toContain(
        `](${slug}/README.md)`,
      );
    }
  });

  it('NFR-DX-1: examples/README.md groups and orders the examples as the gallery of the site does', () => {
    // The gallery and the sidebar group by `category` and sort by `order`; the README is read by
    // people, with a table per group (`### Group`, then a row per example linking `slug/README.md`).
    const listed: { category: string; slugs: string[] }[] = [];
    for (const line of index.split('\n')) {
      if (line.startsWith('## ')) break;
      const heading = /^### (.+)$/.exec(line)?.[1];
      if (heading !== undefined) listed.push({ category: heading, slugs: [] });
      const slug = /^\| \[[^\]]+\]\(([^/)]+)\/README\.md\)/.exec(line)?.[1];
      if (slug !== undefined) listed.at(-1)?.slugs.push(slug);
    }

    expect(listed).toEqual(
      groupByCategory(examples).map(({ category, examples: group }) => ({
        category,
        slugs: group.map(({ slug }) => slug),
      })),
    );
  });
});

describe.each(examples)('NFR-DX-1: example $slug', (example) => {
  const { slug, files } = example;
  const hasVanilla = files.includes('vanilla.ts');
  const hasReact = files.includes('react.tsx');

  it('NFR-DX-1: has the standard files, and the README says which flavour is missing', () => {
    expect(files).toContain('data.ts');
    expect(files).toContain('options.ts');
    expect(hasVanilla || hasReact, 'needs vanilla.ts or react.tsx').toBe(true);
    if (!hasVanilla) expect(example.body).toMatch(/react[- ]only/i);
    if (!hasReact) expect(example.body).toMatch(/vanilla[- ]only/i);
    // The format of the README: a title and the options table.
    expect(example.body).toMatch(/^# \S/m);
    expect(example.body).toMatch(/^## Options$/m);
  });

  it('NFR-DX-1: the links of the README point at files that exist', () => {
    const links = [...example.body.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '');
    for (const href of links) {
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const [path = ''] = href.split('#');
      expect(
        existsSync(resolveFrom(`${EXAMPLES_DIR}/${slug}`, path)),
        `${slug}/README.md links to ${href}`,
      ).toBe(true);
    }
  });

  it.skipIf(example.showsIssues)('NFR-DX-1: its data and options give no issues', async () => {
    const { tasks, links } = await load(slug, 'data.ts');
    const { options } = await load(slug, 'options.ts');

    const gantt = createGantt(container, { tasks, links, ...options });
    const issues = gantt.getIssues();

    expect(issues.data).toEqual([]);
    expect(issues.options).toEqual([]);
    gantt.destroy();
  });

  if (hasVanilla) {
    it('NFR-DX-1: mounting vanilla.ts draws bars, and its clean-up leaves the container empty', async () => {
      const { mount } = await load(slug, 'vanilla.ts');

      const cleanUp = mount(container);

      await vi.waitFor(() => {
        expect(bars(container)).toBeGreaterThan(0);
      });
      cleanUp();
      expect(container.childNodes).toHaveLength(0);
    });
  }

  if (hasReact) {
    it('NFR-DX-1: rendering react.tsx draws bars, and unmounting leaves the container empty', async () => {
      const { default: Example } = await load(slug, 'react.tsx');

      const root = createRoot(container);
      await act(async () => {
        root.render(<Example />);
        await Promise.resolve();
      });

      await vi.waitFor(() => {
        expect(bars(container)).toBeGreaterThan(0);
      });
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      expect(container.childNodes).toHaveLength(0);
    });
  }
});
