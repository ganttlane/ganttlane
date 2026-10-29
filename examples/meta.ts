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
 * `key: value` block between two `---` lines at the top, and the site reads the same block as
 * **real YAML** (Astro's content collections). A config file cannot wait for a collection, so this
 * is a small reader of its own, and it is strict on purpose: it accepts only what every YAML
 * parser reads the same way, and throws, naming the line, for the rest. A front matter that passes
 * here therefore also builds the site.
 *
 * - A key is written once, starts with a letter, and is followed by `:` and a space.
 * - A value is a number (`10`, `-5`, `1.5`), `true` or `false`, a quoted string or a plain string.
 *   There are no lists, maps, multi-line values or comments.
 * - A **plain string** has no `: ` and no ` #` in it, does not end with `:`, does not start with
 *   one of the YAML indicators ``- ? : , [ ] { } # & * ! | > % @ ` `` and does not read as another
 *   type (`null`, `~`, `1e3`, `0x10`, `.inf`). Quote it when it does.
 * - A **quoted string** is `'…'` (a `'` inside is written `''`) or `"…"` (a `"` or a `\` inside is
 *   written `\"` or `\\`; there is no other escape). Nothing may follow the closing quote.
 *
 * @param text - The Markdown file.
 * @param source - What the error messages call the file (`examples/basic/README.md`).
 * @returns The values, and the text below the block.
 * @throws When a line is outside that subset.
 */
export function parseFrontMatter(
  text: string,
  source?: string,
): { data: Record<string, Scalar>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (match?.[1] === undefined) return { data: {}, body: text };
  const at = source === undefined ? '' : `${source}: `;
  const data: Record<string, Scalar> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const pair = /^([A-Za-z][\w-]*):(?: +(.*))?$/.exec(line);
    if (pair?.[1] === undefined) throw new Error(`${at}Unreadable front matter line: "${line}"`);
    if (Object.hasOwn(data, pair[1])) {
      throw new Error(`${at}Front matter line "${line}": the key \`${pair[1]}\` is set twice.`);
    }
    const parsed = scalar((pair[2] ?? '').trim());
    if ('problem' in parsed) {
      throw new Error(`${at}Front matter line "${line}": ${parsed.problem}`);
    }
    data[pair[1]] = parsed.value;
  }
  return { data, body: text.slice(match[0].length) };
}

/** A number as the front matter writes one; other forms YAML reads as numbers must be quoted. */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
/** What YAML reads as `null` or as a number other than {@link PLAIN_NUMBER}. */
const YAML_OTHER_TYPE =
  /^(?:~|[Nn]ull|NULL|[-+]?(?:\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|0o[0-7]+|0x[\da-fA-F]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
/** The characters that start something else than a plain string in YAML. */
const YAML_INDICATOR = /^[-?:,[\]{}#&*!|>%@`]/;

/** A value of the front matter, or why `raw` cannot be one. */
type Parsed = { readonly value: Scalar } | { readonly problem: string };

function scalar(raw: string): Parsed {
  if (raw === '') return { problem: 'the value is empty; write one, or leave the key out.' };
  if (/^(?:true|True|TRUE|false|False|FALSE)$/.test(raw)) {
    return { value: raw.toLowerCase() === 'true' };
  }
  if (PLAIN_NUMBER.test(raw)) return { value: Number(raw) };
  if (raw.startsWith("'")) {
    const single = /^'((?:[^']|'')*)'$/.exec(raw);
    if (single?.[1] === undefined) {
      return { problem: "a '…' string ends at its last ' (write ' as '')." };
    }
    return { value: single[1].replaceAll("''", "'") };
  }
  if (raw.startsWith('"')) {
    const double = /^"((?:[^"\\]|\\["\\])*)"$/.exec(raw);
    if (double?.[1] === undefined) {
      return { problem: 'a "…" string ends at its last " (write " as \\" and \\ as \\\\).' };
    }
    return { value: double[1].replaceAll(/\\(["\\])/g, '$1') };
  }
  const problem = plainProblem(raw);
  if (problem !== undefined) return { problem: `${problem}; quote the value ('…' or "…").` };
  return { value: raw };
}

/** Why `raw` cannot stand unquoted, or `undefined`. */
function plainProblem(raw: string): string | undefined {
  if (raw.includes(': ')) return 'a plain value cannot contain ": "';
  if (raw.endsWith(':')) return 'a plain value cannot end with ":"';
  if (raw.includes(' #')) return 'a plain value cannot contain " #" (it starts a comment)';
  if (YAML_INDICATOR.test(raw)) {
    return `a plain value cannot start with "${raw.slice(0, 1)}" (a YAML indicator)`;
  }
  if (YAML_OTHER_TYPE.test(raw)) return 'YAML reads this plain value as a number or null';
  return undefined;
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
 * @throws When the front matter is incomplete, or outside the subset of YAML that
 * {@link parseFrontMatter} accepts.
 */
export function buildExample(slug: string, readme: string, files: readonly string[]): ExampleMeta {
  const { data, body } = parseFrontMatter(readme, `examples/${slug}/README.md`);
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
