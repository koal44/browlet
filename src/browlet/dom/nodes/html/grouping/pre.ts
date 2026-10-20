import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The pre element, exposed through HTMLPreElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlpreelement
export class HTMLPreElementImpl extends HTMLElementImpl {
  static override localName = 'pre';
  static {
    this.prototype.tag = ElementTag.HTMLPre;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }
}

/** The listing element, exposed through HTMLPreElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLListingElementImpl extends HTMLElementImpl {
  static override localName = 'listing';
  static {
    this.prototype.tag = ElementTag.HTMLListing;
  }
}

/** The xmp element, exposed through HTMLPreElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLXMPElementImpl extends HTMLElementImpl {
  static override localName = 'xmp';
  static {
    this.prototype.tag = ElementTag.HTMLXmp;
  }
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
