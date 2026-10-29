import { afterEach, describe, expect, it, vi } from 'vitest';

import { fillContent, isEmptyContent } from './content';

const host = (): HTMLElement => document.createElement('div');

/** An element that counts how often it was taken out of the document: a node that is moved, not kept. */
class Counted extends HTMLElement {
  disconnects = 0;
  disconnectedCallback(): void {
    this.disconnects++;
  }
}
customElements.define('x-counted', Counted);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fillContent', () => {
  it('FR-TIP-1, FR-TIP-3: a string is text and is never parsed as HTML', () => {
    const el = host();
    const evil = '<img src=x onerror="globalThis.hacked = 1"><b>bold</b>';

    expect(fillContent(document, el, evil, false)).toEqual([]);

    expect(el.textContent).toBe(evil);
    expect(el.querySelector('img, b')).toBeNull();
    expect(el.children).toHaveLength(0);
  });

  it('FR-TIP-1: a Node is appended as it is', () => {
    const el = host();
    const node = document.createElement('em');
    node.textContent = 'node';

    fillContent(document, el, node, false);

    expect(el.firstChild).toBe(node);
    expect(el.children).toHaveLength(1);
    expect(el.textContent).toBe('node');
  });

  it('FR-TIP-1: a node returned twice is moved, not duplicated', () => {
    const el = host();
    const node = document.createElement('span');

    fillContent(document, el, node, false);
    fillContent(document, el, node, false);

    expect(el.querySelectorAll('span')).toHaveLength(1);
  });

  it('FR-TIP-1: a DisposableNode is shown as its node, and left to its owner to dispose', () => {
    const el = host();
    const node = document.createElement('em');
    node.textContent = 'hosted';
    const dispose = vi.fn();

    expect(fillContent(document, el, { node, dispose }, false)).toEqual([]);
    fillContent(document, el, { node, dispose }, false);

    expect(el.children).toHaveLength(1);
    expect(el.firstChild).toBe(node);
    expect(el.textContent).toBe('hosted');
    expect(dispose).not.toHaveBeenCalled();
  });

  it('FR-TIP-1: a node that is already the only child is left where it is, not taken out and put back', () => {
    const el = host();
    document.body.append(el);
    const node = new Counted();
    const input = document.createElement('input');
    node.append(input);
    fillContent(document, el, { node, dispose: vi.fn() }, false);
    input.focus();

    fillContent(document, el, { node, dispose: vi.fn() }, false);
    fillContent(document, el, node, false);

    expect(node.disconnects).toBe(0);
    expect(el.childNodes).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    el.remove();
  });

  it('FR-TIP-1: another node replaces it, and a node with company is made the only child', () => {
    const el = host();
    const node = new Counted();
    fillContent(document, el, { node, dispose: vi.fn() }, false);
    const other = document.createElement('i');

    fillContent(document, el, other, false);
    expect([...el.childNodes]).toEqual([other]);

    el.append('trailing');
    fillContent(document, el, other, false);
    expect([...el.childNodes]).toEqual([other]);
  });

  it('FR-TIP-1: {html} is the one way to insert markup', () => {
    const el = host();

    fillContent(document, el, { html: '<b>bold</b> text' }, false);

    expect(el.querySelector('b')?.textContent).toBe('bold');
    expect(el.textContent).toBe('bold text');
  });

  it('FR-TIP-1: the structured form renders title, subtitle and details as text', () => {
    const el = host();

    fillContent(document, el, { title: 'T <b>', subtitle: 'S <i>', details: 'D <u>' }, false);

    expect(el.querySelector('.gantt__popover-title')?.textContent).toBe('T <b>');
    expect(el.querySelector('.gantt__popover-subtitle')?.textContent).toBe('S <i>');
    expect(el.querySelector('.gantt__popover-details')?.textContent).toBe('D <u>');
    expect(el.querySelector('b, i, u')).toBeNull();
    expect([...el.children].map((child) => child.className)).toEqual([
      'gantt__popover-title',
      'gantt__popover-subtitle',
      'gantt__popover-details',
    ]);
  });

  it('FR-TIP-1: a section that is empty or missing is left out', () => {
    const el = host();

    fillContent(document, el, { title: 'Only', subtitle: '', details: undefined }, false);

    expect([...el.children].map((child) => child.className)).toEqual(['gantt__popover-title']);
  });

  it('FR-TIP-1: actions become buttons with their index, and are returned for the caller to call', () => {
    const el = host();
    const first = vi.fn();
    const actions = [
      { label: 'Open <b>', onSelect: first },
      { label: 'Close', onSelect: vi.fn() },
    ];

    expect(fillContent(document, el, { actions }, false)).toBe(actions);

    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Open <b>', 'Close']);
    expect(buttons.map((button) => button.getAttribute('data-action'))).toEqual(['0', '1']);
    expect(buttons.every((button) => button.type === 'button')).toBe(true);
    expect(buttons.every((button) => button.classList.contains('gantt__popover-action'))).toBe(
      true,
    );
    expect(el.querySelector('.gantt__popover-actions')).not.toBeNull();
    expect(first).not.toHaveBeenCalled();
  });

  it('FR-TIP-4: in a menu the buttons are menu items', () => {
    const el = host();

    fillContent(document, el, { actions: [{ label: 'Remove', onSelect: vi.fn() }] }, true);
    expect(el.querySelector('button')?.getAttribute('role')).toBe('menuitem');

    fillContent(document, el, { actions: [{ label: 'Remove', onSelect: vi.fn() }] }, false);
    expect(el.querySelector('button')?.hasAttribute('role')).toBe(false);
  });

  it('replaces what was there', () => {
    const el = host();
    fillContent(document, el, 'old', false);

    fillContent(document, el, { title: 'new' }, false);

    expect(el.textContent).toBe('new');
  });
});

describe('isEmptyContent', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace', '  \n '],
    ['an empty object', {}],
    ['empty sections', { title: '', subtitle: '', details: '' }],
    ['no actions', { actions: [] }],
    ['empty html', { html: '' }],
    ['html of whitespace', { html: ' ' }],
    ['sections of whitespace', { title: '   ', subtitle: '\n', details: '\t ' }],
    ['html of an element with whitespace', { html: '<div> </div>' }],
    ['html of nested elements with no text', { html: '<p>\n<span> </span></p><b></b>' }],
    ['html of a comment', { html: '<!-- nothing -->' }],
  ] as const)('FR-TIP-3: %s is empty', (_name, content) => {
    const el = host();
    fillContent(document, el, content, false);
    expect(isEmptyContent(el)).toBe(true);
  });

  it.each([
    ['text', 'x'],
    ['a node', document.createElement('i')],
    ['a title', { title: 'x' }],
    ['an action', { actions: [{ label: 'x', onSelect: () => undefined }] }],
    ['html with an element', { html: '<hr>' }],
    ['html with an image', { html: '<div> <img src="data:," alt=""> </div>' }],
    ['html with text inside elements', { html: '<div><span>x</span></div>' }],
    ['html with a control', { html: '<p><button type="button"></button></p>' }],
  ] as const)('FR-TIP-3: %s is not', (_name, content) => {
    const el = host();
    fillContent(document, el, content, false);
    expect(isEmptyContent(el)).toBe(false);
  });
});
