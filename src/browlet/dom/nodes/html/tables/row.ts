import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Table-row element identity. */
// https://html.spec.whatwg.org/multipage/tables.html#htmltablerowelement
export class HTMLTableRowElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLTr;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && next.tag === ElementTag.HTMLTr;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTableRowElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   readonly attribute long rowIndex;
 *   readonly attribute long sectionRowIndex;
 *   [SameObject] readonly attribute HTMLCollection cells;
 *   HTMLTableCellElement insertCell(optional long index = -1);
 *   [CEReactions] undefined deleteCell(long index);
 *
 *   // also has obsolete members
 * };
 */
export const htmlTableRowElementIDL = defineInterface({
  name: 'HTMLTableRowElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTableRowElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['tr'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
