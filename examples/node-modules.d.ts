/**
 * The little Node API `discover.ts`, `resolve.ts` and the test use, declared here so that the
 * examples are type-checked without `@types/node`: with it, `setTimeout` is Node's and returns a
 * `Timeout`, which the browser code of the packages (the examples import their sources) does not
 * accept. The same arrangement as `packages/dom/src/node-fs.d.ts`.
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

interface ImportMeta {
  /** The directory of the current module (Node, and Vitest's runner). */
  readonly dirname: string;
}
