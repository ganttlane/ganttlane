import type { ChangeSet, EditRefusedPayload, GanttOptions, TaskId } from '@ganttlane/dom';

import { frozen } from './data';

/** What `onBeforeTaskChange` does, by the rule the select picks. */
export type Rule = 'allow' | 'veto' | 'modify' | 'ask';

/** The rules, for the select. */
export const RULES: readonly { readonly id: Rule; readonly label: string }[] = [
  { id: 'allow', label: 'Let everything through' },
  { id: 'veto', label: 'Veto changes to finished work' },
  { id: 'modify', label: 'Rewrite: progress at most 80%' },
  { id: 'ask', label: 'Ask first (answers later)' },
];

/** The most progress the `'modify'` rule lets a drag give a task. */
const CAP = 80;

/** What the hooks need from the example around them. Reads are current: they are made when asked. */
export interface HookEnv {
  /** The rule of the select. */
  readonly rule: Rule;
  /** Whether the link hook refuses links into the frozen Release group (the checkbox). */
  readonly refuseLinks: boolean;
  /** The name of a task from its id. */
  nameOf(id: TaskId): string;
  /** A new action starts: the lines of the status begin again. */
  begin(): void;
  /** One more line of the status. */
  say(text: string): void;
  /** Shows a question with Approve and Reject, and resolves with the answer (later). */
  ask(question: string): Promise<boolean>;
}

/**
 * The two before-hooks. A hook may answer at once or later (a promise), and the answer is
 * `true` (go on), `false` (cancel) or, for a change, a `ChangeSet` that replaces the one being
 * committed. While a promise is pending the chart is busy: the user's gestures and the
 * programmatic calls are refused until the answer comes.
 *
 * @param env - The example's state and its way of talking to the page.
 * @returns The options to give to the chart.
 */
export function createHooks(
  env: HookEnv,
): Pick<GanttOptions, 'onBeforeTaskChange' | 'onBeforeLinkCreate'> {
  /** Asks the question and says so when the answer is no; resolves with the answer. */
  const confirm = async (question: string, onNo: string): Promise<boolean> => {
    const approved = await env.ask(question);
    if (!approved) env.say(onNo);
    return approved;
  };

  return {
    // Before a drag or `updateTask` is committed: `changeSet` has every task it moves, with
    // `before` and `after` values; `reason` says what made it (`'move'`, `'progress'`, `'api'`, …).
    onBeforeTaskChange: ({ changeSet, reason }) => {
      env.begin();
      switch (env.rule) {
        case 'veto':
          // A change set that touches finished work, directly or through a link, is cancelled.
          if (changeSet.changes.some((change) => change.before.progress === 100)) {
            env.say('The hook said no: finished work does not change.');
            return false;
          }
          return true;
        case 'modify': {
          // Answering with a change set replaces the one being committed (it is checked again).
          const capped = capProgress(changeSet);
          if (capped === undefined) return true;
          env.say(`The hook rewrote the change: progress stops at ${CAP}%.`);
          return capped;
        }
        case 'ask': {
          // A promise: the commit waits for it, and the chart is busy meanwhile.
          const names = changeSet.changes.map((change) => env.nameOf(change.id)).join(', ');
          return confirm(
            `Apply this ${reason} of ${names}?`,
            'You said no: the change is cancelled.',
          );
        }
        case 'allow':
          return true;
      }
    },

    // Before a link is created, by a drag or by `addLink`: `link`, its `id`, and
    // `wouldCreateCycle`, which only explains: a cycle is refused whatever the hook says.
    onBeforeLinkCreate: ({ link }) => {
      env.begin();
      if (env.refuseLinks && frozen.has(link.target)) {
        env.say(
          `The hook refused the link: ${env.nameOf(link.target)} is frozen and takes no new dependency.`,
        );
        return false;
      }
      if (env.rule === 'ask') {
        const question = `Create the link ${env.nameOf(link.source)} → ${env.nameOf(link.target)}?`;
        return confirm(question, 'You said no: the link is not created.');
      }
      return true;
    },
  };
}

/**
 * The change set with the progress of every task that a drag raised past the cap lowered to it.
 *
 * @param changeSet - The change set being committed.
 * @returns A new change set, or `undefined` when nothing needs lowering.
 */
function capProgress(changeSet: ChangeSet): ChangeSet | undefined {
  const raised = ({ before, after }: ChangeSet['changes'][number]): boolean =>
    after.progress > CAP && after.progress > before.progress;
  if (!changeSet.changes.some(raised)) return undefined;
  return {
    ...changeSet,
    changes: changeSet.changes.map((change) =>
      raised(change) ? { ...change, after: { ...change.after, progress: CAP } } : change,
    ),
  };
}

/** A line for the status: what `onEditRefused` reported. */
export function refusalText(refusal: EditRefusedPayload, nameOf: (id: TaskId) => string): string {
  const { gesture, id, reason } = refusal;
  return reason === 'busy'
    ? `Refused (busy): ${gesture} of ${nameOf(id)}. The chart waits for the answer to a hook.`
    : `Refused (${reason}): ${gesture} of ${nameOf(id)}.`;
}
