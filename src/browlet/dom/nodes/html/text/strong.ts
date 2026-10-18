import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The strong element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-strong-element
export class HTMLStrongElementImpl extends HTMLElementImpl {
  static override localName = 'strong';
  static {
    this.prototype.tag = ElementTag.HTMLStrong;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
