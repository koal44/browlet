import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The center element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLCenterElementImpl extends HTMLElementImpl {
  static override localName = 'center';
  static {
    this.prototype.tag = ElementTag.HTMLCenter;
  }
}
