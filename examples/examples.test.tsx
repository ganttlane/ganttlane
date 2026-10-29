import { existsSync, readFileSync } from 'node:fs';

import type { Link, Task } from '@ganttlane/core';
import { createGantt, type GanttOptions } from '@ganttlane/dom';
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readExamples } from './discover';

/**
 * Every folder of `examples/` is an example (`README.md`, `data.ts`, `options.ts`, `vanilla.ts`,
 * `react.tsx`: see `examples/README.md`), and this file tests all of them, so that a new example
 * is covered by being added. The folders are found on disk; their modules by `import.meta.glob`.
 */
const EXAMPLES_DIR = import.meta.dirname;

type Mount = (container: HTMLElement) => () => void;
const vanillaModules = import.meta.glob<{ mount: Mount }>('./*/vanilla.ts');
const reactModules = import.meta.glob<{ default: ComponentType }>('./*/react.tsx');
const dataModules = import.meta.glob<{ tasks: Task[]; links: Link[] }>('./*/data.ts');
const optionModules = import.meta.glob<{ options: Partial<GanttOptions> }>('./*/options.ts');

/** The module an example's file is, loaded on demand: a broken one fails its own test only. */
async function load<T>(modules: Record<string, () => Promise<T>>, path: string): Promise<T> {
  const loader = modules[path];
  if (!loader) throw new Error(`${path} is missing`);
  return loader();
}

/** happy-dom does no layout, so the chart's scroller would be 0 by 0 and draw no bar. */
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
    return isScroller(this) ? height : 0;
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
    const { tasks, links } = await load(dataModules, `./${slug}/data.ts`);
    const { options } = await load(optionModules, `./${slug}/options.ts`);

    const gantt = createGantt(container, { tasks, links, ...options });
    const issues = gantt.getIssues();

    expect(issues.data).toEqual([]);
    expect(issues.options).toEqual([]);
    gantt.destroy();
  });

  if (hasVanilla) {
    it('NFR-DX-1: mounting vanilla.ts draws bars, and its clean-up leaves the container empty', async () => {
      const { mount } = await load(vanillaModules, `./${slug}/vanilla.ts`);

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
      const { default: Example } = await load(reactModules, `./${slug}/react.tsx`);

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
