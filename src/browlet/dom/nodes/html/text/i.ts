import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The i element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-i-element
export class HTMLIElementImpl extends HTMLElementImpl {
  static override localName = 'i';
  static {
    this.prototype.tag = ElementTag.HTMLI;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
