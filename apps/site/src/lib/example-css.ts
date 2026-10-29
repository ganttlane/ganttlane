import sheets from 'virtual:example-css';

import type { Mode } from './demo-mode';

/**
 * The stylesheets of an example (`import '@ganttlane/dom/styles.css'`, `import './styles.css'`),
 * put on the page while its demo is shown.
 *
 * An example imports its stylesheets the way an application does, and that is what the examples'
 * tests and the code tabs show. On the site the same imports would be linked into the head of
 * every page that can reach a demo (the build follows dynamic imports), so the default stylesheet
 * would be on every example's page, `unstyled` included. `integrations/example-styles.ts` therefore
 * turns those imports into nothing and lists them instead (`virtual:example-css`: per example and
 * mode, the texts of the stylesheets in import order). This adds their text as `<style>` elements
 * and takes them away again when the demo is unmounted: the rules of one example, and the library's
 * own, never reach a chart that does not import them.
 */

/**
 * Adds the stylesheets the code of one mode of an example imports to the document, in import order.
 *
 * @param slug - The folder of the example.
 * @param mode - Which of its two codes the demo runs: `vanilla.ts` or `react.tsx`.
 * @returns A function that removes them.
 */
export async function addExampleCss(slug: string, mode: Mode): Promise<() => void> {
  const loaders = sheets[slug]?.[mode] ?? [];
  const texts = await Promise.all(loaders.map(async (load) => (await load()).default));
  const added = texts.map((text) => {
    const style = document.createElement('style');
    style.dataset.exampleCss = slug;
    style.textContent = text;
    document.head.append(style);
    return style;
  });
  return () => {
    for (const style of added) style.remove();
  };
}
