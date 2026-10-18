import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The bdo element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-bdo-element
export class HTMLBDOElementImpl extends HTMLElementImpl {
  static override localName = 'bdo';
  static {
    this.prototype.tag = ElementTag.HTMLBdo;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
