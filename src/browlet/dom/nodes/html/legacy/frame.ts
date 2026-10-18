import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** Legacy frame identity used by named collections. */
// https://html.spec.whatwg.org/multipage/obsolete.html#frame
export class HTMLFrameElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLFrame;
  }

  override readonly isAllNamedElement = true;
}

/*
 * [Exposed=Window]
 * interface HTMLFrameElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute DOMString scrolling;
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute DOMString frameBorder;
 *   [CEReactions, ReflectURL] attribute USVString longDesc;
 *   [CEReactions, Reflect] attribute boolean noResize;
 *   readonly attribute Document? contentDocument;
 *   readonly attribute WindowProxy? contentWindow;
 *
 *   [CEReactions, Reflect] attribute [LegacyNullToEmptyString] DOMString marginHeight;
 *   [CEReactions, Reflect] attribute [LegacyNullToEmptyString] DOMString marginWidth;
 * };
 */
export const htmlFrameElementIDL = defineInterface({
  name: 'HTMLFrameElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFrameElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['frame'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
