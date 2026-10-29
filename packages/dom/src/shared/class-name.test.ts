import { describe, expect, it } from 'vitest';

import { withClass } from './class-name';

describe('withClass', () => {
  it('FR-BAR-1, FR-ROW-3: adds the caller`s classes after the library`s own', () => {
    expect(withClass('gantt__bar', 'late')).toBe('gantt__bar late');
    expect(withClass('gantt__row', 'a b c')).toBe('gantt__row a b c');
  });

  it('trims the extra part and turns runs of whitespace into single spaces', () => {
    expect(withClass('gantt__bar', '  status-late \t urgent\n')).toBe(
      'gantt__bar status-late urgent',
    );
  });

  it('adds nothing for anything that is not a non-empty string', () => {
    for (const extra of [undefined, null, '', '   ', 3, {}, ['a']]) {
      expect(withClass('gantt__bar', extra)).toBe('gantt__bar');
    }
  });
});
