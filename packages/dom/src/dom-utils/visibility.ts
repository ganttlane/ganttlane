/** Elements that draw something with no text in them: markup holding one shows something. */
const SHOWS_WITHOUT_TEXT =
  'img,svg,canvas,video,iframe,hr,progress,meter,input,select,textarea,button';

/**
 * Whether markup shows nothing: no text but whitespace, and no element that draws without text
 * (an image, a rule, a control, …). Elements around nothing show nothing. It is the rule of
 * `{ html }` popover content and of the content of someone else's markup (a `DisposableNode`), so
 * that a framework that renders `<div />` is not an empty popover with a box.
 *
 * @param host - The element that holds the markup.
 * @returns `true` for nothing to see.
 */
export function showsNothing(host: Element): boolean {
  return host.textContent.trim() === '' && host.querySelector(SHOWS_WITHOUT_TEXT) === null;
}
