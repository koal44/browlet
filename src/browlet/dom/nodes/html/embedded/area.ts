import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Image-map area identity used by Document links. */
// https://html.spec.whatwg.org/multipage/image-maps.html#the-area-element
// PROVISIONAL: HTML construction, hyperlink mixins, reflection, geometry, and activation remain unimplemented.
export class HTMLAreaElementImpl extends HTMLElementImpl {}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLAreaElement : HTMLElement {};
 */
export const htmlAreaElementIDL = defineInterface({
  name: 'HTMLAreaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLAreaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['area'],
  members: [],
});
