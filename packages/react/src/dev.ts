/**
 * The one global of Node this package reads, declared here (not through `@types/node`, which the
 * package does not use): bundlers replace `process.env.NODE_ENV`, and {@link isDev} guards the
 * read for when nothing does. Local to this module; no binding is emitted.
 */
declare const process: { readonly env: { readonly NODE_ENV?: string | undefined } };

/**
 * Whether this is a development build: what React and the libraries around it ask of
 * `process.env.NODE_ENV`, which every bundler replaces with a constant (so a production build drops
 * the warnings that use this). Where nothing replaces it and there is no `process` (native ES
 * modules in a browser) it is `false`: no warnings, and no crash.
 *
 * @returns `true` outside production.
 */
export function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * Writes a development warning to the console. Callers keep their own "once" bookkeeping, per
 * chart, not per page.
 *
 * @param message - The text, without the package prefix.
 */
export function warn(message: string): void {
  if (isDev()) console.warn(`[@ganttlane/react] ${message}`);
}
