import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Menu-list element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlmenuelement
export class HTMLMenuElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLMenuElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlMenuElementIDL = defineInterface({
  name: 'HTMLMenuElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMenuElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['menu'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
