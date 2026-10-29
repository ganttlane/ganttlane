import type { IConfiguration, IForbiddenRuleType } from 'dependency-cruiser';

/**
 * Architecture guard (NFR-ARCH-1). Run with `pnpm lint:deps`.
 *
 * Paths are relative to the repo root. Workspace packages resolve to their `src` through the
 * `@ganttlane/source` export condition, the same way Vite and Vitest see them.
 */

const TEST_FILE = '\\.test\\.tsx?$';
/** Test-only helper folders (`packages/<name>/src/testing/`): test code that is not a `*.test.ts`. */
const TESTING_DIR = '^packages/[^/]+/src/testing/';
const TEST_CODE = [TEST_FILE, TESTING_DIR];
const REACT_MODULES = 'react|react-dom|react-aria|react-aria-components|@ganttlane/react';
const RENDERER_MODULES = `${REACT_MODULES}|@ganttlane/dom`;

/** Matches a module both when resolved (inside node_modules) and when it could not be resolved. */
const npmModule = (names: string): string[] => [
  `(^|/)node_modules/(${names})/`,
  `^(${names})(/|$)`,
];

/**
 * Direct dependencies between core modules, from docs/architecture.md §3.1 (`a ← b` means
 * `b` depends on `a`). A module may import its transitive dependencies; anything else, including
 * a module missing from this map, is a violation. Update the doc and this map together.
 *
 * `shared` (base types and helpers: Issue, Result, assertNever, DEV, runtime checks) depends on
 * nothing and is an implicit dependency of every module (`IMPLICIT_CORE_DEPS`), so it is not
 * repeated below.
 */
const coreModuleDeps: Record<string, readonly string[]> = {
  shared: [],
  time: [],
  calendar: ['time'],
  model: ['time', 'calendar', 'progress'],
  scale: ['calendar'],
  hierarchy: ['model'],
  schedule: ['calendar', 'model'],
  progress: ['calendar'],
  layout: ['scale', 'hierarchy', 'schedule'],
  viewport: ['layout'],
  interaction: ['scale', 'schedule', 'progress', 'layout', 'viewport'],
  store: [
    'time',
    'calendar',
    'model',
    'scale',
    'hierarchy',
    'schedule',
    'progress',
    'layout',
    'viewport',
    'interaction',
  ],
  events: ['store'],
  // The `index` layer of §3.1: `createGanttCore` composes every module; no module imports it.
  facade: ['events'],
};

/** Modules every core module may import without listing them in `coreModuleDeps`. */
const IMPLICIT_CORE_DEPS: readonly string[] = ['shared'];

function transitiveDeps(name: string, seen = new Set<string>()): Set<string> {
  for (const dep of coreModuleDeps[name] ?? []) {
    if (!seen.has(dep)) {
      seen.add(dep);
      transitiveDeps(dep, seen);
    }
  }
  return seen;
}

const coreLayerRules: IForbiddenRuleType[] = Object.keys(coreModuleDeps).map((name) => {
  const allowed = [...new Set([name, ...IMPLICIT_CORE_DEPS, ...transitiveDeps(name)])];
  return {
    name: `core-layer-${name}`,
    comment: `docs/architecture.md §3.1: core/${name} may depend only on ${allowed.join(', ')}.`,
    severity: 'error',
    from: { path: `^packages/core/src/${name}/` },
    to: {
      path: '^packages/core/src/[^/]+/',
      pathNot: `^packages/core/src/(${allowed.join('|')})/`,
    },
  };
});

