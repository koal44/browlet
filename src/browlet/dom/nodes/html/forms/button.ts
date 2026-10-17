import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Button identity used by named collections. */
// https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element
// PROVISIONAL: HTML construction, form association, reflection, validation, commands, and activation remain unimplemented.
export class HTMLButtonElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLButtonElement : HTMLElement {};
 */
export const htmlButtonElementIDL = defineInterface({
  name: 'HTMLButtonElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLButtonElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['button'],
  members: [],
});
