import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Button identity used by named collections. */
// https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element
export class HTMLButtonElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLButton;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Interactive, ContentCategory.Palpable,
      ContentCategory.FormAssociated, ContentCategory.Listed, ContentCategory.Labelable,
      ContentCategory.Submittable, ContentCategory.AutocapitalizeAndAutocorrectInheriting,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLButtonElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectSetter] attribute DOMString command;
 *   [CEReactions, Reflect] attribute Element? commandForElement;
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   readonly attribute HTMLFormElement? form;
 *   [CEReactions, ReflectSetter] attribute USVString formAction;
 *   [CEReactions] attribute DOMString formEnctype;
 *   [CEReactions] attribute DOMString formMethod;
 *   [CEReactions, Reflect] attribute boolean formNoValidate;
 *   [CEReactions, Reflect] attribute DOMString formTarget;
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, ReflectSetter] attribute DOMString type;
 *   [CEReactions, Reflect] attribute DOMString value;
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
 *
 * HTMLButtonElement includes PopoverTargetAttributes;
 */
export const htmlButtonElementIDL = defineInterface({
  name: 'HTMLButtonElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLButtonElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['button'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
