import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Obsolete object-parameter element identity. */
// https://html.spec.whatwg.org/multipage/obsolete.html#htmlparamelement
export class HTMLParamElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLParam;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLParamElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute DOMString value;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [CEReactions, Reflect] attribute DOMString valueType;
 * };
 */
export const htmlParamElementIDL = defineInterface({
  name: 'HTMLParamElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLParamElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['param'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
