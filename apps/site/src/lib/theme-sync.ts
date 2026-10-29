/**
 * Makes the charts inside `host` follow the theme of the site, not `prefers-color-scheme`.
 *
 * The examples are plain user code and never set a `theme`, so their charts are `'auto'`: they
 * follow the system, and the site has a theme toggle of its own (Starlight sets `data-theme` on
 * `<html>`). This writes the site's theme to the `data-theme` of each chart root (`.gantt`) the
 * moment it appears, and again when the site's theme changes. A theme an example sets itself
 * later stays until the site's changes.
 *
 * @param host - The element the charts are drawn in.
 * @returns A function that stops it.
 */
export function syncSiteTheme(host: HTMLElement): () => void {
  const html = document.documentElement;
  const seen = new WeakSet<Element>();
  const theme = (): 'dark' | 'light' => (html.dataset.theme === 'dark' ? 'dark' : 'light');

  const apply = (force: boolean): void => {
    for (const root of host.querySelectorAll('.gantt')) {
      if (!force && seen.has(root)) continue;
      seen.add(root);
      root.setAttribute('data-theme', theme());
    }
  };

  apply(false);
  // A chart appears when an example mounts (or a React example finishes loading).
  const appeared = new MutationObserver(() => {
    apply(false);
  });
  appeared.observe(host, { childList: true, subtree: true });
  const changed = new MutationObserver(() => {
    apply(true);
  });
  changed.observe(html, { attributes: true, attributeFilter: ['data-theme'] });

  return () => {
    appeared.disconnect();
    changed.disconnect();
  };
}
