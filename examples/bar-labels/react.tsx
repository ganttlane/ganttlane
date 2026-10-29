import '@ganttlane/react/styles.css';
import './styles.css';

import { type BarLabelContext, Gantt } from '@ganttlane/react';
import { useState } from 'react';

import { links, type Meta, tasks } from './data';
import { options } from './options';

const PLACEMENTS = ['auto', 'inside', 'outside', 'none'] as const;
const CONTENTS = [
  ['name', 'name (default)'],
  ['text', 'string'],
  ['avatar', 'React element'],
] as const;
type Placement = (typeof PLACEMENTS)[number];
type Content = (typeof CONTENTS)[number][0];

// The label of a bar is a React element, drawn through a portal into the bar: it sees your context
// providers and your state, and may use hooks. Keep the logic in a component.
function Label({ name, owner }: { name: string; owner: string }) {
  return (
    <span className="bar-label">
      <span className="bar-label__avatar" data-owner={owner} data-initial={owner.slice(0, 1)} />
      <span className="bar-label__name">{name}</span>
    </span>
  );
}

// A string is a ReactNode too.
const renderText = ({ name, progress }: BarLabelContext<Meta>) =>
  `${name} · ${Math.round(progress)}%`;
const renderAvatar = ({ name, task }: BarLabelContext<Meta>) => (
  <Label name={name} owner={task.data?.owner ?? ''} />
);

const NOTES: Record<Content, string> = {
  name: 'The label is the name of the task: the default.',
  text: 'A string, inserted as text: the name and the progress.',
  avatar:
    'A React element in a portal. The chart cannot measure it, so "auto" puts it inside: pick outside to see it beside the bar.',
};

export default function Example() {
  const [placement, setPlacement] = useState<Placement>(options.display.barLabel);
  const [content, setContent] = useState<Content>('name');

  // In React `tasks`, `links` and `viewMode` are controlled props, and `defaultTasks`,
  // `defaultLinks` and `defaultViewMode` are where an uncontrolled chart starts (there is no
  // `dataMode` prop).
  const { viewMode, ...rest } = options;

  return (
    <>
      <div role="toolbar">
        <label>
          Placement{' '}
          <select
            value={placement}
            onChange={(event) => {
              const next = PLACEMENTS.find((id) => id === event.target.value);
              if (next) setPlacement(next);
            }}
          >
            {PLACEMENTS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Content{' '}
          <select
            value={content}
            onChange={(event) => {
              const next = CONTENTS.find(([id]) => id === event.target.value);
              if (next) setContent(next[0]);
            }}
          >
            {CONTENTS.map(([id, caption]) => (
              <option key={id} value={id}>
                {caption}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Gantt<Meta>
        style={{ height: 390 }}
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        display={{ barLabel: placement }}
        // The same as `display.renderBarLabel`, returning a ReactNode. Not given: the name.
        renderBarLabel={
          content === 'text' ? renderText : content === 'avatar' ? renderAvatar : undefined
        }
      />
      <p>{NOTES[content]}</p>
    </>
  );
}
