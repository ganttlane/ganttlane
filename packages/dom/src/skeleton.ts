import { prefixedId } from './dom-utils';
import type { LayerSlots } from './layers/types';
import { createHtml, createSvg, px, setAttr, setCssVar } from './shared';
import { DEFAULT_STRINGS } from './strings';

/** The `theme` option: `'auto'` follows `prefers-color-scheme`, the others force a theme. */
export type ThemeOption = 'light' | 'dark' | 'auto';

/**
 * The usable part of a `theme` option: `'light'`, `'dark'` or `'auto'`; anything else is
 * `'auto'`, like every unusable option falls back to its default.
 *
 * @param theme - The option as given.
 * @returns The theme to use.
 */
export function resolveTheme(theme: unknown): ThemeOption {
  return theme === 'light' || theme === 'dark' ? theme : 'auto';
}

/**
 * The `height` option (`layout.height`, FR-SCROLL-3): a number of px, the chart is that tall and
 * scrolls inside itself; `'auto'`, the chart is as tall as its content and the page scrolls it.
 * Left out (`undefined`), the chart fills its container.
 */
export type HeightOption = number | 'auto';

/**
 * The usable part of a `height` option: a finite number above zero, or `'auto'`; anything else
 * is `undefined` (fill the container), like every unusable display option falls back.
 *
 * @param height - The option as given.
 * @returns The height to use.
 */
export function resolveHeight(height: unknown): HeightOption | undefined {
  if (height === 'auto') return height;
  return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : undefined;
}

/** Options of {@link createSkeleton}. */
export interface SkeletonOptions {
  /** Prefix of every element id. */
  readonly idPrefix: string;
  /** Value of `data-theme` on the root. */
  readonly theme: ThemeOption;
  /**
   * Accessible name of the scroller, which is a focusable region: `strings.chartLabel`, which
   * is also the default (`'Gantt chart'`).
   */
  readonly label?: string | undefined;
}

/**
 * Size of the scrolled content, in CSS px: the scroller scrolls over a sticky header of
 * `headerHeight` followed by a body of `bodyHeight`, `width` wide (`docs/architecture.md` §8).
 */
export interface ContentExtent {
  /** Width of header and body: the timeline range on the scale (`snapshot.contentWidth`). */
  readonly width: number;
  /** Height of the sticky header (`snapshot.layout.rows.headerHeight`). */
  readonly headerHeight: number;
  /** Height of the rows (`snapshot.layout.rows.bodyHeight`). */
  readonly bodyHeight: number;
}

/** The chart's DOM, empty: the root, the scroll container, the body and the layers' roots. */
export interface Skeleton extends LayerSlots {
  /** `div.gantt[data-theme]`: the element added to the container. */
  readonly root: HTMLDivElement;
  /** `div.gantt__scroller`: the single scroll container (both axes). */
  readonly scroller: HTMLDivElement;
  /** `svg.gantt__body`: the SVG that holds the grid, links, bars and overlay groups. */
  readonly body: SVGSVGElement;
  /**
   * `div.gantt__pin`: where the header sits while the height is `'auto'` (in front of the
   * scroller, sticky against the page); not in the document otherwise.
   */
  readonly pin: HTMLDivElement;
  /**
   * Sets the chart's height (FR-SCROLL-3, {@link HeightOption}): a number is
   * `--gantt-height` on the root, `'auto'` is `data-height="auto"` and moves the header out of
   * the scroller into {@link Skeleton.pin}, so that it can stick to the page, which scrolls the
   * rows (a header inside a scroller that does not scroll vertically never sticks). Any other
   * value fills the container. The same mode twice does nothing.
   */
  setHeight(height: HeightOption | undefined): void;
  /**
   * Sizes the scrolled content: writes `--gantt-content-width`, `--gantt-header-height` and
   * `--gantt-body-height` on the root (`@ganttlane/dom/styles.css` sizes the header and the body
   * from them). Cheap, and a no-op when nothing changed, so it can run on every render and
   * also inside a scroll handler, right before `scrollLeft` is compensated.
   */
  setExtent(extent: Readonly<Partial<ContentExtent>>): void;
  /**
   * Gives the scroller another accessible name (`strings.chartLabel`, FR-I18N-2); a no-op when
   * it is the same.
   */
  setLabel(label: string): void;
  /**
   * Sets `data-theme` on the root (FR-THEME-2, {@link resolveTheme}): the stylesheet does the
   * rest, so a switch costs no render. The same theme twice does nothing.
   */
  setTheme(theme: ThemeOption): void;
}

