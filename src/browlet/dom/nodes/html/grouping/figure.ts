import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The figure element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-figure-element
export class HTMLFigureElementImpl extends HTMLElementImpl {
  static override localName = 'figure';
  static {
    this.prototype.tag = ElementTag.HTMLFigure;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }
}
