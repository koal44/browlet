import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The dfn element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-dfn-element
export class HTMLDFNElementImpl extends HTMLElementImpl {
  static override localName = 'dfn';
  static {
    this.prototype.tag = ElementTag.HTMLDfn;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
