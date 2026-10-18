import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The wbr element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-wbr-element
export class HTMLWBRElementImpl extends HTMLElementImpl {
  static override localName = 'wbr';
  static {
    this.prototype.tag = ElementTag.HTMLWbr;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing,
    ];
  }
}
