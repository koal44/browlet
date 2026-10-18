import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The kbd element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-kbd-element
export class HTMLKbdElementImpl extends HTMLElementImpl {
  static override localName = 'kbd';
  static {
    this.prototype.tag = ElementTag.HTMLKbd;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
