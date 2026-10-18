import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Line-break element identity. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#htmlbrelement
export class HTMLBRElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLBRElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlBRElementIDL = defineInterface({
  name: 'HTMLBRElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLBRElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['br'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
