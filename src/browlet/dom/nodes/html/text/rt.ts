import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The rt element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-rt-element
export class HTMLRTElementImpl extends HTMLElementImpl {
  static override localName = 'rt';
  static {
    this.prototype.tag = ElementTag.HTMLRt;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && (next.tag === ElementTag.HTMLRt || next.tag === ElementTag.HTMLRp);
  }
}
