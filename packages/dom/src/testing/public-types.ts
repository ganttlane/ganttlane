import ts from 'typescript';

/**
 * The type names of the workspace packages (`core`, `dom`, `react`) that the declarations of one of
 * them name, and the names its entry exports: what `index.types.test.ts` compares to prove that an
 * application which installed only that package can import every type its API uses (ADR-026).
 */
export interface PublicTypes {
  /**
   * Every type a declaration reachable from the package's own exports names, as `"package:Name"`
   * (`Name` is how that package's entry exports it) with one chain of types that leads to it, for
   * the failure message. Type parameters, library and `node_modules` types are not in it.
   */
  readonly named: ReadonlyMap<string, string>;
  /** The names the package's entry exports (types and values). */
  readonly exported: ReadonlySet<string>;
  /**
   * Interfaces and type aliases of the workspace that the walk met and that their own package
   * does not export, as `"package:Name"` with a chain: a type nobody can import, in a public
   * signature.
   */
  readonly unexported: ReadonlyMap<string, string>;
}

const SOURCE = /\/packages\/(core|dom|react)\/src\//;
const normalize = (path: string): string => path.replaceAll('\\', '/');

/**
 * Walks the declarations of a package's public API with the TypeScript compiler and collects the
 * names of the workspace types they mention.
 *
 * - **Roots:** what the entry exports and declares itself (not what it re-exports from another
 *   package): functions by their signatures, constants by their annotation, interfaces and type
 *   aliases whole.
 * - **Edges:** every type reference in a declaration reached (`Pick<X, …>`, `Awaitable<Y>`,
 *   `X['key']`, `typeof z`), followed into the declaration of the type it names, wherever in the
 *   workspace that is. `X['key']` follows that one member of `X`, not all of it. It is the
 *   names written in the declarations that count, not what the compiler resolves them to: a
 *   union that includes another alias (`A | B`, where `A = C | D`) names `A`.
 * - It over-approximates a little (`Omit<X, 'k'>` still reaches the type of `k`), which only
 *   asks for a re-export that costs nothing.
 *
 * @param packageDir - Path of the package (`…/packages/dom`), absolute or with `..` in it.
 * @returns The names reached and the names the package exports.
 */
export function publicTypesOf(packageDir: string): PublicTypes {
  const root = normalize(ts.sys.resolvePath(packageDir));
  const own = /\/packages\/(core|dom|react)$/.exec(root)?.[1];
  if (own === undefined) throw new Error(`not a package of the workspace: ${packageDir}`);

  const workspace = root.slice(0, root.lastIndexOf('/packages/'));
  const configPath = `${root}/tsconfig.json`;
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (!config) throw new Error(`cannot read ${configPath}`);
  const program = ts.createProgram({
    rootNames: [`${root}/src/index.ts`],
    options: { ...config.options, noEmit: true },
  });
  const checker = program.getTypeChecker();

  const resolve = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const packageOf = (symbol: ts.Symbol): string | undefined => {
    const file = symbol.declarations?.[0]?.getSourceFile().fileName;
    return file === undefined || file.includes('/node_modules/') || /\.test\.tsx?$/.test(file)
      ? undefined
      : SOURCE.exec(normalize(file))?.[1];
  };

  /** What each package's entry exports, by symbol: the names a type can be imported by. */
  const entries = new Map<string, Map<ts.Symbol, string[]>>();
  const exportsOf = (name: string): Map<ts.Symbol, string[]> => {
    let found = entries.get(name);
    if (!found) {
      found = new Map();
      const file = program.getSourceFile(`${workspace}/packages/${name}/src/index.ts`);
      const module = file && checker.getSymbolAtLocation(file);
      for (const exported of module ? checker.getExportsOfModule(module) : []) {
        const target = resolve(exported);
        found.set(target, [...(found.get(target) ?? []), exported.name]);
      }
      entries.set(name, found);
    }
    return found;
  };

  const named = new Map<string, string>();
  const unexported = new Map<string, string>();
  const seen = new Set<ts.Node>();
  const queue: [node: ts.Node, via: string][] = [];
  const enqueue = (node: ts.Node | undefined, via: string): void => {
    if (node && !seen.has(node)) {
      seen.add(node);
      queue.push([node, via]);
    }
  };

  /** The parts of a declaration that are its public type: a function's body is not. */
  const typeParts = (declaration: ts.Declaration): (ts.Node | undefined)[] => {
    if (ts.isFunctionLike(declaration)) {
      return [...(declaration.typeParameters ?? []), ...declaration.parameters, declaration.type];
    }
    if (
      ts.isVariableDeclaration(declaration) ||
      ts.isPropertySignature(declaration) ||
      ts.isPropertyDeclaration(declaration)
    ) {
      return [declaration.type];
    }
    return ts.isClassDeclaration(declaration) ? [] : [declaration];
  };

  const reference = (entity: ts.Node, via: string): void => {
    const found = checker.getSymbolAtLocation(entity);
    if (!found) return;
    const symbol = resolve(found);
    const owner = packageOf(symbol);
    if (owner === undefined || symbol.flags & ts.SymbolFlags.TypeParameter) return;
    const here = `${via} -> ${symbol.name}`;
    const names = exportsOf(owner).get(symbol);
    if (symbol.flags & ts.SymbolFlags.Type) {
      const exportName = names?.[0];
      if (exportName !== undefined) named.set(`${owner}:${exportName}`, here);
      else if (symbol.name !== '__type') unexported.set(`${owner}:${symbol.name}`, here);
    }
    for (const declaration of symbol.declarations ?? []) {
      for (const part of typeParts(declaration)) enqueue(part, here);
    }
  };

  const visit = (node: ts.Node, via: string): void => {
    if (ts.isTypeReferenceNode(node)) reference(node.typeName, via);
    else if (ts.isExpressionWithTypeArguments(node)) reference(node.expression, via);
    else if (ts.isTypeQueryNode(node)) reference(node.exprName, via);
    else if (ts.isImportTypeNode(node) && node.qualifier) reference(node.qualifier, via);
    else if (
      ts.isIndexedAccessTypeNode(node) &&
      ts.isLiteralTypeNode(node.indexType) &&
      ts.isStringLiteral(node.indexType.literal)
    ) {
      // `GanttCore<TData>['addLink']`: that member of the type, not the whole of it.
      const key = node.indexType.literal.text;
      const member = checker.getTypeFromTypeNode(node.objectType).getProperty(key);
      for (const declaration of member?.declarations ?? []) {
        for (const part of typeParts(declaration)) enqueue(part, `${via}['${key}']`);
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, via);
    });
  };

  const entry = program.getSourceFile(`${root}/src/index.ts`);
  const module = entry && checker.getSymbolAtLocation(entry);
  if (!module) throw new Error(`no module at ${root}/src/index.ts`);
  const exported = new Set<string>();
  for (const symbol of checker.getExportsOfModule(module)) {
    exported.add(symbol.name);
    const target = resolve(symbol);
    if (packageOf(target) !== own) continue;
    for (const declaration of target.declarations ?? []) {
      for (const part of typeParts(declaration)) enqueue(part, symbol.name);
    }
  }
  for (let next = queue.shift(); next; next = queue.shift()) visit(...next);

  return { named, exported, unexported };
}
