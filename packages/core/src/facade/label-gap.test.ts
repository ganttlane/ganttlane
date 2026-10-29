import { describe, expect, it } from 'vitest';

import { barHandles, INTERACTION_DEFAULTS, resolveHandles } from '../interaction';
import { LAYOUT_DEFAULTS, placeLabel } from '../layout';

/** A plain 20 px bar; the label placement and the handles only read its box. */
const BAR = {
  id: 'bar',
  rowIndex: 0,
  x: 100,
  y: 57,
  width: 20,
  height: 30,
  kind: 'bar',
  radius: 3,
  progressWidth: 0,
} as const;

describe('outside labels and link handles (plan step 4.5)', () => {
  it('FR-BAR-1: the layout default reach is the default link handle of the interaction module', () => {
    // `layout` cannot import `interaction` (docs/architecture.md §3.1), so the number is repeated.
    const { linkOffset, link } = INTERACTION_DEFAULTS.handles;
    expect(LAYOUT_DEFAULTS.labelHandleReach).toBe(linkOffset + link);
  });

  it('FR-BAR-1, FR-LINK-4: an outside label starts beyond the link handle, with room to spare', () => {
    const handle = barHandles(BAR).linkEnd;
    const label = placeLabel(BAR, 200, 'auto');
    expect(label?.inside).toBe(false);
    expect(label?.x).toBeGreaterThanOrEqual(handle.x + handle.width + LAYOUT_DEFAULTS.labelPadding);
  });

  it('FR-BAR-1: the reach follows custom handle sizes', () => {
    const sizes = resolveHandles({ link: 10, linkOffset: 24 });
    const handle = barHandles(BAR, sizes).linkEnd;
    const label = placeLabel(BAR, 200, 'auto', { handleReach: sizes.linkOffset + sizes.link });
    expect(label?.x).toBeGreaterThan(handle.x + handle.width);
  });
});
