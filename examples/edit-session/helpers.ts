import type { Link, SessionChanges } from '@ganttlane/dom';

/**
 * The id a link has when it has none of its own: the chart's rule, which `onLinkDelete` reports
 * the link by.
 *
 * @param link - A link of your list.
 * @returns Its id.
 */
export function linkId(link: Link): string {
  return link.id ?? `${String(link.source)}:${link.type ?? 'FS'}:${String(link.target)}`;
}

/**
 * The links after a cancelled session: drop what the session added, bring back what it removed.
 * `added` and `removed` are the chart's link models; `model.link` is your own `Link`.
 *
 * @param links - Your links now.
 * @param changes - The `links` of what the chart reports in `onEditRollback`.
 * @returns The links as they were when the session began.
 */
export function restoreLinks(
  links: readonly Link[],
  { added, removed }: SessionChanges['links'],
): Link[] {
  const dropped = new Set(removed.map((model) => model.id));
  return [
    ...links.filter((link) => !dropped.has(linkId(link))),
    ...added.flatMap((model) => model.link ?? []),
  ];
}

/**
 * Stands for your API: resolves when the server keeps the plan, rejects when it does not.
 *
 * @param refuse - Whether the server says no, to see the last saved plan come back.
 * @returns A promise of the answer, after a short wait.
 */
export function savePlan(refuse: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (refuse) reject(new Error('The server refused the plan'));
      else resolve();
    }, 400);
  });
}
