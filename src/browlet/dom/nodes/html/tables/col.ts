import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** The col element, exposed through HTMLTableColElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-col-element
export class HTMLColElementImpl extends HTMLElementImpl {
  static override localName = 'col';
  static {
    this.prototype.tag = ElementTag.HTMLCol;
    this.prototype.categories = [];
  }
}

/** The colgroup element, exposed through HTMLTableColElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-colgroup-element
export class HTMLColGroupElementImpl extends HTMLElementImpl {
  static override localName = 'colgroup';
  static {
    this.prototype.tag = ElementTag.HTMLColgroup;
    this.prototype.categories = [];
  }

  override canOmitStartTag(previousEndTagOmitted: boolean): boolean {
    if (this.hasStartTagAttributes()) return false;
    const first = this.nextContent(this.firstChild);
    if (!first?.isElement() || first.tag !== ElementTag.HTMLCol) return false;
    if (!previousEndTagOmitted) return true;
    const previous = this.previousContent();
    return !(previous?.isElement() && previous.tag === ElementTag.HTMLColgroup);
  }

  override canOmitEndTag(): boolean {
    return !this.startsWithWhitespaceOrComment(this.nextContent());
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTableColElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect, ReflectDefault=1, ReflectRange=(1, 1000)] attribute unsigned long span;
 *
 *   // also has obsolete members
 * };
 */
export const htmlTableColElementIDL = defineInterface({
  name: 'HTMLTableColElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [impl(HTMLColElementImpl), impl(HTMLColGroupElementImpl)],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
