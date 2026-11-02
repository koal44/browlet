import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineIncludes, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Legacy body and named-collection identity. */
// https://html.spec.whatwg.org/multipage/obsolete.html#frameset
export class HTMLFrameSetElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLFrameset;
    this.prototype.isAllNamedElement = true;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLFrameSetElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString cols;
 *   [CEReactions, Reflect] attribute DOMString rows;
 * };
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

/*
 * HTMLFrameSetElement includes WindowEventHandlers;
 */
export const htmlFrameSetElementIncludesWindowEventHandlersIDL = defineIncludes({
  interface: htmlFrameSetElementIDL.name,
  mixin: 'WindowEventHandlers',
});
