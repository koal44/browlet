import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Calculation-output element identity. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmloutputelement
export class HTMLOutputElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLOutputElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [SameObject, PutForwards=value, Reflect="for"] readonly attribute DOMTokenList htmlFor;
 *   readonly attribute HTMLFormElement? form;
 *   [CEReactions, Reflect] attribute DOMString name;
 *
 *   readonly attribute DOMString type;
 *   [CEReactions] attribute DOMString defaultValue;
 *   [CEReactions] attribute DOMString value;
 *
 *   readonly attribute boolean willValidate;
 *   readonly attribute ValidityState validity;
 *   readonly attribute DOMString validationMessage;
 *   boolean checkValidity();
 *   boolean reportValidity();
 *   undefined setCustomValidity(DOMString error);
 *
 *   readonly attribute NodeList labels;
 * };
 */
export const htmlOutputElementIDL = defineInterface({
  name: 'HTMLOutputElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLOutputElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['output'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
