/**
 * Starting `pnpm` and `npm` from the scripts of this folder (`bench.mjs`, `check-pack.mjs`) on
 * every platform. On Windows they are `pnpm.cmd` and `npm.cmd`, which Node starts only through a
 * shell (a plain `spawn('pnpm', …)` fails with ENOENT, and with EINVAL for the `.cmd` name). The
 * shell gets one command line and not an argument list, which Node 24 deprecates (DEP0190), so
 * the line is built here, with the few arguments that need it quoted.
 */
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

/** An argument as it is written in a Windows command line (`cmd.exe`). */
const quote = (argument) =>
  /^[\w@%+=:,./\\-]+$/.test(argument) ? argument : `"${argument.replaceAll('"', '\\"')}"`;

/**
 * The arguments of `spawn` / `spawnSync` for a command: as they are on POSIX, one shell command
 * line on Windows.
 */
function launch(command, args, options) {
  return process.platform === 'win32'
    ? [[command, ...args].map(quote).join(' '), { ...options, shell: true }]
    : [command, args, options];
}

/** `child_process.spawn` that finds `pnpm` and `npm` on Windows too. */
export const spawnCommand = (command, args, options = {}) =>
  spawn(...launch(command, args, options));

/** `child_process.spawnSync` that finds `pnpm` and `npm` on Windows too. */
export const spawnCommandSync = (command, args, options = {}) =>
  spawnSync(...launch(command, args, options));
