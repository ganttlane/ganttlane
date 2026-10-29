import type { ChangeSet, EditRefusedPayload, TaskId } from '@ganttlane/dom';

/** What each reason of a refusal means, in words. */
const REASONS: Record<EditRefusedPayload['reason'], string> = {
  permission: 'not allowed (the editing flags, locked, or linkable)',
  busy: 'the chart is busy',
  'unknown-task': 'the task is gone',
  self: 'a task cannot depend on itself',
  cycle: 'the link would close a cycle',
  duplicate: 'the link exists',
};

/**
 * A line for the status: what `onEditRefused` reported.
 *
 * @param refusal - The payload of the event.
 * @param nameOf - The name of a task from its id.
 * @returns The line.
 */
export function refusalText(refusal: EditRefusedPayload, nameOf: (id: TaskId) => string): string {
  const { gesture, id, target, reason, at } = refusal;
  const what =
    target === undefined
      ? `${gesture} of ${nameOf(id)}`
      : `${gesture} from ${nameOf(id)} to ${nameOf(target)}`;
  // `at` says when the chart said no: as the drag was about to begin, or when it was let go.
  const when = at === 'start' ? 'at the start' : 'on release';
  return `Refused (${reason}, ${when}): ${what}, ${REASONS[reason]}.`;
}

/**
 * A line for the status: what `onTasksChange` reported.
 *
 * @param changeSet - The payload of the event.
 * @param nameOf - The name of a task from its id.
 * @returns The line.
 */
export function changeText(changeSet: ChangeSet, nameOf: (id: TaskId) => string): string {
  const names = changeSet.changes.map((change) => nameOf(change.id)).join(', ');
  return `Changed (${changeSet.reason}): ${names}.`;
}
