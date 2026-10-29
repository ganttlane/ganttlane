import { version } from 'react';
import { version as domVersion } from 'react-dom';
import { describe, expect, it } from 'vitest';

/**
 * The React this Vitest project loads: `vitest.config.ts` defines it (`19` for the `react` project,
 * `18` for `react-18`, which aliases `react` and `react-dom` to `internal/react-18`).
 */
declare const __REACT_MAJOR__: number;

describe('the React matrix (NFR-COMPAT-1)', () => {
  it('NFR-COMPAT-1: each project runs the React it is named for, `react` and `react-dom` alike', () => {
    // Guards the aliases: if they stopped applying, both projects would run the same React and
    // the matrix would still look green.
    const major = String(__REACT_MAJOR__);
    expect(version.split('.')[0]).toBe(major);
    expect(domVersion.split('.')[0]).toBe(major);
    expect(domVersion).toBe(version);
    if (__REACT_MAJOR__ === 18) expect(version).toMatch(/^18\.3\./);
  });
});
