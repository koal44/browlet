import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The header element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-header-element
export class HTMLHeaderElementImpl extends HTMLElementImpl {
  static override localName = 'header';
  static {
    this.prototype.tag = ElementTag.HTMLHeader;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }
}
