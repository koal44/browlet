import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The search element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-search-element
export class HTMLSearchElementImpl extends HTMLElementImpl {
  static override localName = 'search';
  static {
    this.prototype.tag = ElementTag.HTMLSearch;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }
}
