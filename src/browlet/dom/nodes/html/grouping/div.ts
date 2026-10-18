import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Division element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmldivelement
export class HTMLDivElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLDivElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlDivElementIDL = defineInterface({
  name: 'HTMLDivElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDivElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['div'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
