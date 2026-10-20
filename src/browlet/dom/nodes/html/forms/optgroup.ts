import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Optgroup identity used by the options collection's add operation. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmloptgroupelement
export class HTMLOptGroupElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLOptgroup;
    this.prototype.categories = [];
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'label'];
    this.prototype.directionalityAttributes = [...this.prototype.directionalityAttributes, 'label'];
  }

  static is(value: unknown): value is HTMLOptGroupElementImpl {
    return value instanceof HTMLOptGroupElementImpl;
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && (next.tag === ElementTag.HTMLOptgroup || next.tag === ElementTag.HTMLHr);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLOptGroupElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   [CEReactions, Reflect] attribute DOMString label;
 * };
 */
export const htmlOptGroupElementIDL = defineInterface({
  name: 'HTMLOptGroupElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLOptGroupElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['optgroup'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
