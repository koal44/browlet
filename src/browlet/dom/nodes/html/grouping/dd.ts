import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** The dd element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-dd-element
export class HTMLDDElementImpl extends HTMLElementImpl {
  static override localName = 'dd';
  static {
    this.prototype.tag = ElementTag.HTMLDd;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && (next.tag === ElementTag.HTMLDd || next.tag === ElementTag.HTMLDt);
  }
}
