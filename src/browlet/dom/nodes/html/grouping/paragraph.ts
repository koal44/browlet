import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Paragraph element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlparagraphelement
export class HTMLParagraphElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLParagraphElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlParagraphElementIDL = defineInterface({
  name: 'HTMLParagraphElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLParagraphElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['p'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
