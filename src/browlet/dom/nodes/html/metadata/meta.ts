import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Metadata identity used by named collections. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-meta-element
// PROVISIONAL: HTML construction, reflection, and metadata/pragma processing remain unimplemented.
export class HTMLMetaElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLMetaElement : HTMLElement {};
 */
export const htmlMetaElementIDL = defineInterface({
  name: 'HTMLMetaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMetaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['meta'],
  members: [],
});
