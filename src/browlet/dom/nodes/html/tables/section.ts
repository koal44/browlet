import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** The tbody element, exposed through HTMLTableSectionElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-tbody-element
export class HTMLTableBodyElementImpl extends HTMLElementImpl {
  static override localName = 'tbody';
}

/** The tfoot element, exposed through HTMLTableSectionElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-tfoot-element
export class HTMLTableFootElementImpl extends HTMLElementImpl {
  static override localName = 'tfoot';
}

/** The thead element, exposed through HTMLTableSectionElement. */
// https://html.spec.whatwg.org/multipage/tables.html#the-thead-element
export class HTMLTableHeadElementImpl extends HTMLElementImpl {
  static override localName = 'thead';
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
