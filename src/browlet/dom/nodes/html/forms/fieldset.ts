import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Fieldset element identity. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmlfieldsetelement
export class HTMLFieldSetElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLFieldSetElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   readonly attribute HTMLFormElement? form;
 *   [CEReactions, Reflect] attribute DOMString name;
 *
 *   readonly attribute DOMString type;
 *
 *   [SameObject] readonly attribute HTMLCollection elements;
 *
 *   readonly attribute boolean willValidate;
 *   [SameObject] readonly attribute ValidityState validity;
 *   readonly attribute DOMString validationMessage;
 *   boolean checkValidity();
 *   boolean reportValidity();
 *   undefined setCustomValidity(DOMString error);
 * };
 */
export const htmlFieldSetElementIDL = defineInterface({
  name: 'HTMLFieldSetElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFieldSetElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['fieldset'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
