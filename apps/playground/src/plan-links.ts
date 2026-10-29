/**
 * The links of a page that owns them (controlled data), shared by the React pages (`react-app.tsx`,
 * `react-edit.tsx`): what to do with the list when an edit session is cancelled.
 */
import type { Link, SessionChanges } from '@ganttlane/dom';

/** The id a link has when it names none (the fixtures use the default link type, `FS`). */
const linkId = (link: Link): string =>
  link.id ?? `${String(link.source)}:${link.type ?? 'FS'}:${String(link.target)}`;

/**
 * The links of the page after a cancelled session: `rollback.links.removed` are the links to drop
 * and `added` the ones to restore (a link that changed is in both). A restored link is the
 * caller's own `Link`; one that came from `task.dependencies` has none (the fixtures have none).
 *
 * @param links - The page's links.
 * @param rollback - `links` of the `SessionChanges` that `onEditRollback` received.
 * @returns The links to pass back; `links` itself when nothing changes.
 */
export function restoreLinks(
  links: readonly Link[],
  { added, removed }: SessionChanges['links'],
): readonly Link[] {
  if (added.length === 0 && removed.length === 0) return links;
  const dropped = new Set(removed.map((model) => model.id));
  return [
    ...links.filter((link) => !dropped.has(linkId(link))),
    ...added.flatMap((model) => model.link ?? []),
  ];
}
