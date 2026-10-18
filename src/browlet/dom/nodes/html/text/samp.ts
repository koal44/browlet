import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The samp element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-samp-element
export class HTMLSampElementImpl extends HTMLElementImpl {
  static override localName = 'samp';
  static {
    this.prototype.tag = ElementTag.HTMLSamp;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
