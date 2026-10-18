import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** The pre element, exposed through HTMLPreElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlpreelement
export class HTMLPreElementImpl extends HTMLElementImpl {
  static override localName = 'pre';
}

/** The listing element, exposed through HTMLPreElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLListingElementImpl extends HTMLElementImpl {
  static override localName = 'listing';
}

/** The xmp element, exposed through HTMLPreElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLXMPElementImpl extends HTMLElementImpl {
  static override localName = 'xmp';
}

/*
 * [Exposed=Window]
 * interface HTMLPreElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlPreElementIDL = defineInterface({
  name: 'HTMLPreElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [impl(HTMLPreElementImpl), impl(HTMLListingElementImpl), impl(HTMLXMPElementImpl)],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
