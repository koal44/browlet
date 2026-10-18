import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Metadata identity used by named collections. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-meta-element
export class HTMLMetaElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * [Exposed=Window]
 * interface HTMLMetaElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect="http-equiv"] attribute DOMString httpEquiv;
 *   [CEReactions, Reflect] attribute DOMString content;
 *   [CEReactions, Reflect] attribute DOMString media;
 *
 *   // also has obsolete members
 * };
 */
export const htmlMetaElementIDL = defineInterface({
  name: 'HTMLMetaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMetaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['meta'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
