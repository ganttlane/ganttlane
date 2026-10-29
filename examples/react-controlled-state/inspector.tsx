import type { Task, TaskId } from '@ganttlane/react';
import type { ReactNode } from 'react';

import type { Field, State } from './state';

/** A value as it is written in the application's state: a `Date` and a string look different. */
function show(value: unknown): string {
  if (value instanceof Date) {
    const day = [value.getFullYear(), value.getMonth() + 1, value.getDate()]
      .map((part) => String(part).padStart(2, '0'))
      .join('-');
    return `Date(${day})`;
  }
  return JSON.stringify(value);
}

/** The second date of a task as it is stored: an `end`, or a `duration` instead. */
function endOf(task: Task): string {
  if (task.end !== undefined) return `end ${show(task.end)}`;
  if (task.duration !== undefined) return `duration ${show(task.duration)}`;
  return '';
}

function Value({
  name,
  changed,
  children,
}: {
  name: Field;
  changed: boolean;
  children: ReactNode;
}) {
  return (
    <div className="inspector__value" data-changed={changed}>
      <dt>{name}</dt>
      <dd>
        <code>{children}</code>
      </dd>
    </div>
  );
}

/**
 * The application's state, as it is right now: what the chart is given as props. The field the
 * last action changed (and the tasks a change set touched) is marked, so a drag, a click or a
 * button can be followed into the state.
 */
export function Inspector({ state, onSelect }: { state: State; onSelect: (id: TaskId) => void }) {
  const { last } = state;
  const changed = (field: Field): boolean => last.field === field;

  return (
    <div className="inspector">
      <dl className="inspector__values">
        <Value name="viewMode" changed={changed('viewMode')}>
          {show(state.viewMode)}
        </Value>
        <Value name="selectedKeys" changed={changed('selectedKeys')}>
          {show(state.selectedKeys)}
        </Value>
        <Value name="expandedKeys" changed={changed('expandedKeys')}>
          {show(state.expandedKeys)}
        </Value>
        <Value name="links" changed={changed('links')}>
          {state.links.map((link) => `${String(link.source)} → ${String(link.target)}`).join(', ')}
        </Value>
      </dl>
      <table className="inspector__tasks">
        <caption data-changed={changed('tasks')}>tasks, as stored</caption>
        <thead>
          <tr>
            <th scope="col">id</th>
            <th scope="col">start</th>
            <th scope="col">end, or duration</th>
          </tr>
        </thead>
        <tbody>
          {state.tasks.map((task) => (
            <tr
              key={task.id}
              data-changed={changed('tasks') && last.ids.includes(task.id)}
              data-selected={state.selectedKeys.includes(task.id)}
            >
              <th scope="row">
                {/* A task list of your own: the chart follows `selectedKeys`. */}
                <button
                  type="button"
                  className="inspector__pick"
                  aria-pressed={state.selectedKeys.includes(task.id)}
                  onClick={() => {
                    onSelect(task.id);
                  }}
                >
                  {task.parentId === undefined ? '' : '↳ '}
                  {task.id}
                </button>
              </th>
              <td>
                <code>{show(task.start)}</code>
              </td>
              <td>
                <code>{endOf(task)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="inspector__note">{last.note}</p>
    </div>
  );
}
