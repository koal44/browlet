import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The sub element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-sub-and-sup-elements
export class HTMLSubElementImpl extends HTMLElementImpl {
  static override localName = 'sub';
  static {
    this.prototype.tag = ElementTag.HTMLSub;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
