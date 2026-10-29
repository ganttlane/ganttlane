import { describe, expect, it, vi } from 'vitest';

import { createHtml, createSvg, disposableOf, setAttr, setAttrs, SVG_NS } from './index';

describe('createHtml / createSvg', () => {
  it('creates an HTML element with attributes and children', () => {
    const child = document.createElement('span');
    const div = createHtml(document, 'div', { class: 'a', 'data-x': 1 }, 'text', child);

    expect(div.tagName).toBe('DIV');
    expect(div.getAttribute('class')).toBe('a');
    expect(div.dataset.x).toBe('1');
    expect(div.childNodes).toHaveLength(2);
    expect(div.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(div.lastChild).toBe(child);
  });

  it('NFR-SEC-1: a string child is a text node, never parsed as markup', () => {
    const div = createHtml(document, 'div', undefined, '<img src=x onerror=alert(1)>');

    expect(div.childElementCount).toBe(0);
    expect(div.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('creates SVG elements in the SVG namespace', () => {
    const g = createSvg(document, 'g', { class: 'bars' });
    const rect = createSvg(document, 'rect', { x: 10, width: 4.5 }, 'ignored-but-text');
    g.append(rect);

    expect(g.namespaceURI).toBe(SVG_NS);
    expect(rect.namespaceURI).toBe(SVG_NS);
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('width')).toBe('4.5');
    expect(g.getAttribute('class')).toBe('bars');
  });

  it('uses the document it is given (a chart may live in an iframe)', () => {
    const other = document.implementation.createHTMLDocument('other');

    expect(createHtml(other, 'div').ownerDocument).toBe(other);
    expect(createSvg(other, 'g').ownerDocument).toBe(other);
  });
});

describe('setAttrs', () => {
  it('writes strings and numbers, `true` as an empty attribute', () => {
    const el = document.createElement('div');

    setAttrs(el, { id: 'a', tabindex: 0, 'data-selected': true });

    expect(el.getAttribute('id')).toBe('a');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('data-selected')).toBe('');
  });

  it('removes attributes for false, null and undefined', () => {
    const el = createHtml(document, 'div', { a: 'x', b: 'x', c: 'x', d: 'x' });

    setAttrs(el, { a: false, b: null, c: undefined, missing: undefined });

    expect(el.hasAttribute('a')).toBe(false);
    expect(el.hasAttribute('b')).toBe(false);
    expect(el.hasAttribute('c')).toBe(false);
    expect(el.getAttribute('d')).toBe('x');
  });

  it('NFR-PERF-1: touches only attributes whose value changed', () => {
    const el = createSvg(document, 'rect', { x: 10, y: 20, 'data-state': 'idle' });
    const set = vi.spyOn(el, 'setAttribute');
    const remove = vi.spyOn(el, 'removeAttribute');

    setAttrs(el, { x: 10, y: 25, 'data-state': 'idle', gone: undefined });
    setAttrs(el, { x: 10, y: 25 });

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('y', '25');
    expect(remove).not.toHaveBeenCalled();
  });

  it('setAttr sets or removes one attribute', () => {
    const el = document.createElement('div');

    setAttr(el, 'title', 'hi');
    expect(el.title).toBe('hi');
    setAttr(el, 'title', undefined);
    expect(el.hasAttribute('title')).toBe(false);
  });
});

describe('disposableOf', () => {
  it('FR-TIP-1, FR-BAR-5: reads an object with a node as a node with a lifetime, as it is', () => {
    const content = { node: document.createElement('div'), dispose: vi.fn() };

    expect(disposableOf(content)).toBe(content);
  });

  it('FR-TIP-1, FR-BAR-5: every other answer is not one', () => {
    const element = Object.assign(document.createElement('x-card'), { node: 'its own' });
    const answers = [
      undefined,
      null,
      '',
      'text',
      42,
      true,
      {},
      { html: '<b>x</b>' },
      { title: 'T', actions: [] },
      document.createElement('div'),
      document.createTextNode('x'),
      document.createDocumentFragment(),
      // A custom element may have a `node` property of its own: it is still a node.
      element,
    ];

    for (const answer of answers) expect(disposableOf(answer)).toBeUndefined();
  });
});
