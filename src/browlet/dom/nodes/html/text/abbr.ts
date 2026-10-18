import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The abbr element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-abbr-element
export class HTMLAbbrElementImpl extends HTMLElementImpl {
  static override localName = 'abbr';
  static {
    this.prototype.tag = ElementTag.HTMLAbbr;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
