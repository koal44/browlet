import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Anchor identity used by link and named collections. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element
export class HTMLAnchorElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * [Exposed=Window]
 * interface HTMLAnchorElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString download;
 *   [CEReactions, Reflect] attribute USVString ping;
 *   [CEReactions, Reflect] attribute DOMString rel;
 *   [SameObject, PutForwards=value, Reflect="rel"] readonly attribute DOMTokenList relList;
 *
 *   [CEReactions] attribute DOMString text;
 *
 *   [CEReactions] attribute DOMString referrerPolicy;
 *
 *   // also has obsolete members
 * };
 *
 * HTMLAnchorElement includes HyperlinkElementUtils;
 * HTMLAnchorElement includes HTMLHyperlinkElementUtils;
 */
export const htmlAnchorElementIDL = defineInterface({
  name: 'HTMLAnchorElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLAnchorElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['a'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
