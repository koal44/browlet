import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** The del element, exposed through HTMLModElement. */
// https://html.spec.whatwg.org/multipage/edits.html#the-del-element
export class HTMLDelElementImpl extends HTMLElementImpl {
  static override localName = 'del';
}

/** The ins element, exposed through HTMLModElement. */
// https://html.spec.whatwg.org/multipage/edits.html#the-ins-element
export class HTMLInsElementImpl extends HTMLElementImpl {
  static override localName = 'ins';
}

/*
 * [Exposed=Window]
 * interface HTMLModElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString cite;
 *   [CEReactions, Reflect] attribute DOMString dateTime;
 * };
 */
export const htmlModElementIDL = defineInterface({
  name: 'HTMLModElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [impl(HTMLDelElementImpl), impl(HTMLInsElementImpl)],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
