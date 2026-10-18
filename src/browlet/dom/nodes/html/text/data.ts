import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Machine-readable data element identity. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#htmldataelement
export class HTMLDataElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLDataElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString value;
 * };
 */
export const htmlDataElementIDL = defineInterface({
  name: 'HTMLDataElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDataElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['data'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
