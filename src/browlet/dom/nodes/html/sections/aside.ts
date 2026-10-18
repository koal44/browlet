import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The aside element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-aside-element
export class HTMLAsideElementImpl extends HTMLElementImpl {
  static override localName = 'aside';
  static {
    this.prototype.tag = ElementTag.HTMLAside;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Sectioning, ContentCategory.Palpable,
    ];
  }
}
