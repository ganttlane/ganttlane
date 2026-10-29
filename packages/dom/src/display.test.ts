import { describe, expect, it } from 'vitest';

import { DISPLAY_DEFAULTS, resolveDisplay } from './display';

describe('resolveDisplay', () => {
  it('FR-UI-1, FR-UI-2, FR-UI-4, FR-BAR-1: the defaults', () => {
    expect(resolveDisplay(undefined)).toBe(DISPLAY_DEFAULTS);
    expect(resolveDisplay({})).toBe(DISPLAY_DEFAULTS);
    expect(DISPLAY_DEFAULTS).toMatchObject({
      gridLines: 'both',
      today: true,
      nonWorkingDays: 'fill',
      highlights: true,
      highlightDays: [],
      rowStripes: false,
      barLabel: 'auto',
      headerRangeHighlight: true,
      linkCurveRadius: 5,
    });
    expect(Object.isFrozen(DISPLAY_DEFAULTS)).toBe(true);
  });

  it('merges over the base and keeps the identity when nothing changes', () => {
    const first = resolveDisplay({ nonWorkingDays: 'stripes', rowStripes: 'group' });
    expect(first).toMatchObject({ nonWorkingDays: 'stripes', rowStripes: 'group', today: true });
    expect(Object.isFrozen(first)).toBe(true);
    expect(resolveDisplay({ nonWorkingDays: 'stripes' }, first)).toBe(first);
    const second = resolveDisplay({ today: false }, first);
    expect(second).not.toBe(first);
    expect(second).toMatchObject({ nonWorkingDays: 'stripes', rowStripes: 'group', today: false });
  });

  it('replaces an unusable value with its default, and an explicit undefined too', () => {
    const base = resolveDisplay({ barLabel: 'inside', linkCurveRadius: 8 });
    const next = resolveDisplay(
      {
        gridLines: 'diagonal' as never,
        nonWorkingDays: true as never,
        linkCurveRadius: -1,
        renderBarLabel: 'label' as never,
        barLabel: undefined,
      },
      base,
    );
    expect(next).toMatchObject({
      gridLines: 'both',
      nonWorkingDays: 'fill',
      linkCurveRadius: 5,
      renderBarLabel: undefined,
      barLabel: 'auto',
    });
  });

  it('FR-BAR-5, FR-UI-3: keeps the label renderer and the highlight list as given', () => {
    const render = (): string => 'x';
    const highlightDays = [{ id: 'launch', dates: ['2026-03-04'] }];
    const display = resolveDisplay({ renderBarLabel: render, highlightDays });
    expect(display.renderBarLabel).toBe(render);
    expect(display.highlightDays).toBe(highlightDays);
  });
});

describe('resolveDisplay: popovers (plan step 4.8)', () => {
  it('FR-TIP-1, FR-TIP-4, FR-TIP-5: the popover groups default to empty, and the layer applies the defaults of their fields', () => {
    expect(DISPLAY_DEFAULTS.tooltip).toEqual({});
    expect(DISPLAY_DEFAULTS.linkMenu).toEqual({});
    expect(DISPLAY_DEFAULTS.highlightTooltip).toEqual({});
    expect(Object.isFrozen(DISPLAY_DEFAULTS.tooltip)).toBe(true);
  });

  it('FR-TIP-1: a group is taken as a whole, not merged field by field, and keeps its identity', () => {
    const tooltip = { trigger: 'click', delay: 0 } as const;
    const first = resolveDisplay({ tooltip });
    expect(first.tooltip).toBe(tooltip);
    expect(resolveDisplay({ tooltip }, first)).toBe(first);
    const second = resolveDisplay({ tooltip: { followCursor: true } }, first);
    expect(second.tooltip).toEqual({ followCursor: true });
    expect(resolveDisplay({ today: false }, second).tooltip).toBe(second.tooltip);
  });

  it('FR-TIP-1: something that is not an object, or undefined, returns the group to its default', () => {
    const base = resolveDisplay({
      tooltip: { trigger: 'none' },
      linkMenu: { onRemove: () => undefined },
      highlightTooltip: { followCursor: true },
    });

    const reset = resolveDisplay(
      { tooltip: undefined, linkMenu: 'menu' as never, highlightTooltip: null as never },
      base,
    );

    expect(reset.tooltip).toBe(DISPLAY_DEFAULTS.tooltip);
    expect(reset.linkMenu).toBe(DISPLAY_DEFAULTS.linkMenu);
    expect(reset.highlightTooltip).toBe(DISPLAY_DEFAULTS.highlightTooltip);
  });

  it('FR-TIP-4: keeps the render and removal callbacks as given', () => {
    const render = (): string => 'menu';
    const onRemove = (): void => undefined;

    const display = resolveDisplay({ linkMenu: { render, onRemove } });

    expect(display.linkMenu.render).toBe(render);
    expect(display.linkMenu.onRemove).toBe(onRemove);
  });
});
