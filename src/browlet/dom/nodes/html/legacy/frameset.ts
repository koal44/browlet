import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** Legacy body and named-collection identity. */
// https://html.spec.whatwg.org/multipage/obsolete.html#frameset
export class HTMLFrameSetElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLFrameset;
  }

  override readonly isAllNamedElement = true;
}

/*
 * [Exposed=Window]
 * interface HTMLFrameSetElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString cols;
 *   [CEReactions, Reflect] attribute DOMString rows;
 * };
 *
 * HTMLFrameSetElement includes WindowEventHandlers;
 */
export const htmlFrameSetElementIDL = defineInterface({
  name: 'HTMLFrameSetElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFrameSetElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['frameset'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
