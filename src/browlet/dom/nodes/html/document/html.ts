import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Document-root identity used by Document tree accessors. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-html-element
// PROVISIONAL: HTML construction and obsolete version reflection await the element API.
export class HTMLHtmlElementImpl extends HTMLElementImpl {}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLHtmlElement : HTMLElement {};
 */
export const htmlHtmlElementIDL = defineInterface({
  name: 'HTMLHtmlElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLHtmlElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['html'],
  members: [],
});
