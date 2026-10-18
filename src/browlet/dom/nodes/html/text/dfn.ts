import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The dfn element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-dfn-element
export class HTMLDFNElementImpl extends HTMLElementImpl {
  static override localName = 'dfn';
  static {
    this.prototype.tag = ElementTag.HTMLDfn;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
