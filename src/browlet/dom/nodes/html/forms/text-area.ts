import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Text-area identity used by named collections. */
// https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element
// PROVISIONAL: HTML construction, form association, reflection, editing/selection, and validation remain unimplemented.
export class HTMLTextAreaElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLTextAreaElement : HTMLElement {};
 */
export const htmlTextAreaElementIDL = defineInterface({
  name: 'HTMLTextAreaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTextAreaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['textarea'],
  members: [],
});
