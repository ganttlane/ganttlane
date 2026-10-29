import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { buildExample, type ExampleMeta, sortExamples } from './meta';

/**
 * Every example: each folder of `examples/` that has a README. Folders that start with `_` or `.`,
 * and `node_modules`, are not examples.
 *
 * @param dir - The absolute path of the `examples/` folder, with no trailing slash.
 * @returns The examples, sorted as `sortExamples` does.
 * @throws When a folder has no README, or a README's front matter is incomplete.
 */
export function readExamples(dir: string): ExampleMeta[] {
  const slugs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !/^[._]/.test(name) && name !== 'node_modules');
  return sortExamples(
    slugs.map((slug) => {
      const readme = `${dir}/${slug}/README.md`;
      if (!existsSync(readme)) throw new Error(`examples/${slug}/README.md is missing.`);
      const files = readdirSync(`${dir}/${slug}`).filter(
        (name) => name !== 'README.md' && !name.startsWith('.'),
      );
      return buildExample(slug, readFileSync(readme, 'utf8'), files);
    }),
  );
}
