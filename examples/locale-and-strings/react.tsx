import '@ganttlane/react/styles.css';

import { Gantt } from '@ganttlane/react';
import { useEffect, useRef, useState } from 'react';

import { links, tasks } from './data';
import { locales, options } from './options';
import { wordings } from './strings';

const VIEW_MODES = ['day', 'week', 'month'];

export default function Example() {
  const root = useRef<HTMLDivElement>(null);
  const [locale, setLocale] = useState<string>(options.locale);
  const [wordingId, setWordingId] = useState(wordings[0].id);
  // `viewMode` is controlled by its prop: the chart shows the one your state holds.
  const [viewMode, setViewMode] = useState<string>(options.viewMode);
  const [label, setLabel] = useState('Gantt chart'); // English until the observer hears of another
  const wording = wordings.find(({ id }) => id === wordingId) ?? wordings[0];

  // The accessible name of the chart is one of the strings (`chartLabel`): read it from the DOM, as
  // a screen reader does. It changes in the frame after the prop does.
  useEffect(() => {
    const host = root.current;
    if (!host) return undefined;
    const observer = new MutationObserver(() => {
      setLabel(host.querySelector('.gantt__scroller')?.getAttribute('aria-label') ?? '');
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={root}>
      <div role="toolbar">
        <label>
          Locale{' '}
          <select value={locale} onChange={(event) => setLocale(event.target.value)}>
            {locales.map(([tag, name]) => (
              <option key={tag} value={tag}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Strings{' '}
          <select value={wordingId} onChange={(event) => setWordingId(event.target.value)}>
            {wordings.map(({ id, label: text }) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          View{' '}
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value)}>
            {VIEW_MODES.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Gantt
        style={{ height: 360 }}
        // In React `tasks`, `links` and `viewMode` are controlled props, and `defaultTasks` and
        // `defaultLinks` are where an uncontrolled chart starts (there is no `dataMode` prop).
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        viewMode={viewMode}
        // Dates and numbers: the header, and the dates and numbers of the tooltip.
        locale={locale}
        // What the chart says. A prop is merged key by key and one that goes away is reset, so
        // switching to a smaller set puts English back for the keys it leaves out.
        strings={wording.strings}
      />
      <p>
        locale: {locale} · strings: {wording.label} · aria-label: “{label}” · weeks start on Monday
        in every locale
      </p>
    </div>
  );
}
