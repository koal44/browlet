import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Concrete dialog identity retained by Document's open-dialogs list. */
// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
// PROVISIONAL: dialog attributes, opening/closing, focus, top-layer, and close-watcher behavior await §4.11.4.
export class HTMLDialogElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLDialogElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *   [CEReactions, Reflect] attribute boolean open;
 *   attribute DOMString returnValue;
 *   [CEReactions, ReflectSetter] attribute DOMString closedBy;
 *   [CEReactions] undefined show();
 *   [CEReactions] undefined showModal();
 *   [CEReactions] undefined close(optional DOMString returnValue);
 *   [CEReactions] undefined requestClose(optional DOMString returnValue);
 * };
 */
export const htmlDialogElementIDL = defineInterface({
  name: 'HTMLDialogElement', inherits: 'HTMLElement', exposed: 'Window',
  implementation: impl(HTMLDialogElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['dialog'],
  // TODO(HTML §4.11.4): the interface currently supplies identity only; the members above remain missing.
  members: [],
});
