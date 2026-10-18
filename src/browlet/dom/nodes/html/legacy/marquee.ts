import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Obsolete marquee element identity. */
// https://html.spec.whatwg.org/multipage/obsolete.html#htmlmarqueeelement
export class HTMLMarqueeElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLMarqueeElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString behavior;
 *   [CEReactions, Reflect] attribute DOMString bgColor;
 *   [CEReactions, Reflect] attribute DOMString direction;
 *   [CEReactions, Reflect] attribute DOMString height;
 *   [CEReactions, Reflect] attribute unsigned long hspace;
 *   [CEReactions] attribute long loop;
 *   [CEReactions, Reflect, ReflectDefault=6] attribute unsigned long scrollAmount;
 *   [CEReactions, Reflect, ReflectDefault=85] attribute unsigned long scrollDelay;
 *   [CEReactions, Reflect] attribute boolean trueSpeed;
 *   [CEReactions, Reflect] attribute unsigned long vspace;
 *   [CEReactions, Reflect] attribute DOMString width;
 *
 *   undefined start();
 *   undefined stop();
 * };
 */
export const htmlMarqueeElementIDL = defineInterface({
  name: 'HTMLMarqueeElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMarqueeElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['marquee'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
