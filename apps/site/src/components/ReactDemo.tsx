import {
  type ComponentType,
  type ReactElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { MODE_EVENT } from '../lib/demo-mode';
import { addExampleCss } from '../lib/example-css';
import { syncSiteTheme } from '../lib/theme-sync';

/**
 * The React side of `<Demo>`: an island (`client:only`, so it is never rendered on the server)
 * that renders the `react.tsx` of an example while its demo is in React mode. Every `react.tsx`
 * of `examples/` is a module of its own, loaded the first time its demo shows it. The toggle is
 * `demo-client.ts`'s: it sets `data-mode` on the demo and sends an event.
 */
const examples = import.meta.glob<{ default: ComponentType }>('../../../../examples/*/react.tsx');

/** Whether the demo of `slug` is in React mode now, and a way to hear when that changes. */
function useReactMode(slug: string): boolean {
  const demo = (): Element | null => document.querySelector(`[data-demo][data-slug="${slug}"]`);
  const subscribe = (notify: () => void): (() => void) => {
    const element = demo();
    element?.addEventListener(MODE_EVENT, notify);
    return () => {
      element?.removeEventListener(MODE_EVENT, notify);
    };
  };
  return useSyncExternalStore(
    subscribe,
    () => demo()?.getAttribute('data-mode') === 'react',
    () => false,
  );
}

/** Keeps the charts below it in the theme of the site. */
function Themed({ children }: { children: ReactElement }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => (host.current ? syncSiteTheme(host.current) : undefined), []);
  return <div ref={host}>{children}</div>;
}

export default function ReactDemo({ slug }: { slug: string }): ReactElement | null {
  const active = useReactMode(slug);
  // The example, once its module and its stylesheets are loaded (each time the demo is in React
  // mode: it is rendered fresh when it returns, and its stylesheets are on the page only then).
  const [Example, setExample] = useState<ComponentType | undefined>();
  useEffect(() => {
    const load = examples[`../../../../examples/${slug}/react.tsx`];
    if (!active || !load) return undefined;
    let cancelled = false;
    let removeCss: (() => void) | undefined;
    void Promise.all([load(), addExampleCss(slug)]).then(([module, remove]) => {
      if (cancelled) {
        remove();
        return;
      }
      removeCss = remove;
      setExample(() => module.default);
    });
    return () => {
      cancelled = true;
      removeCss?.();
      setExample(undefined);
    };
  }, [active, slug]);

  if (!active || !Example) return null;
  return (
    <Themed>
      <Example />
    </Themed>
  );
}
