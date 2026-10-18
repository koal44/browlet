import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The cite element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-cite-element
export class HTMLCiteElementImpl extends HTMLElementImpl {
  static override localName = 'cite';
  static {
    this.prototype.tag = ElementTag.HTMLCite;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
