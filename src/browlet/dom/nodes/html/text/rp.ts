import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The rp element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-rp-element
export class HTMLRPElementImpl extends HTMLElementImpl {
  static override localName = 'rp';
  static {
    this.prototype.tag = ElementTag.HTMLRp;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && (next.tag === ElementTag.HTMLRt || next.tag === ElementTag.HTMLRp);
  }
}
