import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Obsolete font element identity. */
// https://html.spec.whatwg.org/multipage/obsolete.html#htmlfontelement
export class HTMLFontElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLFont;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLFontElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute [LegacyNullToEmptyString] DOMString color;
 *   [CEReactions, Reflect] attribute DOMString face;
 *   [CEReactions, Reflect] attribute DOMString size;
 * };
 */
export const htmlFontElementIDL = defineInterface({
  name: 'HTMLFontElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFontElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['font'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
