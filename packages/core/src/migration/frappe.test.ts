import { describe, expect, it } from 'vitest';

import { type FrappeGanttOptions, fromFrappeGanttOptions } from './frappe';

/** A value deep-frozen, so that a write to it throws. */
function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

describe('FR-DATA-10: fromFrappeGanttOptions', () => {
  it('FR-DATA-10: turns the options that map one to one', () => {
    const { options, notes, unmapped } = fromFrappeGanttOptions({
      language: 'uk',
      bar_height: 24,
      bar_corner_radius: 6,
      container_height: 'auto',
      arrow_curve: 8,
      lines: 'horizontal',
      popup_on: 'hover',
      infinite_padding: false,
      scroll_to: 'start',
      move_dependencies: true,
      snap_at: '7d',
    });

    expect(options).toEqual({
      locale: 'uk',
      layout: { barHeight: 24, barRadius: 6, height: 'auto' },
      display: { linkCurveRadius: 8, gridLines: 'horizontal' },
      tooltip: { trigger: 'hover' },
      timeline: { infinite: false },
      scroll: { initial: 'start' },
      scheduling: { propagation: 'preserve-lag', snap: '7d' },
    });
    expect(notes).toEqual([]);
    expect(unmapped).toEqual([]);
  });

  it('FR-DATA-10: view mode names become ids', () => {
    for (const [name, id] of [
      ['Hour', 'hour'],
      ['Quarter Day', 'quarter-day'],
      ['Half Day', 'half-day'],
      ['Day', 'day'],
      ['Week', 'week'],
      ['Month', 'month'],
      ['Year', 'year'],
      ['Fortnight', 'fortnight'],
    ] as const) {
      expect(fromFrappeGanttOptions({ view_mode: name }).options).toEqual({ viewMode: id });
    }
  });

  it('FR-DATA-10: padding was the gap and rowHeight is the row, so it is added to the bar height', () => {
    const byDefault = fromFrappeGanttOptions({ padding: 18 });
    const given = fromFrappeGanttOptions({ padding: 16, bar_height: 24 });

    // frappe-gantt's own defaults, 30 + 18, are ganttlane's default row of 48.
    expect(byDefault.options).toEqual({ layout: { rowHeight: 48 } });
    expect(given.options).toEqual({ layout: { barHeight: 24, rowHeight: 40 } });
    expect(given.notes.map(({ key }) => key)).toEqual(['padding']);
    expect(given.notes[0]?.message).toContain('barHeight + padding');
  });

  it('FR-DATA-10: the two header heights make the header rows, a missing one is the default', () => {
    expect(fromFrappeGanttOptions({ upper_header_height: 50 }).options).toEqual({
      layout: { headerRowHeight: [50, 30] },
    });
    expect(fromFrappeGanttOptions({ lower_header_height: 20 }).options).toEqual({
      layout: { headerRowHeight: [45, 20] },
    });
  });

  it('FR-DATA-10: the read-only flags become the editing flags', () => {
    expect(fromFrappeGanttOptions({ readonly: true }).options).toEqual({ editing: false });
    expect(
      fromFrappeGanttOptions({ readonly: true, readonly_dates: true, readonly_progress: true })
        .options,
    ).toEqual({ editing: false });
    expect(fromFrappeGanttOptions({ readonly_dates: true }).options).toEqual({
      editing: { move: false, resize: false },
    });
    expect(fromFrappeGanttOptions({ readonly_progress: true }).options).toEqual({
      editing: { progress: false },
    });
    expect(fromFrappeGanttOptions({ readonly: false, readonly_dates: false }).options).toEqual({});
    const fixed = fromFrappeGanttOptions({ fixed_duration: true });
    expect(fixed.options).toEqual({ editing: { resize: false } });
    expect(fixed.notes[0]?.key).toBe('fixed_duration');
  });

  it('FR-DATA-10: move_dependencies false stops the links and says children still follow their parent', () => {
    const { options, notes } = fromFrappeGanttOptions({ move_dependencies: false });

    expect(options).toEqual({ scheduling: { propagation: 'none' } });
    expect(notes.map(({ key }) => key)).toEqual(['move_dependencies']);
  });

  it('FR-DATA-10: column_width is pixels per column and becomes pixels per day of the current view mode', () => {
    const week = fromFrappeGanttOptions({ view_mode: 'Week', column_width: 140 });
    const day = fromFrappeGanttOptions({ column_width: 45 });
    const quarter = fromFrappeGanttOptions({ view_mode: 'Quarter Day', column_width: 45 });

    expect(week.options).toEqual({ viewMode: 'week', viewModes: { week: { pxPerDay: 20 } } });
    expect(day.options).toEqual({ viewModes: { day: { pxPerDay: 45 } } });
    expect(quarter.options).toEqual({
      viewMode: 'quarter-day',
      viewModes: { 'quarter-day': { pxPerDay: 180 } },
    });
    expect(week.notes.map(({ key }) => key)).toEqual(['column_width']);
  });

  it('FR-DATA-10: a view mode of a preset name overrides the preset', () => {
    const { options, unmapped } = fromFrappeGanttOptions({
      view_modes: [
        'Day',
        { name: 'Week', step: '7d', column_width: 100, padding: '1m', snap_at: '1d' },
        { name: 'Month', step: '1m', column_width: 120 },
      ],
    });

    expect(options.viewModes).toEqual({
      week: { label: 'Week', pxPerDay: 14.29, padding: '1mo', snap: '1d' },
      month: { label: 'Month', pxPerDay: 3.94 },
    });
    expect(unmapped).toEqual([]);
  });

  it('FR-DATA-10: a view mode of your own is a suggestion to complete, because it needs headers', () => {
    const entry = {
      name: 'Fortnight',
      step: '14d',
      padding: '14d',
      column_width: 140,
      upper_text: () => '',
      lower_text: () => '',
    };

    const { options, unmapped } = fromFrappeGanttOptions({
      view_mode: 'Fortnight',
      view_modes: [entry],
    });

    expect(options).toEqual({ viewMode: 'fortnight' });
    expect(unmapped.map(({ key, reason }) => [key, reason])).toEqual([
      ['view_modes[0].upper_text', 'manual'],
      ['view_modes[0].lower_text', 'manual'],
      ['view_modes[0]', 'manual'],
    ]);
    // The same skeleton the guide shows: 140 px for 14 days is 10 px a day.
    expect(unmapped[2]?.suggested).toEqual({
      id: 'fortnight',
      label: 'Fortnight',
      padding: '14d',
      pxPerDay: 10,
      unit: 'day',
      step: 14,
    });
    expect(unmapped[2]?.value).toBe(entry);
  });

  it('FR-DATA-10: the functions of a preset view mode are reported, the preset keeps its headers', () => {
    const { options, unmapped } = fromFrappeGanttOptions({
      view_modes: [{ name: 'Day', step: '1d', upper_text: () => '', thick_line: () => true }],
    });

    expect(options.viewModes).toEqual({ day: { label: 'Day' } });
    expect(unmapped.map(({ key }) => key)).toEqual([
      'view_modes[0].upper_text',
      'view_modes[0].thick_line',
    ]);
  });

  it('FR-DATA-10: the switches that ganttlane reserves are off, or unsupported when on', () => {
    const off = fromFrappeGanttOptions({
      auto_move_label: false,
      show_expected_progress: false,
      today_button: false,
      view_mode_select: false,
    });
    const on = fromFrappeGanttOptions({ auto_move_label: true, today_button: true });

    expect(off.options).toEqual({
      display: { stickyBarLabels: false, expectedProgress: false },
      toolbar: false,
    });
    expect(on.options).toEqual({});
    expect(on.unmapped.map(({ key, reason }) => [key, reason])).toEqual([
      ['auto_move_label', 'unsupported'],
      ['today_button', 'unsupported'],
    ]);
  });

  it('FR-DATA-10: what has another contract is reported as manual, with where it lives now', () => {
    const options: FrappeGanttOptions = {
      popup: () => '',
      ignore: ['weekend'],
      is_weekend: () => false,
      holidays: { red: ['2026-03-04'] },
      on_click: () => undefined,
      on_double_click: () => undefined,
      on_hover: () => undefined,
      on_date_change: () => undefined,
      on_progress_change: () => undefined,
      on_view_change: () => undefined,
    };
    const result = fromFrappeGanttOptions(options);

    expect(result.options).toEqual({});
    expect(result.unmapped.map(({ key, reason }) => [key, reason])).toEqual(
      Object.keys(options).map((key) => [key, 'manual']),
    );
    expect(result.unmapped.find(({ key }) => key === 'on_click')?.message).toContain('onTaskClick');
    expect(result.unmapped.find(({ key }) => key === 'popup')?.message).toContain('tooltip.render');
    expect(result.unmapped.find(({ key }) => key === 'on_date_change')?.value).toBe(
      options.on_date_change,
    );
  });

  it('FR-DATA-10: what ganttlane does not have is removed, and says why', () => {
    const { options, unmapped } = fromFrappeGanttOptions({
      date_format: 'YYYY',
      hover_on_date: true,
      on_date_click: () => undefined,
    });

    expect(options).toEqual({});
    expect(unmapped.map(({ key, reason }) => [key, reason])).toEqual([
      ['date_format', 'removed'],
      ['hover_on_date', 'removed'],
      ['on_date_click', 'removed'],
    ]);
    expect(unmapped[0]?.message).toContain('locale');
  });

  it('FR-DATA-10: a key that is no option of frappe-gantt is unknown', () => {
    const { options, unmapped } = fromFrappeGanttOptions({ bar_hieght: 30, viewMode: 'week' });

    expect(options).toEqual({});
    expect(unmapped.map(({ key, reason, value }) => [key, reason, value])).toEqual([
      ['bar_hieght', 'unknown', 30],
      ['viewMode', 'unknown', 'week'],
    ]);
  });

  it('FR-DATA-10: a value of the wrong type is reported, never copied', () => {
    const result = fromFrappeGanttOptions({
      bar_height: '30px',
      lines: 'grid',
      popup_on: 'focus',
      container_height: '500px',
      infinite_padding: 1,
      language: 5,
      scroll_to: 3,
      view_mode: 4,
      view_modes: 'Day',
      snap_at: '30s',
      move_dependencies: 'yes',
      readonly: 'yes',
      padding: 'wide',
      upper_header_height: '45',
      column_width: 'wide',
      today_button: 1,
    } as unknown as FrappeGanttOptions);

    expect(result.options).toEqual({});
    expect(result.notes).toEqual([]);
    expect(new Set(result.unmapped.map(({ key }) => key))).toEqual(
      new Set([
        'bar_height',
        'lines',
        'popup_on',
        'container_height',
        'infinite_padding',
        'language',
        'scroll_to',
        'view_mode',
        'view_modes',
        'snap_at',
        'move_dependencies',
        'readonly',
        'padding',
        'upper_header_height',
        'column_width',
        'today_button',
      ]),
    );
    expect(result.unmapped.every(({ reason }) => reason === 'manual')).toBe(true);
  });

  it('FR-DATA-10: the defaults null (snap_at, column_width) and undefined are not given options', () => {
    const result = fromFrappeGanttOptions({
      snap_at: null,
      column_width: null,
      bar_height: undefined,
    });

    expect(result).toEqual({ options: {}, notes: [], unmapped: [] });
  });

  it('FR-DATA-10: the input is not modified and the result shares nothing with it', () => {
    const input = frozen({
      view_modes: [{ name: 'Day', step: '1d', column_width: 50 }],
      bar_height: 24,
      padding: 16,
      readonly: true,
    });

    const { options } = fromFrappeGanttOptions(input);

    expect(Object.isFrozen(options)).toBe(false);
    expect(input.view_modes[0]).toEqual({ name: 'Day', step: '1d', column_width: 50 });
  });

  it('FR-DATA-10: input that is no options object is reported, and nothing throws', () => {
    for (const input of [undefined, null, 'week', 5, [] as never]) {
      const result = fromFrappeGanttOptions(input as never);
      expect(result.options).toEqual({});
      expect(result.unmapped.map(({ key, reason }) => [key, reason])).toEqual([['', 'unknown']]);
    }
  });
});
