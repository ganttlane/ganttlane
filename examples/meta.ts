/**
 * What the examples say about themselves: the front matter of each README, and the files of each
 * folder. Plain functions over text, with no Node API, so that everything that reads the examples
 * (the test, the site's config, its pages) shares one reader. `discover.ts` is the Node side: it
 * reads the folders from disk.
 */

/** What the front matter of an example's `README.md` says, plus what is in its folder. */
export interface ExampleMeta {
  /** The name of the folder: the id of the example and its URL on the site. */
  readonly slug: string;
  /** The name of the example (the title of its page). */
  readonly title: string;
  /** One sentence: what the example shows. */
  readonly description: string;
  /** The group on the site (`Basics`, `Data`, …). */
  readonly category: string;
  /** The position of the example (in its category, and of the category among the others). */
  readonly order: number;
  /** The height, in px, of the live demo on the site; the page does not jump while it loads. */
  readonly height: number;
  /** Whether the example reports issues on purpose (the test then does not expect none). */
  readonly showsIssues: boolean;
  /** The files of the folder but the README, the standard ones first. */
  readonly files: readonly string[];
  /** The text of the README below its front matter. */
  readonly body: string;
}

type Scalar = string | number | boolean;

/** The files every example has, in the order the site shows them; any other file follows. */
export const STANDARD_FILES: readonly string[] = [
  'data.ts',
  'options.ts',
  'vanilla.ts',
  'react.tsx',
];

const DEFAULT_HEIGHT = 480;

/**
 * Splits a Markdown file into its front matter and its body. The front matter is the flat
 * `key: value` block between two `---` lines at the top; a value is a string (quotes optional),
 * a number, or `true` / `false`. Nothing else is YAML here on purpose: a config file reads it,
 * and a config file cannot wait for a content collection.
 *
 * @param text - The Markdown file.
 * @returns The values, and the text below the block.
 */
export function parseFrontMatter(text: string): { data: Record<string, Scalar>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (match?.[1] === undefined) return { data: {}, body: text };
  const data: Record<string, Scalar> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair?.[1] === undefined || pair[2] === undefined) {
      throw new Error(`Unreadable front matter line: "${line}"`);
    }
    data[pair[1]] = scalar(pair[2].trim());
  }
  return { data, body: text.slice(match[0].length) };
}

function scalar(raw: string): Scalar {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const quoted = /^(['"])(.*)\1$/.exec(raw);
  return quoted?.[2] ?? raw;
}

function text(data: Record<string, Scalar>, key: string, slug: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`examples/${slug}/README.md: the front matter needs a text \`${key}\`.`);
  }
  return value;
}

function fileRank(name: string): number {
  const rank = STANDARD_FILES.indexOf(name);
  return rank === -1 ? STANDARD_FILES.length : rank;
}

/**
 * Orders the files of an example folder: the standard ones first, then the others by name.
 *
 * @param names - The file names, the README excluded.
 * @returns A new, sorted list.
 */
export function sortFiles(names: readonly string[]): string[] {
  return [...names].sort((a, b) => fileRank(a) - fileRank(b) || a.localeCompare(b));
}

/**
 * Makes an example from what its folder holds.
 *
 * @param slug - The name of the folder.
 * @param readme - The text of its `README.md`.
 * @param files - The names of the files in the folder, the README excluded.
 * @returns The example.
 * @throws When the front matter is incomplete.
 */
export function buildExample(slug: string, readme: string, files: readonly string[]): ExampleMeta {
  const { data, body } = parseFrontMatter(readme);
  const order = data.order;
  if (typeof order !== 'number') {
    throw new Error(`examples/${slug}/README.md: the front matter needs a number \`order\`.`);
  }
  const height = data.height;
  return {
    slug,
    title: text(data, 'title', slug),
    description: text(data, 'description', slug),
    category: text(data, 'category', slug),
    order,
    height: typeof height === 'number' ? height : DEFAULT_HEIGHT,
    showsIssues: data.showsIssues === true,
    files: sortFiles(files),
    body,
  };
}

/**
 * Orders examples by category (the lowest `order` of a category places it), then by `order` and
 * title, so that the examples of a category are next to each other.
 *
 * @param examples - The examples.
 * @returns A new, sorted list.
 */
export function sortExamples<T extends Pick<ExampleMeta, 'category' | 'order' | 'title'>>(
  examples: readonly T[],
): T[] {
  const rank = new Map<string, number>();
  for (const example of examples) {
    rank.set(example.category, Math.min(rank.get(example.category) ?? Infinity, example.order));
  }
  return [...examples].sort(
    (a, b) =>
      (rank.get(a.category) ?? 0) - (rank.get(b.category) ?? 0) ||
      a.category.localeCompare(b.category) ||
      a.order - b.order ||
      a.title.localeCompare(b.title),
  );
}

/**
 * The examples grouped by category, in the order they come in (sort them first).
 *
 * @param examples - The examples.
 * @returns The categories with their examples.
 */
export function groupByCategory<T extends Pick<ExampleMeta, 'category'>>(
  examples: readonly T[],
): { category: string; examples: T[] }[] {
  const groups: { category: string; examples: T[] }[] = [];
  for (const example of examples) {
    const last = groups.at(-1);
    if (last?.category === example.category) last.examples.push(example);
    else groups.push({ category: example.category, examples: [example] });
  }
  return groups;
}
