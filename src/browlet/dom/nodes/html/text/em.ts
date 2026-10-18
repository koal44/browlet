import { ElementTag, ContentCategory, phrasingContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The em element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-em-element
export class HTMLEmElementImpl extends HTMLElementImpl {
  static override localName = 'em';
  static {
    this.prototype.tag = ElementTag.HTMLEm;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
    this.prototype.contentModel = { childRules: [phrasingContent] };
  }
}
