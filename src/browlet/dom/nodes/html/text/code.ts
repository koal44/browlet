import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The code element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-code-element
export class HTMLCodeElementImpl extends HTMLElementImpl {
  static override localName = 'code';
  static {
    this.prototype.tag = ElementTag.HTMLCode;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
