import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Table element identity. */
// https://html.spec.whatwg.org/multipage/tables.html#htmltableelement
export class HTMLTableElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLTable;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTableElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions] attribute HTMLTableCaptionElement? caption;
 *   HTMLTableCaptionElement createCaption();
 *   [CEReactions] undefined deleteCaption();
 *
 *   [CEReactions] attribute HTMLTableSectionElement? tHead;
 *   HTMLTableSectionElement createTHead();
 *   [CEReactions] undefined deleteTHead();
 *
 *   [CEReactions] attribute HTMLTableSectionElement? tFoot;
 *   HTMLTableSectionElement createTFoot();
 *   [CEReactions] undefined deleteTFoot();
 *
 *   [SameObject] readonly attribute HTMLCollection tBodies;
 *   HTMLTableSectionElement createTBody();
 *
 *   [SameObject] readonly attribute HTMLCollection rows;
 *   HTMLTableRowElement insertRow(optional long index = -1);
 *   [CEReactions] undefined deleteRow(long index);
 *
 *   // also has obsolete members
 * };
 */
export const htmlTableElementIDL = defineInterface({
  name: 'HTMLTableElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTableElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['table'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
