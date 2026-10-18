import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Ordered-list element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlolistelement
export class HTMLOListElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLOListElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute boolean reversed;
 *   [CEReactions, Reflect, ReflectDefault=1] attribute long start;
 *   [CEReactions, Reflect] attribute DOMString type;
 *
 *   // also has obsolete members
 * };
 */
export const htmlOListElementIDL = defineInterface({
  name: 'HTMLOListElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLOListElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['ol'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
