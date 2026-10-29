import { showsNothing } from '../../dom-utils';
import { createHtml, disposableOf } from '../../shared';
import type { DisposableNode, TooltipAction, TooltipContent } from './types';

const NO_ACTIONS: readonly never[] = Object.freeze([]);

/**
 * Renders popover content into `host` (FR-TIP-1), replacing what is there. Safe by type: a
 * string and every part of the structured form is a text node, a `Node` (or the `node` of a
 * `DisposableNode`) is appended as it is, and markup is parsed only for the explicit `{ html }`
 * form, which is the caller's responsibility (see {@link TooltipContent}). A node that is already
 * the only child of `host` stays where it is: taking it out and putting it back would lose the
 * focus and the selection in it. Disposing a `DisposableNode` is the caller's business, not this
 * function's.
 *
 * @param document - The chart's document.
 * @param host - The popover element.
 * @param content - What to show; `null` and `undefined` leave `host` empty.
 * @param menu - `true` for a menu: its buttons are `role="menuitem"`.
 * @returns The actions in the content, in order; a button's `data-action` is its index.
 */
export function fillContent<TContext>(
  document: Document,
  host: HTMLElement,
  content: TooltipContent<TContext> | null | undefined,
  menu: boolean,
): readonly TooltipAction<TContext>[] {
  if (content == null) {
    host.replaceChildren();
    return NO_ACTIONS;
  }
  const hosted = disposableOf(content);
  const form = content as Exclude<TooltipContent<TContext>, DisposableNode>;
  if (hosted !== undefined || (typeof form !== 'string' && 'nodeType' in form)) {
    const node = hosted?.node ?? (form as Node);
    // The same node as before (a framework's host, made again for new inputs) is not moved.
    if (host.firstChild !== node || host.childNodes.length !== 1) host.replaceChildren(node);
    return NO_ACTIONS;
  }
  host.replaceChildren();
  if (typeof form === 'string') {
    host.append(form);
    return NO_ACTIONS;
  }
  if ('html' in form) {
    // The one sanctioned HTML sink (FR-TIP-1): explicit `{ html }`, never a string or a field.
    // eslint-disable-next-line no-restricted-properties -- caller-supplied markup by design
    host.innerHTML = form.html;
    // Elements around nothing but whitespace show nothing: the popover is empty (FR-TIP-3).
    if (showsNothing(host)) host.replaceChildren();
    return NO_ACTIONS;
  }
  for (const part of ['title', 'subtitle', 'details'] as const) {
    const text = form[part];
    if (text?.trim()) {
      host.append(createHtml(document, 'div', { class: `gantt__popover-${part}` }, text));
    }
  }
  const actions = form.actions ?? NO_ACTIONS;
  if (actions.length > 0) {
    const role = menu ? 'menuitem' : undefined;
    const button = ({ label }: TooltipAction<TContext>, index: number): HTMLElement =>
      createHtml(
        document,
        'button',
        { type: 'button', class: 'gantt__popover-action', role, 'data-action': index },
        label,
      );
    host.append(
      createHtml(document, 'div', { class: 'gantt__popover-actions' }, ...actions.map(button)),
    );
  }
  return actions;
}

/**
 * Whether filled content shows nothing (FR-TIP-3): no element and no text but whitespace. An
 * empty popover is not shown at all.
 *
 * @param host - The popover element, after {@link fillContent}.
 * @returns `true` for nothing to show.
 */
export function isEmptyContent(host: HTMLElement): boolean {
  return host.firstElementChild === null && host.textContent.trim() === '';
}
