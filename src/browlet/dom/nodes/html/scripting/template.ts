import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Template element identity. */
// https://html.spec.whatwg.org/multipage/scripting.html#htmltemplateelement
export class HTMLTemplateElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLTemplateElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   readonly attribute DocumentFragment content;
 *   [CEReactions] attribute DOMString shadowRootMode;
 *   [CEReactions, Reflect] attribute boolean shadowRootDelegatesFocus;
 *   [CEReactions] attribute DOMString shadowRootSlotAssignment;
 *   [CEReactions, Reflect] attribute boolean shadowRootClonable;
 *   [CEReactions, Reflect] attribute boolean shadowRootSerializable;
 *   [CEReactions, Reflect] attribute DOMString shadowRootCustomElementRegistry;
 * };
 */
export const htmlTemplateElementIDL = defineInterface({
  name: 'HTMLTemplateElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTemplateElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['template'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
