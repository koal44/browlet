import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Disclosure element identity. */
// https://html.spec.whatwg.org/multipage/interactive-elements.html#htmldetailselement
export class HTMLDetailsElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLDetailsElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute boolean open;
 * };
 */
export const htmlDetailsElementIDL = defineInterface({
  name: 'HTMLDetailsElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDetailsElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['details'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
