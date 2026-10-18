import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Label element identity. */
// https://html.spec.whatwg.org/multipage/forms.html#htmllabelelement
export class HTMLLabelElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLLabelElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   readonly attribute HTMLFormElement? form;
 *   [CEReactions, Reflect="for"] attribute DOMString htmlFor;
 *   readonly attribute HTMLElement? control;
 * };
 */
export const htmlLabelElementIDL = defineInterface({
  name: 'HTMLLabelElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLLabelElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['label'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
