import { describe, expect, it } from 'vitest';

import { diffOptions, equalData, modesOf, splitProps } from './options';

describe('equalData', () => {
  it('FR-REACT-1: identical values are equal, including NaN and the two zeros apart', () => {
    const object = { a: 1 };
    expect(equalData(object, object)).toBe(true);
    expect(equalData('x', 'x')).toBe(true);
    expect(equalData(Number.NaN, Number.NaN)).toBe(true);
    expect(equalData(0, -0)).toBe(false);
    expect(equalData(undefined, null)).toBe(false);
    expect(equalData(1, '1')).toBe(false);
  });

  it('FR-REACT-1: arrays, plain objects and dates are compared by their data', () => {
    expect(equalData([0, 6], [0, 6])).toBe(true);
    expect(equalData([0, 6], [0, 5])).toBe(false);
    expect(equalData([0, 6], [0, 6, 1])).toBe(false);
    expect(equalData([], {})).toBe(false);
    expect(equalData({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(equalData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(equalData({ a: undefined }, { b: undefined })).toBe(false);
    expect(equalData(new Date(5), new Date(5))).toBe(true);
    expect(equalData(new Date(5), new Date(6))).toBe(false);
    expect(equalData(new Date(5), 5)).toBe(false);
    expect(equalData(Object.create(null), {})).toBe(true);
  });

  it('FR-REACT-1: functions, class instances and maps are equal only when identical', () => {
    const fn = (): void => undefined;
    class Rule {
      constructor(readonly day: number) {}
    }
    expect(equalData(fn, fn)).toBe(true);
    expect(
      equalData(
        () => undefined,
        () => undefined,
      ),
    ).toBe(false);
    expect(equalData({ f: fn }, { f: fn })).toBe(true);
    expect(equalData(new Rule(1), new Rule(1))).toBe(false);
    expect(equalData(new Map(), new Map())).toBe(false);
    expect(equalData({ rule: new Rule(1) }, { rule: new Rule(1) })).toBe(false);
  });

  it('FR-REACT-1: very deep values are compared by identity past a limit, never by recursion without end', () => {
    const deep = (n: number): unknown => (n === 0 ? 1 : { next: deep(n - 1) });
    expect(equalData(deep(3), deep(3))).toBe(true);
    expect(equalData(deep(40), deep(40))).toBe(false);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const other: Record<string, unknown> = {};
    other.self = other;
    expect(equalData(cycle, other)).toBe(false);
  });
});

describe('splitProps', () => {
  it('FR-REACT-1: the options keep their keys, the functions called on<Event> are the handlers', () => {
    const onTaskClick = (): void => undefined;
    const { options, handlers } = splitProps({
      locale: 'uk',
      scheduling: { snap: '1h' },
      onTaskClick,
      onIssues: onTaskClick,
      onSomething: 'not a function',
      once: 1,
    });

    expect(options).toEqual({
      locale: 'uk',
      scheduling: { snap: '1h' },
      // A handler that is no function stays an option, for the core to report.
      onSomething: 'not a function',
      once: 1,
    });
    expect(handlers).toEqual({ onTaskClick, onIssues: onTaskClick });
  });

  it('FR-REACT-1: the controlled pairs, the creation-only option and the container props are no options', () => {
    const { options, handlers } = splitProps({
      tasks: [],
      defaultTasks: [],
      links: [],
      defaultLinks: [],
      onLinksChange: () => undefined,
      viewMode: 'day',
      defaultViewMode: 'day',
      expandedKeys: 'all',
      defaultExpandedKeys: 'all',
      selectedKeys: [],
      defaultSelectedKeys: [],
      renderer: {},
      dataMode: 'controlled',
      className: 'c',
      style: {},
      locale: 'en',
    });

    expect(options).toEqual({ locale: 'en' });
    expect(handlers).toEqual({});
  });
});

describe('modesOf', () => {
  it('FR-REACT-1: a group is controlled when its value is given, also as null or an empty list', () => {
    expect(modesOf({})).toEqual({
      tasks: false,
      links: false,
      viewMode: false,
      expandedKeys: false,
      selectedKeys: false,
    });
    expect(
      modesOf({
        tasks: [],
        links: undefined,
        viewMode: 'week',
        expandedKeys: 'all',
        selectedKeys: [],
        defaultLinks: [],
      }),
    ).toEqual({
      tasks: true,
      links: false,
      viewMode: true,
      expandedKeys: true,
      selectedKeys: true,
    });
  });
});

describe('diffOptions', () => {
  it('FR-REACT-1: nothing changed is nothing to send', () => {
    const calendar = { weekends: [0, 6] };
    const tasks = [{ id: 1 }];

    expect(diffOptions({ locale: 'en', calendar, tasks }, { locale: 'en', calendar, tasks })).toBe(
      undefined,
    );
    expect(diffOptions({}, {})).toBe(undefined);
  });

  it('FR-REACT-1: options written inline are equal while their data is', () => {
    const prev = {
      locale: 'en',
      calendar: { weekends: [0, 6], holidays: [{ date: '2026-03-04', name: 'Day' }] },
      tooltip: { delay: 100, placement: 'top' },
      highlights: [{ id: 'h', dates: ['2026-03-04'] }],
    };
    const next = {
      locale: 'en',
      calendar: { weekends: [0, 6], holidays: [{ date: '2026-03-04', name: 'Day' }] },
      tooltip: { delay: 100, placement: 'top' },
      highlights: [{ id: 'h', dates: ['2026-03-04'] }],
    };

    expect(diffOptions(prev, next)).toBe(undefined);
  });

  it('FR-REACT-1: only the keys that changed are sent', () => {
    expect(diffOptions({ locale: 'en', theme: 'light' }, { locale: 'uk', theme: 'light' })).toEqual(
      {
        locale: 'uk',
      },
    );
    expect(diffOptions({ locale: 'en' }, { locale: 'en', theme: 'dark' })).toEqual({
      theme: 'dark',
    });
  });

  it('FR-REACT-1: a removed option goes back to its default', () => {
    expect(diffOptions({ locale: 'uk', theme: 'dark' }, { theme: 'dark' })).toEqual({
      locale: undefined,
    });
    expect(diffOptions({ tooltip: { delay: 1 } }, {})).toEqual({ tooltip: undefined });
  });

  it('FR-REACT-1: a group is sent by field, the way setOptions merges it', () => {
    expect(
      diffOptions(
        { scheduling: { granularity: '1h', propagation: 'none' } },
        { scheduling: { granularity: '1h', propagation: 'preserve-lag' } },
      ),
    ).toEqual({ scheduling: { propagation: 'preserve-lag' } });
    // A field the next props do not have is a field to reset: setOptions would keep it.
    expect(
      diffOptions(
        { scheduling: { granularity: '1h', propagation: 'none' } },
        { scheduling: { granularity: '1h' } },
      ),
    ).toEqual({ scheduling: { propagation: undefined } });
    // A field of a group that was not there before.
    expect(diffOptions({}, { layout: { rowHeight: 30, height: 200 } })).toEqual({
      layout: { rowHeight: 30, height: 200 },
    });
    // The group goes: each of its fields is back to its default, and only those.
    expect(diffOptions({ layout: { rowHeight: 30, height: 200 } }, {})).toEqual({
      layout: { rowHeight: undefined, height: undefined },
    });
    expect(diffOptions({ layout: { rowHeight: 30 } }, { layout: undefined })).toEqual({
      layout: { rowHeight: undefined },
    });
  });

  it('FR-REACT-1: a group that is dropped is sent by field, so that fields the props never had survive', () => {
    // `hierarchy.expandedKeys` is the chart's own (uncontrolled): `hierarchy: undefined` would reset it.
    const patch = diffOptions({ hierarchy: { moveChildren: 'none' } }, {});

    expect(patch).toEqual({ hierarchy: { moveChildren: undefined } });
    expect(patch?.hierarchy).not.toHaveProperty('expandedKeys');
    // An empty group, or one that was never there, is nothing to send.
    expect(diffOptions({ hierarchy: {} }, {})).toBe(undefined);
    expect(diffOptions({ hierarchy: {} }, { hierarchy: undefined })).toBe(undefined);
    expect(diffOptions({}, { hierarchy: undefined })).toBe(undefined);
  });

  it('FR-REACT-1: a value that is no group is still sent whole, for the core to report', () => {
    expect(diffOptions({ hierarchy: { moveChildren: 'none' } }, { hierarchy: 'bad' })).toEqual({
      hierarchy: 'bad',
    });
    // A bad value that goes away is put back to the default as a whole: there are no fields to go by.
    expect(diffOptions({ hierarchy: 'bad' }, {})).toEqual({ hierarchy: undefined });
  });

  it('FR-REACT-1: display and strings merge by field too; tooltip, linkMenu and lists go whole', () => {
    expect(
      diffOptions({ display: { today: false, gridLines: 'none' } }, { display: { today: false } }),
    ).toEqual({ display: { gridLines: undefined } });
    expect(
      diffOptions({ strings: { chartLabel: 'A' } }, { strings: { chartLabel: 'B', today: 'T' } }),
    ).toEqual({ strings: { chartLabel: 'B', today: 'T' } });
    expect(
      diffOptions({ tooltip: { delay: 1, placement: 'top' } }, { tooltip: { delay: 2 } }),
    ).toEqual({
      tooltip: { delay: 2 },
    });
    expect(diffOptions({ calendar: { weekends: [0] } }, { calendar: { weekends: [6] } })).toEqual({
      calendar: { weekends: [6] },
    });
    expect(diffOptions({ highlights: [{ id: 'a' }] }, { highlights: [] })).toEqual({
      highlights: [],
    });
  });

  it('FR-REACT-1: every group setOptions merges is diffed by field', () => {
    for (const group of [
      'calendar',
      'dates',
      'scheduling',
      'hierarchy',
      'layout',
      'timeline',
      'scroll',
      'interaction',
      'display',
      'strings',
    ]) {
      expect(diffOptions({ [group]: { a: 1, b: 2 } }, { [group]: { a: 1, b: 3 } })).toEqual({
        [group]: { b: 3 },
      });
    }
  });

  it('FR-REACT-1: tasks and links are compared by identity, never by their content', () => {
    const tasks = [{ id: 1 }];

    expect(diffOptions({ tasks }, { tasks })).toBe(undefined);
    expect(diffOptions({ tasks }, { tasks: [{ id: 1 }] })).toEqual({ tasks: [{ id: 1 }] });
    const links = [{ source: 1, target: 2 }];
    expect(diffOptions({ links }, { links: [...links] })).toEqual({ links });
  });

  it('FR-REACT-1: a group that stops being an object is sent whole', () => {
    expect(diffOptions({ scheduling: { snap: '1h' } }, { scheduling: false })).toEqual({
      scheduling: false,
    });
  });
});
