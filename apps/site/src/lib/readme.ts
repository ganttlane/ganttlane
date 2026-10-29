const REPOSITORY = 'https://github.com/ganttlane/ganttlane';

/** Resolves `relative` against the folder `from` (both slash-separated, repo-relative). */
function resolvePath(from: string, relative: string): string {
  const parts = from.split('/');
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

/**
 * Where a link of an example's README leads on the site. The README is written for GitHub, where
 * its links are relative to the file (`../basic/README.md`, `../../packages/dom/README.md#theme`,
 * `data.ts`); on the site they become the page of another example, the gallery, or the file on
 * GitHub.
 *
 * @param href - The link as written.
 * @param slug - The folder of the README.
 * @param base - The base of the site, with a trailing slash (`/ganttlane/`).
 * @returns The link for the site.
 */
export function siteHref(href: string, slug: string, base: string): string {
  // Absolute URLs (`https:`, `mailto:`), protocol-relative ones and fragments stay as written.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;
  const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
  const path = resolvePath(`examples/${slug}`, href.replace(/#.*$/, ''));
  const example = /^examples\/([^/]+)\/README\.md$/.exec(path);
  if (example?.[1] !== undefined) return `${base}examples/${example[1]}/${hash}`;
  if (path === 'examples/README.md') return `${base}examples/${hash}`;
  const kind = /\.[a-z0-9]+$/i.test(path) ? 'blob' : 'tree';
  return `${REPOSITORY}/${kind}/main/${path}${hash}`;
}

/**
 * The HTML of an example's README, made for the site: without its first `<h1>` (the page has the
 * title already) and with every relative link turned into a link that works here.
 *
 * @param html - The rendered README.
 * @param slug - The folder of the README.
 * @param base - The base of the site, with a trailing slash.
 * @returns The HTML.
 */
export function readmeHtml(html: string, slug: string, base: string): string {
  return html
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>\s*/, '')
    .replace(
      /(<a\b[^>]*?\shref=)"([^"]*)"/g,
      (_match, start: string, href: string) => `${start}"${siteHref(href, slug, base)}"`,
    );
}

/**
 * Splits the HTML of a README before its first `<h2>`: the introduction, which the live demo
 * follows, and the rest.
 *
 * @param html - The HTML.
 * @returns The two parts.
 */
export function splitIntro(html: string): { intro: string; rest: string } {
  const at = html.search(/<h2\b/);
  return at === -1 ? { intro: html, rest: '' } : { intro: html.slice(0, at), rest: html.slice(at) };
}
