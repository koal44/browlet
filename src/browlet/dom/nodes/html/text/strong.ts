import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The strong element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-strong-element
export class HTMLStrongElementImpl extends HTMLElementImpl {
  static override localName = 'strong';
  static {
    this.prototype.tag = ElementTag.HTMLStrong;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
