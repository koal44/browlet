import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Suggestion-list identity used by select option traversal. */
// https://html.spec.whatwg.org/multipage/form-elements.html#the-datalist-element
// PROVISIONAL: HTML construction, the options collection, and input suggestions remain unimplemented.
export class HTMLDataListElementImpl extends HTMLElementImpl {}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLDataListElement : HTMLElement {};
 */
export const htmlDataListElementIDL = defineInterface({
  name: 'HTMLDataListElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDataListElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['datalist'],
  members: [],
});
