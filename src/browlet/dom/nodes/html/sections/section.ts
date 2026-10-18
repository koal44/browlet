import { ElementTag, ContentCategory, flowContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The section element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-section-element
export class HTMLSectionElementImpl extends HTMLElementImpl {
  static override localName = 'section';
  static {
    this.prototype.tag = ElementTag.HTMLSection;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Sectioning, ContentCategory.Palpable,
    ];
    this.prototype.contentModel = { childRules: [flowContent] };
  }
}
