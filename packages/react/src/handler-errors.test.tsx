import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListenerTracker } from './testing';
import {
  cleanUpDocument,
  createManualFrames,
  renderInto,
  stubScrollerSize,
  trackListeners,
} from './testing';
import { collect, Harness } from './testing/harness';
import type { GanttReactOptions } from './types';

/**
 * Handlers of the application that throw while React commits: the first events (held back until
 * the commit, `onIssues` for the first options, `onRangeChange` of the mount) and the events a prop
 * change causes (`setOptions` runs in the commit too). Nothing may be thrown into React: with
 * React 18 in a DOM environment (happy-dom), an error thrown from a layout effect escapes the
 * commit and fails every `act` after it ("Should not already be working"). Each error goes where
 * the core sends a listener's error (ADR-025): `onError` (`source: 'listener'`, the event's name),
 * and without a listener of `error` the host's unhandled-rejection channel, outside the commit.
 */

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];

let tracker: ListenerTracker;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

/** What the chart hands to the host's unhandled-rejection channel, kept from the test runner. */
function captureReports(): unknown[] {
  const reports: unknown[] = [];
  vi.spyOn(Promise, 'reject').mockImplementation((reason) => {
    reports.push(reason);
    return new Promise<never>(() => undefined);
  });
  return reports;
}

function options(extra: Partial<GanttReactOptions> = {}): GanttReactOptions {
  return {
    defaultTasks: TASKS,
    now: () => '2026-03-04',
    renderer: { frames: createManualFrames() },
    ...extra,
  };
}

const failure = (message: string): (() => never) => {
  return () => {
    throw new Error(message);
  };
};

describe('useGantt: the first events, when a handler throws', () => {
  it('FR-EVT-1: every handler that throws reaches onError with its event name, the others still run, nothing is thrown', async () => {
    const { capture } = collect();
    const onIssues = vi.fn(failure('issues'));
    const onRangeChange = vi.fn(failure('range'));
    const onError = vi.fn<NonNullable<GanttReactOptions['onError']>>();
    const onTaskClick = vi.fn();

    // Not caught: a render that throws fails the test.
    const view = await renderInto(
      <Harness
        options={options({
          tooltip: { trigger: 'nope' as never },
          onIssues,
          onRangeChange,
          onError,
          onTaskClick,
        })}
        capture={capture}
      />,
    );

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls.map(([payload]) => payload)).toEqual([
      { error: new Error('issues'), source: 'listener', name: 'issues' },
      { error: new Error('range'), source: 'listener', name: 'rangeChange' },
    ]);
    await view.unmount();
  });

  it('FR-EVT-1: a listener of error added with instance.on hears them too, and so does onError', async () => {
    const { capture, latest } = collect();
    const onError = vi.fn<NonNullable<GanttReactOptions['onError']>>();
    const view = await renderInto(
      <Harness
        options={options({ onError, tooltip: { trigger: 'nope' as never } })}
        capture={capture}
      />,
    );
    const heard = vi.fn<(payload: unknown) => void>();
    latest().on('error', heard);
    expect(onError).not.toHaveBeenCalled();

    // A later change of the options: `onIssues` throws while the commit applies it.
    await view.render(
      <Harness
        options={options({
          onError,
          onIssues: failure('issues'),
          tooltip: { trigger: 'nope2' as never },
        })}
        capture={capture}
      />,
    );

    const expected = { error: new Error('issues'), source: 'listener', name: 'issues' };
    expect(onError.mock.calls.map(([payload]) => payload)).toEqual([expected]);
    expect(heard.mock.calls.map(([payload]) => payload)).toEqual([expected]);
    await view.unmount();
  });

  it('FR-EVT-1: without a listener of error they are rethrown outside the commit, the way the core does (ADR-025)', async () => {
    const reports = captureReports();
    const { capture } = collect();
    const onRangeChange = vi.fn(failure('range'));

    const view = await renderInto(
      <Harness
        options={options({
          tooltip: { trigger: 'nope' as never },
          onIssues: failure('issues'),
          onRangeChange,
        })}
        capture={capture}
      />,
    );

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    // Together, as the core reports the errors of one operation.
    expect(reports).toHaveLength(1);
    expect(reports[0]).toBeInstanceOf(AggregateError);
    expect((reports[0] as AggregateError).errors).toEqual([
      new Error('issues'),
      new Error('range'),
    ]);
    await view.unmount();
  });

  it('FR-EVT-1: one error is reported as it is', async () => {
    const reports = captureReports();
    const { capture } = collect();

    const view = await renderInto(
      <Harness options={options({ onRangeChange: failure('range') })} capture={capture} />,
    );

    expect(reports).toEqual([new Error('range')]);
    await view.unmount();
  });

  it('FR-EVT-1: an onError that throws is not lost either, and does not stop the others', async () => {
    const reports = captureReports();
    const { capture } = collect();
    const onError = vi.fn(failure('onError'));
    const onRangeChange = vi.fn(failure('range'));

    const view = await renderInto(
      <Harness
        options={options({
          tooltip: { trigger: 'nope' as never },
          onIssues: failure('issues'),
          onRangeChange,
          onError,
        })}
        capture={capture}
      />,
    );

    // Both events reached it, and what it threw about each is reported.
    expect(onError).toHaveBeenCalledTimes(2);
    expect(reports).toHaveLength(1);
    expect((reports[0] as AggregateError).errors).toEqual([
      new Error('onError'),
      new Error('onError'),
    ]);
    await view.unmount();
  });
});

