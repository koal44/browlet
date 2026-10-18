import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Document-root identity used by Document tree accessors. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-html-element
export class HTMLHtmlElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLHtmlElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlHtmlElementIDL = defineInterface({
  name: 'HTMLHtmlElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLHtmlElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['html'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
