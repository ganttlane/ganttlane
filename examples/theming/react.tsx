import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt } from '@ganttlane/react';
import { useEffect, useRef, useState } from 'react';

import { links, tasks } from './data';
import { options, type PresetId, presets } from './options';

const THEMES = ['auto', 'light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const isTheme = (value: string | null | undefined): value is Theme =>
  THEMES.some((theme) => theme === value);

export default function Example() {
  const root = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>(options.theme);
  const [presetId, setPresetId] = useState<PresetId>('default');
  const preset = presets.find(({ id }) => id === presetId) ?? presets[0];

  // The `theme` prop is the `data-theme` attribute of the chart's root, `div.gantt`. Read it back
  // rather than trusting the select: a page may set the attribute itself (this site does, to keep
  // every chart in its own theme), and then the select should show what the chart has.
  useEffect(() => {
    const host = root.current;
    if (!host) return undefined;
    const observer = new MutationObserver(() => {
      const attribute = host.querySelector('.gantt')?.getAttribute('data-theme');
      if (isTheme(attribute)) setTheme(attribute);
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  // In React, `viewMode`, `tasks` and `links` are controlled props, and `hierarchy.expandedKeys`
  // is a prop of its own; `defaultViewMode`, `defaultTasks` and `defaultLinks` are where an
  // uncontrolled chart starts, so they are passed explicitly. There is no `dataMode` prop.
  const { viewMode, ...rest } = options;

  return (
    <div ref={root}>
      <div role="toolbar">
        <label>
          Theme{' '}
          <select
            value={theme}
            onChange={(event) => {
              const next = event.target.value;
              if (isTheme(next)) setTheme(next);
            }}
          >
            {THEMES.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Palette and density{' '}
          <select
            value={presetId}
            onChange={(event) => {
              const next = presets.find(({ id }) => id === event.target.value);
              if (next) setPresetId(next.id);
            }}
          >
            {presets.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Gantt
        style={{ height: 330 }}
        // The preset is an attribute of the container; `styles.css` selects `[data-preset] .gantt`.
        data-preset={presetId}
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        theme={theme}
        // The density has a second half that is not a token: the size of rows and bars.
        layout={preset.layout}
      />
      <p>
        data-theme=&quot;{theme}&quot; · {preset.note}
      </p>
    </div>
  );
}
