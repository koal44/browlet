import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

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
