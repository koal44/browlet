import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** Image and media source element identity. */
// https://html.spec.whatwg.org/multipage/embedded-content.html#htmlsourceelement
export class HTMLSourceElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLSource;
    this.prototype.categories = [];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLSourceElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [CEReactions, Reflect] attribute USVString srcset;
 *   [CEReactions, Reflect] attribute DOMString sizes;
 *   [CEReactions, Reflect] attribute DOMString media;
 *   [CEReactions, Reflect] attribute unsigned long width;
 *   [CEReactions, Reflect] attribute unsigned long height;
 * };
 */
export const htmlSourceElementIDL = defineInterface({
  name: 'HTMLSourceElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSourceElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['source'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
