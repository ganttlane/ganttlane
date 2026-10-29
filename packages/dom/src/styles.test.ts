import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(`${import.meta.dirname}/styles.css`, 'utf8');
const readme = readFileSync(`${import.meta.dirname}/../README.md`, 'utf8');

// ---------------------------------------------------------------------------------------------
// A small CSS reader: just enough for a flat, hand-written sheet (rules and at-rule groups,
// no native nesting, no statement at-rules). It throws on anything else, which is the point:
// the sheet is meant to stay that simple (FR-THEME-3).
// ---------------------------------------------------------------------------------------------

interface Declaration {
  readonly property: string;
  readonly value: string;
}
interface StyleRule {
  readonly selector: string;
  readonly declarations: readonly Declaration[];
}
interface GroupRule {
  readonly prelude: string;
  readonly children: readonly Block[];
}
type Block = StyleRule | GroupRule;
/** A style rule with the at-rules it sits in, outermost first. */
interface FlatRule extends StyleRule {
  readonly context: readonly string[];
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');
const isGroup = (block: Block): block is GroupRule => 'prelude' in block;

/** Index of the `}` that closes the `{` at `open`. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error('unbalanced braces');
}

/** Splits at `separator`, but not inside parentheses or brackets (`:is(a, b)`, `rgb(1 2 3 / 4%)`). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function parseDeclarations(body: string): Declaration[] {
  return splitTopLevel(body, ';').map((text) => {
    const colon = text.indexOf(':');
    if (colon === -1) throw new Error(`not a declaration: "${text}"`);
    return { property: text.slice(0, colon).trim(), value: collapse(text.slice(colon + 1)) };
  });
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  for (;;) {
    const open = source.indexOf('{', index);
    if (open === -1) break;
    const prelude = collapse(source.slice(index, open));
    if (prelude.includes(';'))
      throw new Error(`a statement (@import, @layer a, b;) before "${prelude}"`);
    const close = closingBrace(source, open);
    const body = source.slice(open + 1, close);
    blocks.push(
      prelude.startsWith('@')
        ? { prelude, children: parseBlocks(body) }
        : { selector: prelude.replace(/"/g, "'"), declarations: parseDeclarations(body) },
    );
    index = close + 1;
  }
  if (source.slice(index).trim() !== '') throw new Error('text after the last block');
  return blocks;
}

function flatten(blocks: readonly Block[], context: readonly string[] = []): FlatRule[] {
  return blocks.flatMap((block) =>
    isGroup(block) ? flatten(block.children, [...context, block.prelude]) : [{ ...block, context }],
  );
}

type Specificity = readonly [ids: number, classes: number, types: number];
const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;
const compare = (a: Specificity, b: Specificity): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** `:where()` counts nothing, `:is()` / `:not()` / `:has()` count their most specific argument. */
function specificity(selector: string): Specificity {
  let ids = 0;
  let classes = 0;
  let types = 0;
  let rest = selector;
  for (;;) {
    const match = /:(is|not|where|has)\(/.exec(rest);
    if (!match) break;
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < rest.length; close += 1) {
      if (rest[close] === '(') depth += 1;
      if (rest[close] === ')') depth -= 1;
      if (depth === 0) break;
    }
    if (match[1] !== 'where') {
      const [best] = splitTopLevel(rest.slice(open + 1, close), ',')
        .map(specificity)
        .sort((a, b) => compare(b, a));
      if (best) {
        ids += best[0];
        classes += best[1];
        types += best[2];
      }
    }
    rest = rest.slice(0, match.index) + ' ' + rest.slice(close + 1);
  }
  ids += count(rest, /#[\w-]+/g);
  classes += count(rest, /\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g);
  types += count(rest.replace(/\[[^\]]*\]|[.#:]{1,2}[\w-]+/g, ' '), /[a-z][\w-]*/gi);
  return [ids, classes, types];
}

// ---------------------------------------------------------------------------------------------
// The sheet and the contract it implements (README.md, "Unstyled contract").
// ---------------------------------------------------------------------------------------------

const LAYER = '@layer gantt';
const DARK_QUERY = '@media (prefers-color-scheme: dark)';
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
const SUPPORTS_COLOR_MIX = '@supports (color: color-mix(in srgb, red, blue))';

const stripped = stripComments(css);
const sheet = parseBlocks(stripped);
const rules = flatten(sheet);
const selectorsOf = (rule: StyleRule): string[] => splitTopLevel(rule.selector, ',');
const allSelectors = rules.flatMap(selectorsOf);
const rulesFor = (selector: string, context?: readonly string[]): FlatRule[] =>
  rules.filter(
    (rule) =>
      selectorsOf(rule).includes(selector) &&
      (context === undefined || rule.context.join(' > ') === context.join(' > ')),
  );
/** The last value a property gets from the rules of exactly this selector. */
const valueOf = (selector: string, property: string): string | undefined =>
  rulesFor(selector)
    .flatMap((rule) => rule.declarations)
    .findLast((declaration) => declaration.property === property)?.value;

const tokensOf = (found: readonly FlatRule[]): Map<string, string> =>
  new Map(
    found
      .flatMap((rule) => rule.declarations)
      .filter(({ property }) => property.startsWith('--gantt-'))
      .map(({ property, value }) => [property, value] as const),
  );

const lightTokens = tokensOf(rulesFor('.gantt', [LAYER]));
const darkTokens = tokensOf(rulesFor(".gantt[data-theme='dark']", [LAYER]));
const autoDarkTokens = tokensOf(rulesFor(".gantt[data-theme='auto']", [LAYER, DARK_QUERY]));

/** Custom properties the renderer writes on elements; the sheet reads them with a fallback. */
const RENDERER_INPUTS = [
  '--gantt-content-width',
  '--gantt-header-height',
  '--gantt-body-height',
  '--gantt-height',
  '--gantt-bar-progress-color',
  '--gantt-popover-x',
  '--gantt-popover-y',
];

/** Every class of the unstyled contract. */
const CONTRACT_CLASSES = [
  'gantt',
  'gantt__scroller',
  'gantt__pin',
  'gantt__header',
  'gantt__body',
  'gantt__grid',
  'gantt__links',
  'gantt__bars',
  'gantt__overlay',
  'gantt__layer',
  'gantt__header-row',
  'gantt__header-cell',
  'gantt__header-label',
  'gantt__header-range',
  'gantt__today-marker',
  'gantt__rows',
  'gantt__row',
  'gantt__nonworking',
  'gantt__nonworking-day',
  'gantt__stripes',
  'gantt__stripes-line',
  'gantt__highlights',
  'gantt__highlight',
  'gantt__gridlines',
  'gantt__gridline',
  'gantt__today',
  'gantt__bar',
  'gantt__bar-track',
  'gantt__bar-progress',
  'gantt__bar-label',
  'gantt__bar-label-content',
  'gantt__bar-milestone',
  'gantt__handle',
  'gantt__link-handle',
  'gantt__link',
  'gantt__link-path',
  'gantt__link-arrow',
  'gantt__link-hit',
  'gantt__link-preview',
  'gantt__popover',
  'gantt__popover-title',
  'gantt__popover-subtitle',
  'gantt__popover-details',
  'gantt__popover-actions',
  'gantt__popover-action',
];
/** Contract classes without a rule on purpose: plain grouping elements (and the stripes pattern). */
const UNSTYLED_CLASSES = [
  'gantt__grid',
  'gantt__links',
  'gantt__bars',
  'gantt__rows',
  'gantt__stripes',
  'gantt__highlights',
  'gantt__gridlines',
];

/** Every `data-*` attribute of the unstyled contract. */
const CONTRACT_ATTRIBUTES = [
  'data-theme',
  'data-height',
  'data-unit',
  'data-row',
  'data-current',
  'data-major',
  'data-sticky',
  'data-task-id',
  'data-stripe',
  'data-invalid',
  'data-placeholder',
  'data-mode',
  'data-day',
  'data-reason',
  'data-highlight',
  'data-orientation',
  'data-minor',
  'data-type',
  'data-selected',
  'data-hovered',
  'data-dragging',
  'data-resizing',
  'data-locked',
  'data-readonly',
  'data-movable',
  'data-conflict',
  'data-placement',
  'data-handle',
  'data-side',
  'data-link-id',
  'data-cycle',
  'data-valid',
  'data-cursor',
  'data-kind',
  'data-interactive',
  'data-action',
];
/** Contract attributes that are hooks for the application (ids, kinds), not visual states. */
const UNSTYLED_ATTRIBUTES = [
  'data-unit',
  'data-row',
  'data-task-id',
  'data-day',
  'data-reason',
  'data-highlight',
  'data-orientation',
  'data-type',
  'data-side',
  'data-link-id',
  'data-action',
];

describe('styles.css: a plain sheet in @layer gantt', () => {
  it('FR-THEME-3: every rule is inside the single `@layer gantt` block', () => {
    expect(sheet.map((block) => (isGroup(block) ? block.prelude : block.selector))).toEqual([
      LAYER,
    ]);
    expect(rules.length).toBeGreaterThan(50);
    expect(rules.every((rule) => rule.context[0] === LAYER)).toBe(true);
  });

  it('FR-THEME-3: nothing is `!important`', () => {
    expect(stripped).not.toMatch(/!\s*important/i);
  });

  it('FR-THEME-3: selectors hang off a gantt class and stay at most "3 classes / attributes"', () => {
    for (const selector of allSelectors) {
      expect(selector, selector).toMatch(/\.gantt/);
      const [ids, classes, types] = specificity(selector);
      expect([selector, ids]).toEqual([selector, 0]);
      expect(classes, selector).toBeLessThanOrEqual(3);
      expect(types, selector).toBeLessThanOrEqual(1);
    }
  });

  it('FR-THEME-6: loads nothing (no @import, no url())', () => {
    expect(stripped).not.toMatch(/@import|url\(/i);
  });

  it('FR-THEME-5: keeps the structure the renderer relies on, sized from its custom properties', () => {
    expect(valueOf('.gantt__scroller', 'overflow')).toBe('auto');
    expect(valueOf('.gantt__header', 'position')).toBe('sticky');
    expect(valueOf('.gantt__header', 'top')).toBe('0');
    expect(valueOf('.gantt__header', 'width')).toBe('var(--gantt-content-width, 0)');
    expect(valueOf('.gantt__header', 'height')).toBe('var(--gantt-header-height, 0)');
    expect(valueOf('.gantt__body', 'display')).toBe('block');
    expect(valueOf('.gantt__body', 'width')).toBe('var(--gantt-content-width, 0)');
    expect(valueOf('.gantt__body', 'height')).toBe('var(--gantt-body-height, 0)');
    expect(valueOf('.gantt__layer', 'position')).toBe('absolute');
    expect(valueOf('.gantt__layer', 'pointer-events')).toBe('none');
  });
});

describe('styles.css: scrolling (plan steps 4.6 and 4.9)', () => {
  it('FR-TL-3: only the renderer moves the scroller: no scroll anchoring, no CSS smooth scrolling', () => {
    // The compensation of the infinite timeline would fight the browser's own anchoring, and a
    // `scroll-behavior` of the application on `*` would make every programmatic write a slide.
    expect(valueOf('.gantt__scroller', 'overflow-anchor')).toBe('none');
    expect(valueOf('.gantt__scroller', 'scroll-behavior')).toBe('auto');
    expect(readme).toMatch(/overflow-anchor: none/);
    expect(readme).toMatch(/scroll-behavior: auto/);
  });

  it('FR-I18N-3, FR-TL-2: the chart is left to right whatever the page is, so `scrollLeft` is never negative', () => {
    // An RTL scroller counts `scrollLeft` from its right edge, down to a negative number; the
    // renderer's arithmetic (and the core's) is left to right. RTL is a P1 feature of its own.
    expect(valueOf('.gantt', 'direction')).toBe('ltr');
    expect(readme).toMatch(/direction: ltr/);
  });

  it('FR-SCROLL-3: the chart is `--gantt-height` tall, or as tall as its container, or as its content', () => {
    expect(valueOf('.gantt', 'height')).toBe('var(--gantt-height, 100%)');
    expect(valueOf(".gantt[data-height='auto']", 'height')).toBe('auto');
  });

  it('FR-SCROLL-3: with an automatic height the scroller scrolls sideways only, under the header pin', () => {
    const auto = ".gantt[data-height='auto'] .gantt__scroller";
    expect(valueOf(auto, 'height')).toBe('auto');
    // Vertical overflow is cut, not scrolled: the page scrolls the rows, and a wheel over the
    // chart goes on to it.
    expect(valueOf(auto, 'overflow-y')).toBe('hidden');
    // The pin overlaps the first `--gantt-header-height` px of the scroller, which are its
    // padding: the scroller's box is the header and the rows, as in a fixed height.
    expect(valueOf(auto, 'padding-block-start')).toBe('var(--gantt-header-height, 0)');
    expect(valueOf(auto, 'margin-block-start')).toBe('calc(var(--gantt-header-height, 0px) * -1)');
  });

  it('FR-SCROLL-3: the header pin sticks to the top of what scrolls the chart, above the scroller', () => {
    expect(valueOf('.gantt__pin', 'position')).toBe('sticky');
    expect(valueOf('.gantt__pin', 'top')).toBe('0');
    expect(valueOf('.gantt__pin', 'height')).toBe('var(--gantt-header-height, 0)');
    // It is the scroll container the header's sticky label sticks to, scrolled by the renderer.
    expect(valueOf('.gantt__pin', 'overflow')).toBe('hidden');
    expect(valueOf('.gantt__pin', 'scroll-behavior')).toBe('auto');
    // A vertical pan on the header scrolls the page, as anywhere; a sideways one is not the
    // browser's (the pin does not scroll by hand), and the renderer passes it on to the scroller.
    expect(valueOf('.gantt__pin', 'touch-action')).toBe('pan-y');
    const above = (selector: string): number => Number(valueOf(selector, 'z-index') ?? Number.NaN);
    expect(above('.gantt__pin')).toBeGreaterThan(0);
    expect(above('.gantt__layer')).toBeGreaterThan(above('.gantt__pin'));
  });

  it('FR-SCROLL-3: the README names the pin, `data-height` and `--gantt-height`', () => {
    for (const name of ['gantt__pin', 'data-height', '--gantt-height']) {
      expect(readme, name).toContain(name);
    }
  });
});

describe('styles.css: the unstyled contract', () => {
  const usedClasses = new Set(
    allSelectors.flatMap((selector) => [...selector.matchAll(/\.(gantt[\w-]*)/g)].map((m) => m[1])),
  );
  const usedAttributes = new Set(
    allSelectors.flatMap((selector) => [...selector.matchAll(/\[(data-[\w-]+)/g)].map((m) => m[1])),
  );

  it('FR-THEME-5: every contract class has a rule, or is a listed grouping element', () => {
    const unstyled = CONTRACT_CLASSES.filter((name) => !usedClasses.has(name));
    expect(unstyled).toEqual(UNSTYLED_CLASSES.filter((name) => unstyled.includes(name)));
    expect(unstyled.sort()).toEqual([...UNSTYLED_CLASSES].sort());
  });

  it('FR-THEME-5: the sheet styles no class outside the contract', () => {
    expect([...usedClasses].filter((name) => !CONTRACT_CLASSES.includes(name ?? ''))).toEqual([]);
  });

  it('FR-THEME-5: every contract attribute is styled, or is a listed hook', () => {
    const unstyled = CONTRACT_ATTRIBUTES.filter((name) => !usedAttributes.has(name));
    expect(unstyled.sort()).toEqual([...UNSTYLED_ATTRIBUTES].sort());
    expect([...usedAttributes].filter((name) => !CONTRACT_ATTRIBUTES.includes(name ?? ''))).toEqual(
      [],
    );
  });

  it('FR-BAR-3: each bar state has its own rule on `.gantt__bar`', () => {
    for (const state of [
      'selected',
      'hovered',
      'dragging',
      'resizing',
      'locked',
      'readonly',
      'invalid',
      'conflict',
    ]) {
      const styled = allSelectors.some(
        (selector) => selector.startsWith('.gantt__bar') && selector.includes(`[data-${state}`),
      );
      expect(styled, state).toBe(true);
    }
  });

  it('FR-SEL-1: the outline of a selected bar wins over the invalid, conflict and hover outlines', () => {
    const index = (selector: string): number =>
      rules.findIndex((rule) => selectorsOf(rule).includes(selector));
    const selected = '.gantt__bar[data-selected]';
    const states = [
      '.gantt__bar[data-invalid]',
      '.gantt__bar[data-conflict]',
      '.gantt__bar:is([data-hovered], :hover)',
    ];
    expect(index(selected)).toBeGreaterThan(-1);
    for (const property of ['stroke', 'stroke-width']) {
      expect(valueOf(selected, property), property).toBeTruthy();
      for (const state of states) {
        expect(valueOf(state, property), `${state} ${property}`).toBeTruthy();
        // Higher specificity, or the same and later in the sheet.
        const order = compare(specificity(selected), specificity(state));
        expect(order > 0 || (order === 0 && index(selected) > index(state)), state).toBe(true);
      }
    }
    // A focused bar shows its ring over the selection, which is its own state, not the keyboard's.
    const focus = '.gantt__bar:focus-visible';
    const order = compare(specificity(focus), specificity(selected));
    expect(order > 0 || (order === 0 && index(focus) > index(selected))).toBe(true);
  });

  it('FR-EDIT-7: the sheet draws no geometry: the renderer writes the radius of a handle, the bounds of a bar', () => {
    // A CSS `r` would out-rank the `r` attribute and make `interaction.handles.link` change the
    // hit test but not the circle; the same goes for every other SVG geometry property.
    const geometry = new Set(['r', 'cx', 'cy', 'rx', 'ry', 'x', 'y']);
    const declared = rules
      .flatMap((rule) => rule.declarations.map(({ property }) => [rule.selector, property]))
      .filter(([, property]) => geometry.has(property ?? ''));
    expect(declared).toEqual([]);
    expect(readme).toMatch(/interaction\.handles\.link/);
    expect(readme).toMatch(/sets no `r`|leave `r`/);
  });

  it('FR-LINK-3, FR-SEL-1: links have selected, conflict and cycle (dashed) styles and a hit path', () => {
    expect(rulesFor('.gantt__link[data-selected]')).not.toHaveLength(0);
    expect(rulesFor('.gantt__link:is([data-conflict], [data-cycle])')).not.toHaveLength(0);
    expect(valueOf('.gantt__link[data-cycle] .gantt__link-path', 'stroke-dasharray')).toBeTruthy();
    expect(valueOf('.gantt__link-hit', 'pointer-events')).toBe('stroke');
    expect(valueOf('.gantt__link-hit', 'stroke')).toBe('transparent');
  });

  it('FR-UI-2: fill mode is a CSS fill, stripes mode takes its colour from the pattern lines', () => {
    expect(
      valueOf(".gantt__nonworking[data-mode='fill'] > .gantt__nonworking-day", 'fill'),
    ).toBeTruthy();
    expect(valueOf('.gantt__stripes-line', 'stroke')).toBe('var(--gantt-nonworking-stripe-color)');
    // A `fill` on every day would override the pattern the renderer sets in stripes mode.
    expect(allSelectors).not.toContain('.gantt__nonworking-day');
  });

  it('FR-ROW-4: stripes, invalid and placeholder rows have a fill', () => {
    for (const flag of ['stripe', 'invalid', 'placeholder']) {
      expect(valueOf(`.gantt__row[data-${flag}]`, 'fill'), flag).toBeTruthy();
    }
  });

  it('FR-SCALE-5: no element a sticky header label sticks within is a scroll container', () => {
    // `overflow: hidden` (like `auto` and `scroll`) makes the header, a row or a cell the
    // container a sticky label sticks to; only `clip` cuts the same pixels without that.
    for (const selector of ['.gantt__header', '.gantt__header-row', '.gantt__header-cell']) {
      const overflow = rulesFor(selector).flatMap((rule) =>
        rule.declarations.filter(({ property }) => property.startsWith('overflow')),
      );
      expect(
        overflow.every(({ value }) => value === 'clip'),
        selector,
      ).toBe(true);
    }
    expect(valueOf('.gantt__header', 'overflow')).toBe('clip');
    expect(valueOf('.gantt__header-cell', 'overflow')).toBe('clip');
    expect(readme).toMatch(/clip with `overflow: clip`, never `hidden`/);
  });

  it('FR-SNAP-9: minor grid lines are drawn apart from the column and major lines', () => {
    expect(valueOf('.gantt__gridline[data-minor]', 'stroke')).toBe(
      'var(--gantt-grid-minor-line-color)',
    );
    expect(valueOf('.gantt__gridline[data-minor]', 'stroke-dasharray')).toBeTruthy();
  });

  it('FR-BAR-5: the HTML of a custom label is laid out in its foreignObject, and may overflow outside', () => {
    expect(valueOf('.gantt__bar-label-content', 'display')).toBe('flex');
    expect(valueOf('.gantt__bar-label-content', 'overflow')).toBe('hidden');
    expect(
      valueOf(".gantt__bar-label[data-placement='outside'] .gantt__bar-label-content", 'overflow'),
    ).toBe('visible');
  });

  it('FR-BAR-1: handles stay hidden until the bar is hovered, selected, dragged or resized', () => {
    expect(valueOf('.gantt__handle', 'opacity')).toBe('0');
    expect(valueOf('.gantt__link-handle', 'opacity')).toBe('0');
    const reveal = rules.find((rule) =>
      rule.selector.includes(':is(.gantt__handle, .gantt__link-handle)'),
    );
    expect(reveal?.declarations).toEqual([{ property: 'opacity', value: '1' }]);
    for (const state of ['hovered', 'selected', 'dragging', 'resizing']) {
      expect(reveal?.selector, state).toContain(`[data-${state}]`);
    }
  });

  it('P1: focus-visible rings exist for the scroller, bars, links and handles', () => {
    const focusable = [
      '.gantt__scroller:focus-visible',
      '.gantt__bar:focus-visible',
      '.gantt__link:focus-visible',
      '.gantt__handle:focus-visible',
      '.gantt__link-handle:focus-visible',
    ];
    for (const selector of focusable) {
      expect(allSelectors, selector).toContain(selector);
    }
    expect(valueOf('.gantt__scroller:focus-visible', 'outline')).toBe(
      'var(--gantt-focus-ring-width) solid var(--gantt-focus-ring-color)',
    );
  });
});

describe('styles.css: interaction (plan step 4.7)', () => {
  it('FR-EDIT-1: a bar that may be moved takes the whole touch, handles too; any other bar body scrolls', () => {
    expect(valueOf('.gantt__bar[data-movable]', 'touch-action')).toBe('none');
    expect(valueOf('.gantt__handle', 'touch-action')).toBe('none');
    expect(valueOf('.gantt__link-handle', 'touch-action')).toBe('none');
    // Not on every bar, nor on every editable one: the body of a bar that cannot be moved (read
    // only, or resizable only) must not trap a touch that wants to scroll.
    expect(valueOf('.gantt__bar', 'touch-action')).toBeUndefined();
    expect(valueOf('.gantt__bar:not([data-readonly])', 'touch-action')).toBeUndefined();
  });

  it('FR-EDIT-8: every cursor of a gesture in progress has a rule on `data-cursor`, which the whole chart inherits', () => {
    // The interaction machine's cursors outside `idle` (`grab` is the idle hover, the bars' own).
    for (const cursor of [
      'default',
      'pointer',
      'grabbing',
      'ew-resize',
      'crosshair',
      'not-allowed',
    ]) {
      expect(valueOf(`.gantt[data-cursor='${cursor}']`, 'cursor'), cursor).toBe(cursor);
    }
    expect(valueOf('.gantt[data-cursor] *', 'cursor')).toBe('inherit');
  });

  it('FR-EDIT-8: the cursor rules out-rank the bars and handles, which sit earlier in the sheet', () => {
    const index = (selector: string): number =>
      rules.findIndex((rule) => rule.selector === selector);
    const [inherit, bar, handle] = [
      index('.gantt[data-cursor] *'),
      index('.gantt__bar[data-dragging]'),
      index(".gantt__handle[data-handle^='resize']"),
    ];
    expect(bar).toBeGreaterThan(-1);
    expect(handle).toBeGreaterThan(-1);
    expect(inherit).toBeGreaterThan(bar);
    expect(inherit).toBeGreaterThan(handle);
    // Equal specificity (two classes / attributes): the later rule wins.
    expect(specificity('.gantt[data-cursor] *')).toEqual(specificity('.gantt__bar[data-dragging]'));
  });

  it('FR-LINK-4, FR-LINK-6: the link preview is the selected colour when allowed, the conflict colour when refused', () => {
    expect(valueOf('.gantt__link-preview', 'stroke')).toBe('var(--gantt-link-conflict-color)');
    expect(valueOf(".gantt__link-preview[data-valid]:not([data-valid='false'])", 'stroke')).toBe(
      'var(--gantt-link-selected-color)',
    );
    expect(valueOf('.gantt__overlay', 'pointer-events')).toBe('none');
  });
});

describe('styles.css: popovers (plan step 4.8)', () => {
  it('FR-TIP-1: a popover is placed by the renderer with a transform and never blocks the chart', () => {
    expect(valueOf('.gantt__popover', 'position')).toBe('absolute');
    expect(valueOf('.gantt__popover', 'transform')).toBe(
      'translate(var(--gantt-popover-x, 0), var(--gantt-popover-y, 0))',
    );
    // The layer takes no pointer events and a tooltip inherits that; only actions need them.
    expect(valueOf('.gantt__popover', 'pointer-events')).toBeUndefined();
    expect(valueOf('.gantt__popover[data-interactive]', 'pointer-events')).toBe('auto');
  });

  it('FR-THEME-2: its colours are tokens with dark values, not literals', () => {
    for (const property of ['background', 'color', 'border', 'box-shadow']) {
      expect(valueOf('.gantt__popover', property), property).toMatch(/var\(--gantt-popover-/);
    }
    for (const token of [
      '--gantt-popover-background-color',
      '--gantt-popover-foreground-color',
      '--gantt-popover-border-color',
      '--gantt-popover-shadow-color',
    ]) {
      expect(darkTokens.has(token), token).toBe(true);
    }
  });

  it('FR-TIP-4: a link menu lists its actions in a column', () => {
    expect(
      valueOf(".gantt__popover[data-kind='link'] .gantt__popover-actions", 'flex-direction'),
    ).toBe('column');
  });

  it('FR-TIP-1: action buttons show keyboard focus with the focus ring tokens', () => {
    expect(valueOf('.gantt__popover-action:focus-visible', 'outline')).toBe(
      'var(--gantt-focus-ring-width) solid var(--gantt-focus-ring-color)',
    );
  });
});

describe('styles.css: tokens', () => {
  const usedTokens = rules
    .flatMap((rule) => rule.declarations)
    .flatMap(({ value }) =>
      [...value.matchAll(/var\(\s*(--gantt-[\w-]+)\s*(,)?/g)].map((match) => ({
        name: match[1] ?? '',
        hasFallback: match[2] !== undefined,
      })),
    );

  it('FR-THEME-1: every token the sheet reads is declared on `.gantt` or has a fallback', () => {
    const missing = usedTokens
      .filter(({ name, hasFallback }) => !hasFallback && !lightTokens.has(name))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it('FR-THEME-1: every declared token is read somewhere', () => {
    const read = new Set(usedTokens.map(({ name }) => name));
    expect([...lightTokens.keys()].filter((name) => !read.has(name))).toEqual([]);
  });

  it('FR-THEME-1: renderer-written properties are the documented ones', () => {
    const fallbackOnly = usedTokens
      .filter(({ name }) => !lightTokens.has(name))
      .map(({ name }) => name);
    expect([...new Set(fallbackOnly)].sort()).toEqual([...RENDERER_INPUTS].sort());
  });

  it('FR-THEME-1: tokens are `--gantt-` lowercase words', () => {
    for (const name of lightTokens.keys()) expect(name).toMatch(/^--gantt(-[a-z]+)+$/);
  });

  it('FR-THEME-2: dark overrides only declared tokens, and every colour token has a dark value', () => {
    expect([...darkTokens.keys()].filter((name) => !lightTokens.has(name))).toEqual([]);
    const colours = [...lightTokens.keys()].filter((name) => name.endsWith('-color'));
    expect(colours.filter((name) => !darkTokens.has(name))).toEqual([]);
  });

  it('FR-THEME-2: so every theme defines every token it reads', () => {
    for (const theme of [darkTokens, autoDarkTokens]) {
      const effective = new Map([...lightTokens, ...theme]);
      const read = usedTokens.filter(({ hasFallback }) => !hasFallback).map(({ name }) => name);
      expect(read.filter((name) => !effective.has(name))).toEqual([]);
    }
  });
});

describe('styles.css: themes', () => {
  it('FR-THEME-2: light is the default, on the bare `.gantt`', () => {
    expect(valueOf('.gantt', 'color-scheme')).toBe('light');
    expect(lightTokens.get('--gantt-background-color')).toBeDefined();
    expect(allSelectors).not.toContain(".gantt[data-theme='light']");
  });

  it('FR-THEME-2: `dark` swaps the token values for the forced dark theme', () => {
    expect(darkTokens.size).toBeGreaterThan(20);
    expect(valueOf(".gantt[data-theme='dark']", 'color-scheme')).toBe('dark');
    expect(darkTokens.get('--gantt-background-color')).not.toBe(
      lightTokens.get('--gantt-background-color'),
    );
  });

  it('FR-THEME-2: `auto` is dark only under `prefers-color-scheme: dark`, with the same values as `dark`', () => {
    const queries = rules.filter((rule) => rule.context.includes(DARK_QUERY));
    expect(queries.flatMap(selectorsOf)).toEqual([".gantt[data-theme='auto']"]);
    expect(autoDarkTokens).toEqual(darkTokens);
    const [auto] = rulesFor(".gantt[data-theme='auto']", [LAYER, DARK_QUERY]);
    const [dark] = rulesFor(".gantt[data-theme='dark']", [LAYER]);
    expect(auto?.declarations).toEqual(dark?.declarations);
    // No other rule is conditional on the colour scheme: themes change tokens, not selectors.
    const darkOnly = rules.filter((rule) =>
      selectorsOf(rule).some((s) => s.includes('data-theme')),
    );
    expect(darkOnly.map((rule) => rule.selector).sort()).toEqual([
      ".gantt[data-theme='auto']",
      ".gantt[data-theme='dark']",
    ]);
  });

  it('FR-BAR-1: a bar without its own colour gets the theme colour; progress derives from it', () => {
    // `--gantt-bar-color` is declared on `.gantt`; a bar's own value (inline) wins over it.
    expect(lightTokens.has('--gantt-bar-color')).toBe(true);
    expect(valueOf('.gantt__bar-track', 'fill')).toBe('var(--gantt-bar-color)');
    expect(valueOf('.gantt__bar-milestone', 'fill')).toBe('var(--gantt-bar-color)');
    const supported = rulesFor('.gantt__bar-progress', [LAYER, SUPPORTS_COLOR_MIX]);
    const derived = supported
      .flatMap((rule) => rule.declarations)
      .find((declaration) => declaration.property === 'fill');
    expect(derived?.value).toContain('color-mix(');
    expect(derived?.value).toContain('var(--gantt-bar-color)');
    expect(derived?.value).toMatch(/^var\( ?--gantt-bar-progress-color,/);
    // The fallback for browsers without color-mix(): the shade as an overlay.
    expect(rulesFor('.gantt__bar-progress', [LAYER])[0]?.declarations).toContainEqual({
      property: 'fill-opacity',
      value: 'var(--gantt-bar-progress-shade)',
    });
  });
});

describe('styles.css: motion', () => {
  it('disables every transition and animation under prefers-reduced-motion', () => {
    const reduced = rules.filter((rule) => rule.context.includes(REDUCED_MOTION));
    expect(reduced.map((rule) => rule.selector)).toEqual(['.gantt *']);
    expect(reduced[0]?.declarations).toEqual([
      { property: 'transition', value: 'none' },
      { property: 'animation', value: 'none' },
    ]);
  });

  it('the reduced-motion rule comes last and is not out-ranked by any transition', () => {
    expect(rules.at(-1)?.context).toEqual([LAYER, REDUCED_MOTION]);
    const motion = rules.filter((rule) =>
      rule.declarations.some(({ property }) => /^(transition|animation)/.test(property)),
    );
    expect(motion.length).toBeGreaterThan(1);
    for (const rule of motion.filter((r) => !r.context.includes(REDUCED_MOTION))) {
      for (const selector of selectorsOf(rule)) {
        const [, classes] = specificity(selector);
        expect(classes, selector).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('README.md documents the sheet', () => {
  const rows = new Map(
    readme
      .split('\n')
      .map((line) => /^\|\s*`(--gantt-[\w-]+)`\s*\|(.*)\|\s*$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => {
        const cells = (match[2] ?? '').split('|').map((cell) => cell.trim().replace(/^`|`$/g, ''));
        return [match[1] ?? '', cells] as const;
      }),
  );

  it('FR-THEME-1: lists every token with its light and dark default', () => {
    for (const [name, light] of lightTokens) {
      const [documentedLight, documentedDark] = rows.get(name) ?? [];
      expect([name, documentedLight]).toEqual([name, light]);
      expect([name, documentedDark]).toEqual([name, darkTokens.get(name) ?? '—']);
    }
  });

  it('FR-THEME-1: documents no token the sheet does not declare', () => {
    // The tables also list the properties the renderer writes, which the sheet only reads.
    const known = new Set([...lightTokens.keys(), ...RENDERER_INPUTS]);
    expect([...rows.keys()].filter((name) => !known.has(name))).toEqual([]);
  });

  it('FR-THEME-1: names the structural and per-element custom properties', () => {
    for (const name of RENDERER_INPUTS) expect(readme, name).toContain(`\`${name}\``);
  });

  it('FR-THEME-5: names every class and `data-*` attribute of the contract', () => {
    for (const name of CONTRACT_CLASSES) expect(readme, name).toContain(name);
    for (const name of CONTRACT_ATTRIBUTES) expect(readme, name).toContain(name);
  });
});
