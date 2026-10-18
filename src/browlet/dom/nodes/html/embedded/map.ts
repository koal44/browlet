import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Image-map identity used by map lookup and named collections. */
// https://html.spec.whatwg.org/multipage/image-maps.html#the-map-element
export class HTMLMapElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * [Exposed=Window]
 * interface HTMLMapElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [SameObject] readonly attribute HTMLCollection areas;
 * };
 */
export const htmlMapElementIDL = defineInterface({
  name: 'HTMLMapElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMapElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['map'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
