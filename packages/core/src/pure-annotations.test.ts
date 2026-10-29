import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The guard behind the tree-shaking of single utilities (NFR-SIZE-1, plan step 6.2, ADR-019).
 *
 * The published package is one flat module, so a consumer's bundler keeps or drops its
 * module-level statements one by one. A call or `new` that is evaluated at import time stays in
 * every bundle unless it is marked `/* @__PURE__ *\/` (or built lazily). `tree-shaking.test.ts`
 * and the single-import entries of `.size-limit.ts` measure the bytes; they are a backstop, and
 * most missing marks go unnoticed by them (the call survives, but it is small, or the ceiling has
 * room). This test is the guard: it reads the sources with the TypeScript compiler API and fails
 * on every call or `new` expression that runs at import time without the mark.
 *
 * "Runs at import time" means: not inside a function body (declarations, expressions, arrows,
 * methods, accessors, constructors, and the parameter defaults of all of them), but anywhere else,
 * including `const` and `export const` initialisers, object and array literals, call arguments,
 * the `extends` clause, static fields and static blocks of a class, and the top-level statements.
 * A mark covers its own call only, so the calls in its arguments need their own.
 *
 * The one exception is valibot: its factories (`v.object(…)`, `v.pipe(…)`, …) are declared
 * `@__NO_SIDE_EFFECTS__`, which bundlers apply to every call site. Their arguments are still
 * checked.
 */

/** A call or `new` that runs at import time and is not marked. */
interface Finding {
  readonly line: number;
  readonly code: string;
}

/** `/* @__PURE__ *\/`, `/*#__PURE__*\/` and `/* #__PURE__ *\/`. */
const PURE_MARK = /^\/\*\s*[@#]__PURE__\s*\*\/$/;

/** The local names a file binds to valibot: `import * as v` (calls `v.x()`) and `import { x }`. */
function valibotBindings(file: ts.SourceFile): {
  readonly namespaces: ReadonlySet<string>;
  readonly named: ReadonlySet<string>;
} {
  const namespaces = new Set<string>();
  const named = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'valibot'
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else for (const element of bindings.elements) named.add(element.name.text);
  }
  return { namespaces, named };
}

/**
 * Whether a `/* @__PURE__ *\/` comment directly precedes the first token of `node`. The compiler
 * calls a comment on the line of the previous token (`= /* @__PURE__ *\/ new Map()`) a trailing
 * comment of that token, and one on a line of its own a leading comment of this one: bundlers
 * make no such difference, so both count.
 */
function hasPureMark(node: ts.Node, text: string): boolean {
  const start = node.getFullStart();
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, start) ?? []),
    ...(ts.getTrailingCommentRanges(text, start) ?? []),
  ];
  return ranges.some((range) => PURE_MARK.test(text.slice(range.pos, range.end)));
}

/** Every call and `new` that runs at import time without a mark, in source order. */
function findUnmarkedCalls(fileName: string, text: string): Finding[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const valibot = valibotBindings(file);
  const findings: Finding[] = [];

  const isValibotCall = (node: ts.CallExpression): boolean => {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return valibot.named.has(callee.text);
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      valibot.namespaces.has(callee.expression.text)
    );
  };

  const visit = (node: ts.Node): void => {
    // Runs when called, not when imported. This also covers type-only signatures.
    if (ts.isFunctionLike(node)) return;
    if (ts.isClassLike(node)) {
      visitClass(node);
      return;
    }
    if ((ts.isCallExpression(node) && !isValibotCall(node)) || ts.isNewExpression(node)) {
      if (!hasPureMark(node, text)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        findings.push({ line: line + 1, code: node.getText(file).split('\n')[0] ?? '' });
      }
    }
    ts.forEachChild(node, visit);
  };

  /** The parts of a class that run when the class is defined, not when it is used. */
  const visitClass = (node: ts.ClassLikeDeclaration): void => {
    for (const clause of node.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const type of clause.types) visit(type.expression);
    }
    for (const member of node.members) {
      if (member.name !== undefined && ts.isComputedPropertyName(member.name)) {
        visit(member.name.expression);
      }
      if (ts.isClassStaticBlockDeclaration(member)) {
        ts.forEachChild(member.body, visit);
      } else if (
        ts.isPropertyDeclaration(member) &&
        member.initializer !== undefined &&
        (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0
      ) {
        visit(member.initializer);
      }
    }
  };

  ts.forEachChild(file, visit);
  return findings;
}

/** Every non-test source of the package, as `[path relative to src, text]`. */
function readSources(): [string, string][] {
  const testPath = (expect.getState().testPath ?? '').replaceAll('\\', '/');
  const srcDir = testPath.slice(0, testPath.lastIndexOf('/'));
  return ts.sys
    .readDirectory(srcDir, ['.ts'])
    .map((path) => path.replaceAll('\\', '/'))
    .filter(
      (path) => !/\.(?:test|perf\.test|property\.test|scenarios\.test)\.ts$|\.d\.ts$/.test(path),
    )
    .toSorted()
    .map((path): [string, string] => [path.slice(srcDir.length + 1), ts.sys.readFile(path) ?? '']);
}

