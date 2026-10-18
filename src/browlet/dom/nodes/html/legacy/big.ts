import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** The big element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLBigElementImpl extends HTMLElementImpl {
  static override localName = 'big';
  static {
    this.prototype.tag = ElementTag.HTMLBig;
  }
}
