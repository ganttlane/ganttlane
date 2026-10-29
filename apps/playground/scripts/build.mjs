/**
 * The builds of the playground (`pnpm --filter playground build`), as one script that runs the
 * same on every platform: the variables that choose a build (`NODE_ENV`, `GANTTLANE_REACT_18`) are
 * set here, for the Vite build that follows, and not as `NAME=value command` prefixes in
 * `package.json`, which only a POSIX shell understands.
 *
 *   node scripts/build.mjs [step …]
 *
 * With no step it makes all of them, in this order (the e2e specs, `playwright.config.ts`, run the
 * React pages on every build, see `e2e/react-support.ts`):
 *
 * - `production`: the pages, as an application ships them (`dist/`).
 * - `development`: the same with React's development bundles (`/dev/`), where StrictMode runs
 *   effects twice and React reports its warnings.
 * - `server`: the server entry of the server-rendered React page (`dist/ssr/`).
 * - `react-18-client`, `react-18-server`: the development build and the server entry with React
 *   18.3 in place of 19 (`/react-18/`, `dist/ssr-react-18/`).
 */
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const SERVER_ENTRY = 'src/react-ssr-server.tsx';

/**
 * The steps: what `vite build` is given (the same as the flags it had) and the environment of the
 * build. `NODE_ENV` is always set, because Vite sets it for the process on the first build and a
 * later one would otherwise inherit it.
 */
const STEPS = {
  production: { env: { NODE_ENV: 'production' }, config: {} },
  development: {
    env: { NODE_ENV: 'development' },
    config: {
      base: '/dev/',
      build: { outDir: 'dist/dev', emptyOutDir: false, minify: false },
    },
  },
  server: {
    env: { NODE_ENV: 'production' },
    config: { build: { ssr: SERVER_ENTRY, outDir: 'dist/ssr', emptyOutDir: false } },
  },
  'react-18-client': {
    env: { NODE_ENV: 'development', GANTTLANE_REACT_18: '1' },
    config: {
      base: '/react-18/',
      build: { outDir: 'dist/react-18', emptyOutDir: false, minify: false },
    },
  },
  'react-18-server': {
    env: { NODE_ENV: 'production', GANTTLANE_REACT_18: '1' },
    config: {
      build: { ssr: SERVER_ENTRY, outDir: 'dist/ssr-react-18', emptyOutDir: false },
    },
  },
};

/**
 * Runs one build with its environment, and puts the variables back as they were.
 *
 * @param {keyof typeof STEPS} name - The step.
 */
async function run(name) {
  const { env, config } = STEPS[name];
  const before = {
    NODE_ENV: process.env.NODE_ENV,
    GANTTLANE_REACT_18: process.env.GANTTLANE_REACT_18,
  };
  Reflect.deleteProperty(process.env, 'GANTTLANE_REACT_18');
  Object.assign(process.env, env);
  try {
    // The config file is read again by every build, so it sees the variables of this one.
    await build({ root, ...config });
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

const asked = process.argv.slice(2);
const unknown = asked.filter((name) => !Object.hasOwn(STEPS, name));
if (unknown.length > 0) {
  process.stderr.write(
    `build: unknown step ${unknown.join(', ')}; the steps are ${Object.keys(STEPS).join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  try {
    for (const name of asked.length > 0 ? asked : Object.keys(STEPS)) {
      await run(/** @type {keyof typeof STEPS} */ (name));
    }
  } catch (error) {
    process.stderr.write(
      `build: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
