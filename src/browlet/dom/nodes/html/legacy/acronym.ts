import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The acronym element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLAcronymElementImpl extends HTMLElementImpl {
  static override localName = 'acronym';
  static {
    this.prototype.tag = ElementTag.HTMLAcronym;
  }
}
