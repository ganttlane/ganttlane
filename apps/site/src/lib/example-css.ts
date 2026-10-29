/**
 * The stylesheets of an example (`examples/<slug>/*.css`: the release plan's status colours), put
 * on the page while its demo is shown.
 *
 * An example imports its stylesheet the way an application does (`import './styles.css'`), and
 * that is what the examples' tests and `pnpm dev` run. In the site's production build Astro keeps
 * track of the stylesheets of the pages it renders, and drops this one, which only the browser-side
 * module of a demo imports. So the site adds the text of the file itself (`?inline`), and takes it
 * away again when the demo is unmounted: one example's rules never reach another's chart.
 */
const stylesheets = import.meta.glob<string>('../../../../examples/*/*.css', {
  query: '?inline',
  import: 'default',
});

/**
 * Adds the stylesheets of an example to the document.
 *
 * @param slug - The folder of the example.
 * @returns A function that removes them.
 */
export async function addExampleCss(slug: string): Promise<() => void> {
  const prefix = `../../../../examples/${slug}/`;
  const added: HTMLStyleElement[] = [];
  for (const [path, load] of Object.entries(stylesheets)) {
    if (!path.startsWith(prefix)) continue;
    const style = document.createElement('style');
    style.dataset.exampleCss = slug;
    style.textContent = await load();
    document.head.append(style);
    added.push(style);
  }
  return () => {
    for (const style of added) style.remove();
  };
}
