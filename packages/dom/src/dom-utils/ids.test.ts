import { describe, expect, it } from 'vitest';

import { allocateIdPrefix, prefixedId } from './index';

describe('allocateIdPrefix', () => {
  it('FR-API-4: gives every instance of a document its own prefix', () => {
    const first = allocateIdPrefix(document);
    const second = allocateIdPrefix(document);
    const third = allocateIdPrefix(document);

    expect(new Set([first, second, third]).size).toBe(3);
    for (const prefix of [first, second, third]) expect(prefix).toMatch(/^gantt-\d+$/);
  });

  it('counts per document: another document starts over and shares nothing', () => {
    const other = document.implementation.createHTMLDocument('other');
    const here = allocateIdPrefix(document);
    const there = allocateIdPrefix(other);
    const thereAgain = allocateIdPrefix(other);

    expect(there).toBe('gantt-1');
    expect(thereAgain).toBe('gantt-2');
    expect(here).not.toBe(thereAgain);
  });

  it('skips a prefix whose id is already taken in the document (a second copy of the library)', () => {
    const doc = document.implementation.createHTMLDocument('copies');
    const taken = doc.createElement('div');
    taken.id = 'gantt-1';
    doc.body.append(taken);

    expect(allocateIdPrefix(doc)).toBe('gantt-2');
  });

  it('takes another base', () => {
    const doc = document.implementation.createHTMLDocument('base');
    expect(allocateIdPrefix(doc, 'chart')).toBe('chart-1');
  });
});

describe('prefixedId', () => {
  it('joins the prefix and the local name', () => {
    expect(prefixedId('gantt-3', 'arrow')).toBe('gantt-3-arrow');
  });
});
