import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Description-list element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmldlistelement
export class HTMLDListElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLDListElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlDListElementIDL = defineInterface({
  name: 'HTMLDListElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDListElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['dl'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
