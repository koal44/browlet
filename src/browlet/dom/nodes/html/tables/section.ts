import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The tbody element, exposed through HTMLTableSectionElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-tbody-element
export class HTMLTableBodyElementImpl extends HTMLElementImpl {
  static override localName = 'tbody';
  static {
    this.prototype.tag = ElementTag.HTMLTbody;
    this.prototype.categories = [];
  }

  override canOmitStartTag(previousEndTagOmitted: boolean): boolean {
    if (this.hasStartTagAttributes()) return false;
    const first = this.nextContent(this.firstChild);
    if (!first?.isElement() || first.tag !== ElementTag.HTMLTr) return false;
    if (!previousEndTagOmitted) return true;
    const previous = this.previousContent();
    return !(previous?.isElement() && (previous.tag === ElementTag.HTMLTbody ||
      previous.tag === ElementTag.HTMLThead || previous.tag === ElementTag.HTMLTfoot));
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && (next.tag === ElementTag.HTMLTbody || next.tag === ElementTag.HTMLTfoot);
  }
}

/** The tfoot element, exposed through HTMLTableSectionElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-tfoot-element
export class HTMLTableFootElementImpl extends HTMLElementImpl {
  static override localName = 'tfoot';
  static {
    this.prototype.tag = ElementTag.HTMLTfoot;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    return this.nextContent() === null && this.parentElement !== null;
  }
}

/** The thead element, exposed through HTMLTableSectionElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-thead-element
export class HTMLTableHeadElementImpl extends HTMLElementImpl {
  static override localName = 'thead';
  static {
    this.prototype.tag = ElementTag.HTMLThead;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    return next !== null && next.isElement() && (next.tag === ElementTag.HTMLTbody || next.tag === ElementTag.HTMLTfoot);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTableSectionElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [SameObject] readonly attribute HTMLCollection rows;
 *   HTMLTableRowElement insertRow(optional long index = -1);
 *   [CEReactions] undefined deleteRow(long index);
 *
 *   // also has obsolete members
 * };
 */
export const htmlTableSectionElementIDL = defineInterface({
  name: 'HTMLTableSectionElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [
    impl(HTMLTableBodyElementImpl),
    impl(HTMLTableFootElementImpl),
    impl(HTMLTableHeadElementImpl),
  ],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
