import { describe, expect, it } from 'vitest';

import { buildExample, parseFrontMatter } from './meta';

/** A README whose front matter is `lines`. */
const readme = (...lines: string[]): string => `---\n${lines.join('\n')}\n---\n\n# Title\n`;

/** The value `parseFrontMatter` reads for `title: <value>`. */
const title = (value: string): unknown => parseFrontMatter(readme(`title: ${value}`)).data.title;

describe('NFR-DX-1: the front matter of an example', () => {
  it('NFR-DX-1: reads plain strings, numbers and booleans, and leaves the body alone', () => {
    const { data, body } = parseFrontMatter(
      readme('title: Basic chart', 'order: 10', 'height: 1.5', 'showsIssues: true', 'x: false'),
    );

    expect(data).toEqual({
      title: 'Basic chart',
      order: 10,
      height: 1.5,
      showsIssues: true,
      x: false,
    });
    expect(body).toBe('\n# Title\n');
  });

  it('NFR-DX-1: a text without a front matter has an empty one', () => {
    expect(parseFrontMatter('# Title\n')).toEqual({ data: {}, body: '# Title\n' });
  });

  it('NFR-DX-1: a quoted value may hold what a plain one may not', () => {
    expect(title('"Scroll: today and more"')).toBe('Scroll: today and more');
    expect(title("'Colon: and # hash'")).toBe('Colon: and # hash');
    expect(title("'It''s here'")).toBe("It's here");
    expect(title('"Say \\"hi\\" and \\\\"')).toBe('Say "hi" and \\');
    expect(title('"true"')).toBe('true');
    expect(title("'null'")).toBe('null');
    expect(title('"- dash"')).toBe('- dash');
  });

  it.each([
    'a#b', // a # without a space before it is part of the text, in YAML too
    'a:b',
    'https://example.com/a',
    "It's here",
    'Say "hi"',
    'tRUE', // only true, True and TRUE are booleans in YAML
    'Ukrainian ґ',
  ])('NFR-DX-1: %s is a plain string', (value) => {
    expect(title(value)).toBe(value);
  });

  it.each([
    ['": " in the value', 'Scroll: today'],
    ['":" at the end', 'Scroll:'],
    ['" #" (a comment in YAML)', 'Scroll #today'],
    ['a dash to start with', '- today'],
    ['a dash to start with', '-today'],
    ['a question mark to start with', '? today'],
    ['a bracket to start with', '[today]'],
    ['a brace to start with', '{today}'],
    ['an asterisk to start with', '*today'],
    ['an ampersand to start with', '&today'],
    ['an exclamation mark to start with', '!today'],
    ['a pipe to start with', '| today'],
    ['a greater-than sign to start with', '> today'],
    ['a percent sign to start with', '%today'],
    ['an at sign to start with', '@today'],
    ['a backtick to start with', '`today'],
    ['a hash to start with', '#today'],
    ['a comma to start with', ',today'],
    ['null, which YAML reads as null', 'null'],
    ['a tilde, which YAML reads as null', '~'],
    ['an exponent number', '1e3'],
    ['a hexadecimal number', '0x10'],
    ['a number with no integer part', '.5'],
    ['an unclosed quote', '"today'],
    ['text after the closing quote', '"today" # more'],
    ['a stray quote inside single quotes', "'to'day'"],
    ['an escape other than \\" and \\\\', '"to\\nday"'],
    ['no value', ''],
  ])('NFR-DX-1: rejects a value with %s: %s', (_what, value) => {
    expect(() => parseFrontMatter(readme(`title: ${value}`))).toThrow(/Front matter line|empty/);
  });

  it('NFR-DX-1: rejects a key with no space after the colon, a repeated key and a continued value', () => {
    expect(() => parseFrontMatter(readme('title:Basic'))).toThrow('Unreadable front matter line');
    expect(() => parseFrontMatter(readme('title: A', 'title: B'))).toThrow('set twice');
    expect(() => parseFrontMatter(readme('title: A', '  continued'))).toThrow('Unreadable');
    expect(() => parseFrontMatter(readme('- item'))).toThrow('Unreadable');
  });

  it('NFR-DX-1: the error says which line to quote, and buildExample names the README', () => {
    const text = readme(
      'title: Scrolling: today',
      'description: One sentence.',
      'category: Time',
      'order: 1',
    );

    expect(() => parseFrontMatter(text)).toThrow(
      /title: Scrolling: today".*cannot contain ": ".*quote the value/,
    );
    expect(() => buildExample('scrolling', text, ['data.ts'])).toThrow(
      /^examples\/scrolling\/README\.md: Front matter line/,
    );
  });

  it('NFR-DX-1: buildExample reads the fields, with the default height', () => {
    const example = buildExample(
      'basic',
      readme(
        'title: "Basic: a chart"',
        'description: One sentence.',
        'category: Basics',
        'order: 10',
      ),
      ['vanilla.ts', 'data.ts', 'react.tsx', 'options.ts'],
    );

    expect(example).toMatchObject({
      slug: 'basic',
      title: 'Basic: a chart',
      description: 'One sentence.',
      category: 'Basics',
      order: 10,
      height: 480,
      showsIssues: false,
      files: ['data.ts', 'options.ts', 'vanilla.ts', 'react.tsx'],
    });
  });

  it('NFR-DX-1: buildExample asks for the text fields and the order', () => {
    expect(() =>
      buildExample('x', readme('description: D', 'category: C', 'order: 1'), []),
    ).toThrow('needs a text `title`');
    expect(() =>
      buildExample('x', readme('title: T', 'description: D', 'category: C'), []),
    ).toThrow('needs a number `order`');
  });
});
