import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Unordered-list element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlulistelement
export class HTMLUListElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLUListElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlUListElementIDL = defineInterface({
  name: 'HTMLUListElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLUListElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['ul'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
