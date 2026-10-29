import type { EditRefusedPayload, Link, LinkRecord, LinkType, TaskId } from '@ganttlane/dom';

/** The types a link can have; the chart's default for new ones is `'FS'`. */
export const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/** `Design → API (FS)`: a link as a line of text, from its ends and its type. */
export function linkText(
  link: Pick<Link | LinkRecord, 'source' | 'target' | 'type'>,
  nameOf: (id: TaskId) => string,
): string {
  return `${nameOf(link.source)} → ${nameOf(link.target)} (${link.type ?? 'FS'})`;
}

/** Why a link was not drawn, in words (`onEditRefused` reasons that a link gesture can have). */
const REASONS: Record<EditRefusedPayload['reason'], string> = {
  permission: 'one of the tasks cannot be linked',
  busy: 'the chart is busy',
  'unknown-task': 'the task is gone',
  self: 'a task cannot depend on itself',
  cycle: 'it would close a cycle',
  duplicate: 'that link exists already',
};

/**
 * A line for the status: what `onEditRefused` reported.
 *
 * @param refusal - The payload of the event.
 * @param nameOf - The name of a task from its id.
 * @returns The line.
 */
export function refusalText(refusal: EditRefusedPayload, nameOf: (id: TaskId) => string): string {
  const { gesture, id, target, reason } = refusal;
  const ends = target === undefined ? nameOf(id) : `${nameOf(id)} → ${nameOf(target)}`;
  return `Refused (${reason}): ${gesture} ${ends}: ${REASONS[reason]}.`;
}
