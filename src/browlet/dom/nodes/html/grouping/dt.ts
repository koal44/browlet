import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** The dt element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-dt-element
export class HTMLDTElementImpl extends HTMLElementImpl {
  static override localName = 'dt';
  static {
    this.prototype.tag = ElementTag.HTMLDt;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    return next !== null && next.isElement() && (next.tag === ElementTag.HTMLDt || next.tag === ElementTag.HTMLDd);
  }
}
