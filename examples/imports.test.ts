import { describe, expect, it } from 'vitest';

import { importedModules } from './imports';

describe('NFR-DX-1: the modules an example imports', () => {
  it('NFR-DX-1: lists side-effect imports and imports with bindings, in source order', () => {
    const source = `import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type GanttOptions } from '@ganttlane/dom';
import type { Link, Task } from '@ganttlane/core';
import * as helpers from "./helpers";
import fallback from './fallback';

export const x = 1;
`;

    expect(importedModules(source)).toEqual([
      '@ganttlane/dom/styles.css',
      './styles.css',
      '@ganttlane/dom',
      '@ganttlane/core',
      './helpers',
      './fallback',
    ]);
  });

  it('NFR-DX-1: reads an import that spans lines, and an indented one', () => {
    const source = `import {
  a,
  b,
} from './data';
  import './late.css'
`;

    expect(importedModules(source)).toEqual(['./data', './late.css']);
  });

  it('NFR-DX-1: ignores a statement in a comment, in a string, and a name that starts with import', () => {
    const source = `// No \`import '@ganttlane/dom/styles.css'\`: the chart is styled by this sheet alone.
/* import './in-a-block-comment.css'; */
const text = "import './in-a-string.css'";
const imported = importedModules(text);
export const importedAt = 'x';
`;

    expect(importedModules(source)).toEqual([]);
  });
});
