import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useReducer, useRef, useState } from 'react';

import { Inspector } from './inspector';
import { options } from './options';
import { type Action, initial, reduce } from './state';

const VIEW_MODES = ['day', 'week', 'month'];

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  // The application's state: the five groups below are props of the chart, and this is where they
  // live. Any component of the application can change them (the toolbar, the inspector), and the
  // chart follows.
  const [state, dispatch] = useReducer(reduce, initial);
  // For the experiment in the toolbar: whether the reducer takes in what the chart does by itself.
  const [refuse, setRefuse] = useState(false);

  /** What the chart changed by itself (a method of the handle): your state may take it in. */
  const take = (action: Action): void => {
    if (!refuse) dispatch(action);
  };

  return (
    <>
      <div role="toolbar" aria-label="Application state">
        <label>
          View{' '}
          <select
            value={state.viewMode}
            onChange={(event) => {
              dispatch({ type: 'viewMode', id: event.target.value, by: 'the select' });
            }}
          >
            {VIEW_MODES.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'expandedKeys', keys: [], by: 'a button' });
          }}
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'expandedKeys', keys: 'all', by: 'a button' });
          }}
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'selectedKeys', keys: [], by: 'a button' });
          }}
        >
          Clear selection
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'reset' });
          }}
        >
          Reset
        </button>
      </div>
      <div role="toolbar" aria-label="The chart changes things by itself">
        <button
          type="button"
          onClick={() => {
            // A method of the handle: the chart changes the open phases itself, and tells
            // `onExpandedChange`.
            chart.current?.collapseAll();
          }}
        >
          Chart: collapseAll()
        </button>
        <label>
          <input
            type="checkbox"
            checked={refuse}
            onChange={(event) => {
              setRefuse(event.target.checked);
            }}
          />{' '}
          Refuse what the chart changes by itself
        </label>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 330 }}
        // `options` first: `viewMode` in it is only where the state starts, and the props below win.
        {...options}
        // The five controlled groups. A group is controlled when its prop is given the first time
        // the chart renders: the prop is the truth, and the chart follows it. (There is no
        // `dataMode` prop: `tasks` is what makes the data controlled.)
        tasks={state.tasks}
        links={state.links}
        viewMode={state.viewMode}
        selectedKeys={state.selectedKeys}
        expandedKeys={state.expandedKeys}
        // What the chart did by itself, for your state to take in. The view mode, the selection
        // and the open phases go back to their prop at once if your state does not follow (tick
        // the box above to see it); a task change stays a draft until you hand new tasks back,
        // and an arrow is added only when you hand back the links.
        onTasksChange={(changes) => {
          // `model` is the one the change set was computed on: the chart's current one.
          const model = chart.current?.core.getSnapshot().state.derived.model;
          if (model) dispatch({ type: 'tasks', changes, model });
        }}
        onLinksChange={(links) => {
          dispatch({ type: 'links', links });
        }}
        onViewModeChange={(viewMode) => {
          take({ type: 'viewMode', id: viewMode.id, by: 'onViewModeChange' });
        }}
        onSelectionChange={(keys) => {
          take({ type: 'selectedKeys', keys, by: 'onSelectionChange' });
        }}
        onExpandedChange={(keys) => {
          take({ type: 'expandedKeys', keys, by: 'onExpandedChange' });
        }}
        // A click on a bar selects it in the state.
        onTaskClick={(record) => {
          dispatch({ type: 'selectedKeys', keys: [record.id], by: 'onTaskClick' });
        }}
      />
      <Inspector
        state={state}
        onSelect={(id) => {
          dispatch({ type: 'selectedKeys', keys: [id], by: 'the inspector' });
        }}
      />
    </>
  );
}
