import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The small element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-small-element
export class HTMLSmallElementImpl extends HTMLElementImpl {
  static override localName = 'small';
  static {
    this.prototype.tag = ElementTag.HTMLSmall;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
