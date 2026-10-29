import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

const REPOSITORY = 'https://github.com/ganttlane/ganttlane';

/** The page of the guides the migration guide is written to, relative to the site's `src/`. */
const OUTPUT = 'content/docs/guides/migration.md';

/** The migration guide of the repository, relative to this file: the one source of the page. */
const SOURCE = '../../../MIGRATION.md';

/**
 * The text of the page: `MIGRATION.md`, made for the site. The Markdown stays what it is (the
 * guide is written to be read on GitHub as well) but for four things:
 *
 * - the first `# ` heading (the title) goes: Starlight renders the title from the front matter, and
 *   so does the `## Contents` list: the page has a table of contents of its own, beside it;
 * - every other heading moves one level down (`# Part 1` is a `##`, `## Tasks` a `###`), so that the
 *   table of contents of the page shows the two parts with their sections below them, and the
 *   outline stays well formed under the page's `h1`;
 * - the links to a file of the repository (`packages/dom/README.md#height`) become links to it on
 *   GitHub; links to a heading of the page (`#tasks`) and absolute URLs stay as they are;
 * - front matter: the title and the description of the page.
 *
 * Fenced code blocks are left alone: a `# comment` in a shell snippet is not a heading.
 *
 * @param markdown - The text of `MIGRATION.md`.
 * @returns The text of the page.
 */
export function migrationPageMarkdown(markdown: string): string {
  let inFence = false;
  let titleSeen = false;
  let inContents = false;
  const lines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^#{1,5}\s/.test(line);
    if (heading) inContents = line === '## Contents';
    if (inContents) continue;
    if (!heading) {
      lines.push(line);
    } else if (!titleSeen && line.startsWith('# ')) {
      titleSeen = true;
    } else {
      lines.push(`#${line}`);
    }
  }
  const body = lines
    .join('\n')
    .replace(/^\n+/, '')
    // `](path/to/file.md#anchor)`: a path inside the repository, as opposed to `#anchor` and URLs.
    .replace(/\]\((?![a-z][a-z0-9+.-]*:|\/\/|#)([^)\s]+)\)/gi, (_match, href: string) => {
      const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
      const path = href.replace(/#.*$/, '').replace(/^\.?\//, '');
      return `](${REPOSITORY}/${/\.[a-z0-9]+$/i.test(path) ? 'blob' : 'tree'}/main/${path}${hash})`;
    });
  return `---
title: Migration
description: 'Moving from frappe-gantt, or from a modified fork of it: what each option, event, method and class became, and where the behaviour differs.'
editUrl: ${REPOSITORY}/edit/main/MIGRATION.md
---

<!-- Generated from MIGRATION.md at the root of the repository each time Astro starts (apps/site/integrations/migration-page.ts). Edit that file, not this one. -->

${body}`;
}

/**
 * Writes the Migration page of the guides from `MIGRATION.md`, so that the guide has one source:
 * the file in the repository, which GitHub renders too. The page is generated each time Astro
 * starts (`astro dev`, `astro build`, `astro sync`) and is not committed.
 *
 * @returns The integration.
 */
export function migrationPage(): AstroIntegration {
  return {
    name: 'migration-page',
    hooks: {
      'astro:config:setup': ({ config, addWatchFile }) => {
        const source = fileURLToPath(new URL(SOURCE, import.meta.url));
        const output = new URL(OUTPUT, config.srcDir);
        mkdirSync(new URL('.', output), { recursive: true });
        writeFileSync(output, migrationPageMarkdown(readFileSync(source, 'utf8')));
        addWatchFile(source);
      },
    },
  };
}
