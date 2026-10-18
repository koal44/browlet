import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** The td element, exposed through HTMLTableCellElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-td-element
export class HTMLTableDataCellElementImpl extends HTMLElementImpl {
  static override localName = 'td';
}

/** The th element, exposed through HTMLTableCellElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-th-element
export class HTMLTableHeaderCellElementImpl extends HTMLElementImpl {
  static override localName = 'th';
}

/*
 * [Exposed=Window]
 * interface HTMLTableCellElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect, ReflectDefault=1, ReflectRange=(1, 1000)] attribute unsigned long colSpan;
 *   [CEReactions, Reflect, ReflectDefault=1, ReflectRange=(0, 65534)] attribute unsigned long rowSpan;
 *   [CEReactions, Reflect] attribute DOMString headers;
 *   readonly attribute long cellIndex;
 *
 *   [CEReactions] attribute DOMString scope; // only conforming for th elements
 *   [CEReactions, Reflect] attribute DOMString abbr;  // only conforming for th elements
 *
 *   // also has obsolete members
 * };
 */
export const htmlTableCellElementIDL = defineInterface({
  name: 'HTMLTableCellElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [impl(HTMLTableDataCellElementImpl), impl(HTMLTableHeaderCellElementImpl)],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