describe('module-level calls are marked pure', () => {
  it('NFR-SIZE-1: every call and `new` that runs at import time is marked /* @__PURE__ */', () => {
    const sources = readSources();
    // The scan reads the real tree: a wrong directory would pass vacuously.
    expect(sources.length).toBeGreaterThan(50);

    const unmarked = sources.flatMap(([path, text]) =>
      findUnmarkedCalls(path, text).map(({ line, code }) => `${path}:${String(line)}: ${code}`),
    );
    expect(unmarked).toEqual([]);
  });

  it('NFR-SIZE-1: stripping any single mark of the sources is caught (every mark is needed)', () => {
    // The test above would pass vacuously if the scan stopped seeing the calls (a changed
    // spelling of the mark, a parser change). So take each mark out in turn: the scan must then
    // find the call. A mark that no mutation can make fail sits where it does nothing (inside a
    // function body, on a valibot call, or twice on one call): remove it.
    let marks = 0;
    const redundant: string[] = [];
    for (const [path, text] of readSources()) {
      for (const match of text.matchAll(/\/\*\s*[@#]__PURE__\s*\*\//g)) {
        marks += 1;
        const without = text.slice(0, match.index) + text.slice(match.index + match[0].length);
        if (findUnmarkedCalls(path, without).length === 0) {
          const line = text.slice(0, match.index).split('\n').length;
          redundant.push(`${path}:${String(line)}`);
        }
      }
    }
    expect(marks).toBeGreaterThan(50);
    expect(redundant).toEqual([]);
  });
});

describe('the scan for module-level calls', () => {
  const valibotImport = "import * as v from 'valibot';\n";
  const cases: readonly {
    readonly name: string;
    readonly source: string;
    readonly found: number;
  }[] = [
    { name: 'a bare `new`', source: 'const a = new Map();', found: 1 },
    { name: 'a marked `new`', source: 'const a = /* @__PURE__ */ new Map();', found: 0 },
    { name: 'the `#` spelling of the mark', source: 'const a = /*#__PURE__*/ make();', found: 0 },
    { name: 'an exported bare call', source: 'export const a = make();', found: 1 },
    {
      name: 'a mark covers its own call, not the ones in its arguments',
      source: 'const a = /* @__PURE__ */ Object.freeze({ b: make() });',
      found: 1,
    },
    {
      name: 'a call in an object literal and in an array literal',
      source: 'const a = { b: make(), c: [make()] };',
      found: 2,
    },
    {
      name: 'a call chain: every call needs its mark',
      source: 'const a = [1].map((x) => x).filter(Boolean);',
      found: 2,
    },
    { name: 'a conditional initialiser', source: 'const a = cond ? make() : null;', found: 1 },
    { name: 'a call in a top-level block', source: 'if (cond) { work(); }', found: 1 },
    { name: 'an immediately invoked function', source: '(() => { work(); })();', found: 1 },
    {
      name: 'a mark on the statement is not a mark on the initialiser',
      source: '/* @__PURE__ */ const a = make();',
      found: 1,
    },
    { name: 'a mark after the call', source: 'const a = make() /* @__PURE__ */;', found: 1 },
    {
      name: 'a mark before a parenthesis',
      source: 'const a = /* @__PURE__ */ (make());',
      found: 1,
    },
    { name: 'an arrow body', source: 'const a = () => make();', found: 0 },
    {
      name: 'a parameter default',
      source: 'const a = (x = make()) => x;\nfunction b(y = make()) { return y; }',
      found: 0,
    },
    { name: 'a function body', source: 'export function a() { return make(); }', found: 0 },
    {
      name: 'object methods and accessors',
      source: 'const a = { m() { return make(); }, get g() { return make(); } };',
      found: 0,
    },
    {
      name: 'a class: only what runs at definition counts',
      source:
        'class A extends make() { static s = make(); static { work(); } y = make(); ' +
        '[make()] = 1; constructor() { super(); make(); } m() { return make(); } }',
      // `extends make()`, the static field, the static block, the computed key.
      found: 4,
    },
    {
      name: 'types, imports and re-exports',
      source:
        "import { a } from './a';\nexport type T = ReturnType<typeof a>;\nexport { b } from './b';",
      found: 0,
    },
    {
      name: 'a valibot schema',
      source: `${valibotImport}const s = v.object({ a: v.string() });`,
      found: 0,
    },
    {
      name: 'a valibot schema, named imports',
      source: "import { object, string } from 'valibot';\nconst s = object({ a: string() });",
      found: 0,
    },
    {
      name: 'a valibot schema with an unmarked call inside',
      source: `${valibotImport}const s = v.pipe(v.string(), v.check(make()));`,
      found: 1,
    },
    {
      name: 'a method of something that is not valibot',
      source: `${valibotImport}const s = w.object({});`,
      found: 1,
    },
  ];

  for (const { name, source, found } of cases) {
    it(`NFR-SIZE-1: ${name}: ${String(found)} unmarked`, () => {
      expect(findUnmarkedCalls('case.ts', source)).toHaveLength(found);
    });
  }

  it('NFR-SIZE-1: reports the line and the code of a finding', () => {
    expect(findUnmarkedCalls('case.ts', 'const a = 1;\nconst b = make(a);')).toEqual([
      { line: 2, code: 'make(a)' },
    ]);
  });
});
