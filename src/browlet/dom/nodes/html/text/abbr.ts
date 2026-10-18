import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The abbr element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-abbr-element
export class HTMLAbbrElementImpl extends HTMLElementImpl {
  static override localName = 'abbr';
  static {
    this.prototype.tag = ElementTag.HTMLAbbr;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
