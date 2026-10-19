import { HTML_NAMESPACE, firstStrongDirection, type TextDirection } from '../../../../../infra/index';
import { InternalError } from '../../../../../infra/internal-error';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Textarea identity and automatic directionality, pending its live-value lifecycle. */
// https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element
export class HTMLTextAreaElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLTextarea;
    this.prototype.excludeFromAutoDirection = true;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Interactive, ContentCategory.Palpable,
      ContentCategory.FormAssociated, ContentCategory.Listed, ContentCategory.Labelable,
      ContentCategory.Submittable, ContentCategory.Resettable,
      ContentCategory.AutocapitalizeAndAutocorrectInheriting,
    ];
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'placeholder'];
    this.prototype.directionalityAttributes = [...this.prototype.directionalityAttributes, 'placeholder'];
  }

  /** Current control value, independent of the default child text once the value is dirty. */
  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#concept-fe-value
  get value(): string {
    // TODO(HTML §4.10.11): Supply the raw/API value and dirty-value lifecycle.
    throw new InternalError('Textarea current value is not implemented');
  }

  protected override getAutoDirection(): TextDirection | null {
    const value = this.value;
    return value === '' ? null : firstStrongDirection(value) ?? 'ltr';
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTextAreaElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectSetter] attribute DOMString autocomplete;
 *   [CEReactions, ReflectPositiveWithFallback, ReflectDefault=20] attribute unsigned long cols;
 *   [CEReactions, Reflect] attribute DOMString dirName;
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   readonly attribute HTMLFormElement? form;
 *   [CEReactions, ReflectNonNegative] attribute long maxLength;
 *   [CEReactions, ReflectNonNegative] attribute long minLength;
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute DOMString placeholder;
 *   [CEReactions, Reflect] attribute boolean readOnly;
 *   [CEReactions, Reflect] attribute boolean required;
 *   [CEReactions, ReflectPositiveWithFallback, ReflectDefault=2] attribute unsigned long rows;
 *   [CEReactions, Reflect] attribute DOMString wrap;
 *
 *   readonly attribute DOMString type;
 *   [CEReactions] attribute DOMString defaultValue;
 *   attribute [LegacyNullToEmptyString] DOMString value;
 *   readonly attribute unsigned long textLength;
 *
 *   readonly attribute boolean willValidate;
 *   readonly attribute ValidityState validity;
 *   readonly attribute DOMString validationMessage;
 *   boolean checkValidity();
 *   boolean reportValidity();
 *   undefined setCustomValidity(DOMString error);
 *
 *   readonly attribute NodeList labels;
 *
 *   undefined select();
 *   attribute unsigned long selectionStart;
 *   attribute unsigned long selectionEnd;
 *   attribute DOMString selectionDirection;
 *   undefined setRangeText(DOMString replacement);
 *   undefined setRangeText(DOMString replacement, unsigned long start, unsigned long end, optional SelectionMode selectionMode = "preserve");
 *   undefined setSelectionRange(unsigned long start, unsigned long end, optional DOMString direction);
 * };
 */
export const htmlTextAreaElementIDL = defineInterface({
  name: 'HTMLTextAreaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTextAreaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['textarea'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
