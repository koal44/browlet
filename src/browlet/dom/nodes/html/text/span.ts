import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Span element identity. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#htmlspanelement
export class HTMLSpanElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLSpanElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlSpanElementIDL = defineInterface({
  name: 'HTMLSpanElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSpanElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['span'],
  members: [ctor([], xattr('HTMLConstructor'))],
});
