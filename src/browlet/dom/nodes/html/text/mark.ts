import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The mark element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-mark-element
export class HTMLMarkElementImpl extends HTMLElementImpl {
  static override localName = 'mark';
  static {
    this.prototype.tag = ElementTag.HTMLMark;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
