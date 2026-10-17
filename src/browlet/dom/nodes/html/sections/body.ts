import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Document-body identity used by Document tree accessors. */
// https://html.spec.whatwg.org/multipage/sections.html#the-body-element
// PROVISIONAL: HTML construction, WindowEventHandlers, and obsolete presentation members remain unimplemented.
export class HTMLBodyElementImpl extends HTMLElementImpl {}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLBodyElement : HTMLElement {};
 */
export const htmlBodyElementIDL = defineInterface({
  name: 'HTMLBodyElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLBodyElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['body'],
  members: [],
});
