import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Thematic-break identity used by select option traversal. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-hr-element
// PROVISIONAL: HTML construction and obsolete presentation members remain unimplemented.
export class HTMLHRElementImpl extends HTMLElementImpl {}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLHRElement : HTMLElement {};
 */
export const htmlHRElementIDL = defineInterface({
  name: 'HTMLHRElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLHRElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['hr'],
  members: [],
});
