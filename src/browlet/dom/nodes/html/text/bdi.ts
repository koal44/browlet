import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The bdi element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-bdi-element
export class HTMLBDIElementImpl extends HTMLElementImpl {
  static override localName = 'bdi';
  static {
    this.prototype.tag = ElementTag.HTMLBdi;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