/**
 * Builds the DOM structure of `docs/architecture.md` §8 with DOM APIs (no HTML parsing), every
 * id carrying the instance prefix:
 *
 * ```
 * div.gantt[data-theme]
 *   div.gantt__scroller
 *     div.gantt__header                       (sticky top)
 *     svg.gantt__body
 *       g.gantt__grid, g.gantt__links, g.gantt__bars, g.gantt__overlay
 *   div.gantt__layer                          (popovers)
 * ```
 *
 * With an automatic height ({@link Skeleton.setHeight}) the header leaves the scroller for a
 * sticky `div.gantt__pin` in front of it (`div.gantt[data-height="auto"]`), the one other shape
 * of the tree.
 *
 * The toolbar (optional in §8) is not part of the skeleton.
 *
 * @param document - Document that owns the nodes.
 * @param options - Id prefix and theme.
 * @returns The detached tree; the caller appends `root` to its container.
 */
export function createSkeleton(document: Document, options: SkeletonOptions): Skeleton {
  const id = (name: string): string => prefixedId(options.idPrefix, name);

  const header = createHtml(document, 'div', { id: id('header'), class: 'gantt__header' });
  const grid = createSvg(document, 'g', { class: 'gantt__grid' });
  const links = createSvg(document, 'g', { class: 'gantt__links' });
  const bars = createSvg(document, 'g', { class: 'gantt__bars' });
  const overlay = createSvg(document, 'g', { class: 'gantt__overlay' });
  const body = createSvg(document, 'svg', { id: id('body'), class: 'gantt__body' });
  body.append(grid, links, bars, overlay);
  // A focusable, named region: keyboard users reach the chart and scroll it with the arrow keys
  // (Chromium and Firefox focus a scroller without focusable children by themselves, WebKit
  // does not). Bars, links and handles get their own focus stops later (roving tabindex, P1).
  const scroller = createHtml(
    document,
    'div',
    {
      id: id('scroller'),
      class: 'gantt__scroller',
      tabindex: 0,
      role: 'region',
      'aria-label': options.label ?? DEFAULT_STRINGS.chartLabel,
    },
    header,
    body,
  );
  const pin = createHtml(document, 'div', { id: id('pin'), class: 'gantt__pin' });
  const popover = createHtml(document, 'div', { id: id('layer'), class: 'gantt__layer' });
  const root = createHtml(
    document,
    'div',
    { id: options.idPrefix, class: 'gantt' },
    scroller,
    popover,
  );
  setAttr(root, 'data-theme', resolveTheme(options.theme));

  return {
    root,
    scroller,
    body,
    pin,
    header,
    grid,
    links,
    bars,
    overlay,
    popover,
    setHeight(option): void {
      const height = resolveHeight(option);
      setAttr(root, 'data-height', height === 'auto' ? 'auto' : undefined);
      setCssVar(root, '--gantt-height', typeof height === 'number' ? px(height) : undefined);
      if (height === 'auto') {
        if (header.parentElement === pin) return;
        pin.append(header);
        root.insertBefore(pin, scroller);
      } else if (header.parentElement === pin) {
        pin.remove();
        scroller.prepend(header);
      }
    },
    setExtent(extent): void {
      // Only what is given: `undefined` here means "leave it", not "remove it".
      if (extent.width !== undefined) setCssVar(root, '--gantt-content-width', px(extent.width));
      if (extent.headerHeight !== undefined) {
        setCssVar(root, '--gantt-header-height', px(extent.headerHeight));
      }
      if (extent.bodyHeight !== undefined) {
        setCssVar(root, '--gantt-body-height', px(extent.bodyHeight));
      }
    },
    setLabel(label): void {
      setAttr(scroller, 'aria-label', label);
    },
    setTheme(theme): void {
      setAttr(root, 'data-theme', resolveTheme(theme));
    },
  };
}