describe('useGantt: a prop change, when a handler throws', () => {
  it('FR-EVT-1: the handler of an event the new options cause reaches onError, nothing is thrown', async () => {
    const { capture } = collect();
    const onError = vi.fn<NonNullable<GanttReactOptions['onError']>>();
    const onRangeChange = vi.fn();
    const view = await renderInto(
      <Harness options={options({ tasks: TASKS, onError, onRangeChange })} capture={capture} />,
    );
    onRangeChange.mockClear();
    onRangeChange.mockImplementation(failure('range'));

    // New tasks reach far past the range: the range changes and `rangeChange` is emitted.
    await view.render(
      <Harness
        options={options({
          tasks: [...TASKS, { id: 'far', name: 'Far', start: '2027-03-01', end: '2027-03-05' }],
          onError,
          onRangeChange,
        })}
        capture={capture}
      />,
    );

    expect(onRangeChange).toHaveBeenCalled();
    expect(onError.mock.calls.map(([payload]) => payload)).toEqual(
      onRangeChange.mock.calls.map(() => ({
        error: new Error('range'),
        source: 'listener',
        name: 'rangeChange',
      })),
    );
    expect(onError).toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-EVT-1: the issues of the renderer’s options, which the core has no event for, reach onError too', async () => {
    const { capture } = collect();
    const onError = vi.fn<NonNullable<GanttReactOptions['onError']>>();
    const onIssues = vi.fn();
    const view = await renderInto(
      <Harness options={options({ onError, onIssues })} capture={capture} />,
    );
    expect(onIssues).not.toHaveBeenCalled();
    onIssues.mockImplementation(failure('issues'));

    await view.render(
      <Harness
        options={options({ onError, onIssues, tooltip: { trigger: 'nope' as never } })}
        capture={capture}
      />,
    );

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls.map(([payload]) => payload)).toEqual([
      { error: new Error('issues'), source: 'listener', name: 'issues' },
    ]);
    await view.unmount();
  });

  it('FR-EVT-1: without a listener of error it is rethrown outside the commit, and the chart goes on', async () => {
    const reports = captureReports();
    const { capture, latest } = collect();
    const onIssues = vi.fn();
    const view = await renderInto(<Harness options={options({ onIssues })} capture={capture} />);
    onIssues.mockImplementation(failure('issues'));

    await view.render(
      <Harness
        options={options({ onIssues, tooltip: { trigger: 'nope' as never }, locale: 'uk' })}
        capture={capture}
      />,
    );

    expect(reports).toEqual([new Error('issues')]);
    // The rest of the change was applied.
    expect(latest().getSnapshot().header.locale).toBe('uk');
    await view.unmount();
  });
});
