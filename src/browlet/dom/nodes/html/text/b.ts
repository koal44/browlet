import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The b element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-b-element
export class HTMLBElementImpl extends HTMLElementImpl {
  static override localName = 'b';
  static {
    this.prototype.tag = ElementTag.HTMLB;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
