import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The nav element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-nav-element
export class HTMLNavElementImpl extends HTMLElementImpl {
  static override localName = 'nav';
  static {
    this.prototype.tag = ElementTag.HTMLNav;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Sectioning, ContentCategory.Palpable,
    ];
  }
}
