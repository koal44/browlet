import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The cite element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-cite-element
export class HTMLCiteElementImpl extends HTMLElementImpl {
  static override localName = 'cite';
  static {
    this.prototype.tag = ElementTag.HTMLCite;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