const config: IConfiguration = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'NFR-ARCH-1: no circular dependencies between modules.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-not-to-renderers',
      comment: 'NFR-ARCH-1: @ganttlane/core must not depend on @ganttlane/dom, React or apps.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: ['^packages/(dom|react)/', '^apps/', ...npmModule(RENDERER_MODULES)] },
    },
    {
      name: 'dom-not-to-react',
      comment: 'NFR-ARCH-1: @ganttlane/dom must not depend on @ganttlane/react or React.',
      severity: 'error',
      from: { path: '^packages/dom/' },
      to: { path: ['^packages/react/', ...npmModule(REACT_MODULES)] },
    },
    {
      name: 'dom-layers-isolated',
      comment:
        'Plan step 4.1: renderer layers are built in parallel and must not depend on each other or on renderer internals (renderer, scheduler, skeleton, scroll, registry). A layer folder may import itself, the layer contract (`layers/types`), `shared/` and `dom-utils/`; its tests may also use `testing/`.',
      severity: 'error',
      from: { path: '^packages/dom/src/layers/([^/]+)/' },
      to: {
        path: '^packages/dom/src/',
        pathNot: [
          '^packages/dom/src/layers/$1/',
          '^packages/dom/src/layers/types\\.ts$',
          '^packages/dom/src/(shared|dom-utils)/',
          '^packages/dom/src/testing/',
        ],
      },
    },
    {
      name: 'dom-layers-only-core',
      comment:
        'Plan step 4.1: a renderer layer imports no package but @ganttlane/core (its tests may use the test tooling).',
      severity: 'error',
      from: { path: '^packages/dom/src/layers/', pathNot: TEST_FILE },
      to: {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-peer',
          'npm-optional',
          'npm-no-pkg',
          'npm-unknown',
        ],
        pathNot: npmModule('@ganttlane/core'),
      },
    },
    {
      name: 'dom-utils-standalone',
      comment:
        '@ganttlane/dom/dom-utils is shared with @ganttlane/react: it knows nothing of the vanilla renderer, its layers or helpers (its tests may use `testing/`).',
      severity: 'error',
      from: { path: '^packages/dom/src/dom-utils/', pathNot: TEST_FILE },
      to: { path: '^packages/dom/src/', pathNot: '^packages/dom/src/dom-utils/' },
    },
    {
      name: 'dom-shared-leaf',
      comment:
        "Plan step 4.1: the layers' shared helpers (`shared/`) build on dom-utils only, never on the renderer or the layers.",
      severity: 'error',
      from: { path: '^packages/dom/src/shared/', pathNot: TEST_FILE },
      to: { path: '^packages/dom/src/', pathNot: '^packages/dom/src/(shared|dom-utils)/' },
    },
    {
      name: 'dom-testing-only-from-tests',
      comment: 'Test helpers (`packages/dom/src/testing/`) are imported by test files only.',
      severity: 'error',
      from: { pathNot: TEST_CODE },
      to: { path: '^packages/dom/src/testing/' },
    },
    {
      name: 'packages-not-to-apps',
      comment: 'Library packages must not depend on apps (playground, docs).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'packages-fixtures-only-in-tests',
      comment:
        'Test data never ships: packages may import @ganttlane/fixtures (or anything in internal/) only from test files.',
      severity: 'error',
      from: { path: '^packages/', pathNot: TEST_FILE },
      to: { path: ['^internal/', ...npmModule('@ganttlane/fixtures')] },
    },
    {
      name: 'fixtures-no-runtime-code',
      comment:
        '@ganttlane/fixtures is plain data: it may import core types (`import type`), never runtime code from packages or apps.',
      severity: 'error',
      from: { path: '^internal/fixtures/' },
      to: {
        path: ['^packages/', '^apps/', ...npmModule(`${RENDERER_MODULES}|@ganttlane/core`)],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'fixtures-not-to-renderers',
      comment:
        '@ganttlane/fixtures stays renderer-agnostic: not even types from @ganttlane/dom, React or apps.',
      severity: 'error',
      from: { path: '^internal/fixtures/' },
      to: { path: ['^packages/(dom|react)/', '^apps/', ...npmModule(RENDERER_MODULES)] },
    },
    {
      name: 'no-relative-cross-package',
      comment:
        'Workspace packages talk through their package name and `exports`, not relative paths.',
      severity: 'error',
      from: { path: '^(packages|apps|internal)/([^/]+)/' },
      to: { dependencyTypes: ['local'], path: '^(packages|apps|internal)/', pathNot: '^$1/$2/' },
    },
    {
      name: 'core-module-via-index',
      comment:
        'NFR-ARCH-1: a core module is entered only through its index.ts (its public API) from outside its folder.',
      severity: 'error',
      from: { path: '^packages/core/src/([^/]+)/' },
      to: {
        path: '^packages/core/src/[^/]+/.',
        pathNot: ['^packages/core/src/$1/', '^packages/core/src/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'core-facade-via-index',
      comment: 'NFR-ARCH-1: files at the core root (the facade) use modules only through index.ts.',
      severity: 'error',
      from: { path: '^packages/core/src/[^/]+$' },
      to: { path: '^packages/core/src/[^/]+/.', pathNot: '^packages/core/src/[^/]+/index\\.ts$' },
    },
    ...coreLayerRules,
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve (a missing or undeclared dependency under pnpm).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      comment:
        'Sources import only packages declared in their own package.json (root tooling deps are reachable but not declared).',
      severity: 'error',
      from: { pathNot: TEST_CODE },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Published code must not import devDependencies (peer + dev, e.g. react, is fine).',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/', pathNot: TEST_CODE },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only', 'npm-peer'] },
    },
    {
      name: 'not-to-test',
      comment: 'Production code must not import test files.',
      severity: 'error',
      from: { pathNot: TEST_FILE },
      to: { path: TEST_FILE },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(packages|apps)/[^/]+/dist/' },
    // See type-only imports too: `import type` from React in core is still a violation.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@ganttlane/source', 'import', 'types', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};

export default config;
