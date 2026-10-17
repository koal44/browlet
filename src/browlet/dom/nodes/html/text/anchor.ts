import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Anchor identity used by link and named collections. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element
// PROVISIONAL: HTML construction, hyperlink mixins, reflection, and activation remain unimplemented.
export class HTMLAnchorElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLAnchorElement : HTMLElement {};
 */
export const htmlAnchorElementIDL = defineInterface({
  name: 'HTMLAnchorElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLAnchorElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['a'],
  members: [],
});
