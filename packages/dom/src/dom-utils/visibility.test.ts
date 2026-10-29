import { describe, expect, it } from 'vitest';

import { showsNothing } from './visibility';

/** A host with this markup in it. */
function hostOf(markup: string): HTMLElement {
  const host = document.createElement('div');
  // eslint-disable-next-line no-restricted-properties -- a test fixture
  host.innerHTML = markup;
  return host;
}

describe('showsNothing', () => {
  it.each([
    ['nothing', ''],
    ['whitespace', ' \n\t '],
    ['an element around nothing', '<div></div>'],
    ['nested elements around whitespace', '<p>\n<span> </span></p><b></b>'],
    ['a comment', '<!-- nothing -->'],
    ['a link with no text', '<a href="#"></a>'],
  ])('FR-TIP-3: %s shows nothing', (_name, markup) => {
    expect(showsNothing(hostOf(markup))).toBe(true);
  });

  it.each([
    ['text', 'x'],
    ['text inside elements', '<div><span>x</span></div>'],
    ['a rule', '<hr>'],
    ['an image', '<div> <img src="data:," alt=""> </div>'],
    ['an svg', '<svg width="10" height="10"></svg>'],
    ['a canvas', '<canvas></canvas>'],
    ['a control', '<p><button type="button"></button></p>'],
    ['an input', '<label><input type="text"></label>'],
    ['a select', '<select></select>'],
  ])('FR-TIP-3: %s shows something', (_name, markup) => {
    expect(showsNothing(hostOf(markup))).toBe(false);
  });
});
