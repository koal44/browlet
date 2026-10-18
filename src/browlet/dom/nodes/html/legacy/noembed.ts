import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** The noembed element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLNoEmbedElementImpl extends HTMLElementImpl {
  static override localName = 'noembed';
  static {
    this.prototype.tag = ElementTag.HTMLNoembed;
  }
}
