import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The ruby element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-ruby-element
export class HTMLRubyElementImpl extends HTMLElementImpl {
  static override localName = 'ruby';
  static {
    this.prototype.tag = ElementTag.HTMLRuby;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}
