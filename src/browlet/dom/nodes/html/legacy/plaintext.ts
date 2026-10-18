import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** The plaintext element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLPlainTextElementImpl extends HTMLElementImpl {
  static override localName = 'plaintext';
  static {
    this.prototype.tag = ElementTag.HTMLPlaintext;
  }
}
