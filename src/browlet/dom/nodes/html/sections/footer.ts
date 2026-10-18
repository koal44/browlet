import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The footer element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-footer-element
export class HTMLFooterElementImpl extends HTMLElementImpl {
  static override localName = 'footer';
  static {
    this.prototype.tag = ElementTag.HTMLFooter;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }
}
