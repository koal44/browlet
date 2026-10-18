import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Document-body identity used by Document tree accessors. */
// https://html.spec.whatwg.org/multipage/sections.html#the-body-element
export class HTMLBodyElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLBodyElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 *
 * HTMLBodyElement includes WindowEventHandlers;
 */
export const htmlBodyElementIDL = defineInterface({
  name: 'HTMLBodyElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLBodyElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['body'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
