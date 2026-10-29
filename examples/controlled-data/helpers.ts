import type { Link } from '@ganttlane/core';

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
 * Stands for your API: resolves when the server keeps the new tasks, rejects when it does not.
 *
 * @param refuse - Whether the server says no, to see a refusal.
 * @returns A promise of the answer, after a short wait.
 */
export function saveTasks(refuse: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (refuse) reject(new Error('The server refused the change'));
      else resolve();
    }, 400);
  });
}
