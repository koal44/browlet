import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Image-map identity used by map lookup and named collections. */
// https://html.spec.whatwg.org/multipage/image-maps.html#the-map-element
// PROVISIONAL: HTML construction, name reflection, and the areas collection remain unimplemented.
export class HTMLMapElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLMapElement : HTMLElement {};
 */
export const htmlMapElementIDL = defineInterface({
  name: 'HTMLMapElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMapElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['map'],
  members: [],
});
