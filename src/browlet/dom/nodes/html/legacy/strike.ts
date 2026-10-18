import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** The strike element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLStrikeElementImpl extends HTMLElementImpl {
  static override localName = 'strike';
  static {
    this.prototype.tag = ElementTag.HTMLStrike;
  }
}
