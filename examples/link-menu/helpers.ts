import type { Gantt, LinkRecord, LinkType } from '@ganttlane/dom';

/** The methods of the chart that the actions of the menu call. */
export type LinkEditor = Pick<
  Gantt,
  'addLink' | 'getLink' | 'getTask' | 'removeLink' | 'updateTask'
>;

/** One custom action of the menu: its label, and what it does with the chart. */
export interface MenuAction {
  readonly label: string;
  /** Runs the action; resolves to a sentence for the status line. */
  readonly run: (editor: LinkEditor) => Promise<string>;
}

const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/** What each type of link says. */
export const TYPE_NAMES: Record<LinkType, string> = {
  FS: 'finish to start',
  SS: 'start to start',
  FF: 'finish to finish',
  SF: 'start to finish',
};

const plural = (days: number): string => `${String(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`;

/**
 * The lag of a link in words. A link without a `lag` of its own keeps the gap its tasks have, and
 * the record says what that is (`lag.days`, negative for an overlap).
 *
 * @param link - The record of a link.
 * @returns For example `'lag of 2 days'`, `'no lag'`, `'a lead of 1 day'`.
 */
export function lagText(link: LinkRecord): string {
  const days = Math.round((link.lag?.days ?? 0) * 10) / 10;
  if (days === 0) return 'no lag';
  return days > 0 ? `lag of ${plural(days)}` : `a lead of ${plural(-days)}`;
}

/** The name of a task, or its id when the chart has no task of that id. */
function nameOf(editor: LinkEditor, id: LinkRecord['source']): string {
  return editor.getTask(id)?.name ?? String(id);
}

/** Why an operation of the chart did not do what it was asked: its status, or its reason. */
function why(result: { status: string; reason?: string }): string {
  return result.reason ?? result.status;
}

/**
 * Gives a link another type. The chart has no "change the type" call: a link is added with the new
 * type, and the old one removed once that worked, so a refusal leaves the old link where it was.
 * The new link has no `lag`, so it keeps the gap that its new anchors have.
 */
async function changeType(editor: LinkEditor, link: LinkRecord, type: LinkType): Promise<string> {
  const names = `${nameOf(editor, link.source)} → ${nameOf(editor, link.target)}`;
  const added = await editor.addLink({ source: link.source, target: link.target, type });
  if (added.status !== 'created') return `${names} was not changed (${why(added)}).`;
  const removed = await editor.removeLink(link.id);
  if (removed.status !== 'deleted') return `${names}: the old link stayed (${why(removed)}).`;
  const created = editor.getLink(added.id);
  return `${names} is now ${TYPE_NAMES[type]}${created ? `, ${lagText(created)}` : ''}.`;
}

/**
 * Changes the lag of a link by moving its successor. A link with no `lag` of its own keeps whatever
 * gap there is, so the gap is changed where it lives: the successor starts a day later (or
 * earlier), and what follows it moves along.
 */
async function shiftSuccessor(editor: LinkEditor, link: LinkRecord, days: number): Promise<string> {
  const target = editor.getTask(link.target);
  if (!target?.start) return 'The successor has no bar to move.';
  // A `Date` is read through the local clock: `setDate` keeps the time of day across a DST change.
  const start = new Date(target.start);
  start.setDate(start.getDate() + days);
  const result = await editor.updateTask(link.target, { start });
  if (result.status !== 'committed') return `${target.name} was not moved (${why(result)}).`;
  const now = editor.getLink(link.id);
  return `${target.name} moved ${plural(Math.abs(days))} ${days > 0 ? 'later' : 'earlier'}${now ? `: ${lagText(now)}` : ''}.`;
}

/**
 * The custom actions of the menu of a link: one for every other type, and two for the lag. The
 * lag cannot be taken below nothing here, which keeps a finish-to-start link from overlapping.
 *
 * @param link - The record of the link the menu is about.
 * @returns The actions, in the order the menu shows them.
 */
export function actionsFor(link: LinkRecord): MenuAction[] {
  const actions: MenuAction[] = LINK_TYPES.filter((type) => type !== link.type).map((type) => ({
    label: `Make it ${TYPE_NAMES[type]}`,
    run: (editor: LinkEditor) => changeType(editor, link, type),
  }));
  actions.push({ label: 'Lag +1 day', run: (editor) => shiftSuccessor(editor, link, 1) });
  if ((link.lag?.days ?? 0) >= 1) {
    actions.push({ label: 'Lag −1 day', run: (editor) => shiftSuccessor(editor, link, -1) });
  }
  return actions;
}
