import { describe, expect, it, vi } from 'vitest';

import { createSvg, px, setCssVar, setCssVars } from './index';

describe('css custom property setters', () => {
  it('FR-THEME-6: sets properties through the CSSOM (style.setProperty)', () => {
    const el = document.createElement('div');
    const setProperty = vi.spyOn(el.style, 'setProperty');

    setCssVar(el, '--gantt-row-height', px(32));

    expect(setProperty).toHaveBeenCalledWith('--gantt-row-height', '32px');
    expect(el.style.getPropertyValue('--gantt-row-height')).toBe('32px');
  });

  it('writes numbers as unitless text and removes on undefined', () => {
    const el = document.createElement('div');

    setCssVar(el, '--gantt-scale', 1.5);
    expect(el.style.getPropertyValue('--gantt-scale')).toBe('1.5');

    setCssVar(el, '--gantt-scale', undefined);
    expect(el.style.getPropertyValue('--gantt-scale')).toBe('');
  });

  it('writes only when the value changed', () => {
    const el = document.createElement('div');
    setCssVar(el, '--gantt-a', '1px');
    const set = vi.spyOn(el.style, 'setProperty');
    const remove = vi.spyOn(el.style, 'removeProperty');

    setCssVar(el, '--gantt-a', '1px');
    setCssVar(el, '--gantt-missing', undefined);
    setCssVar(el, '--gantt-a', '2px');

    expect(set).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('sets several at once, on SVG elements too', () => {
    const g = createSvg(document, 'g');

    setCssVars(g, { '--gantt-a': '1px', '--gantt-b': 2, '--gantt-c': undefined });

    expect(g.style.getPropertyValue('--gantt-a')).toBe('1px');
    expect(g.style.getPropertyValue('--gantt-b')).toBe('2');
    expect(g.style.getPropertyValue('--gantt-c')).toBe('');
  });

  it('px formats a length', () => {
    expect(px(12.5)).toBe('12.5px');
  });
});
