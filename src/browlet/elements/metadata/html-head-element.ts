import type { AttrImpl } from '../../dom/nodes/attribute';
import type { DocumentImpl } from '../../dom/nodes/document';
import { defineInterface } from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import { withHTMLHeadElementStub } from '../../stubs/interfaces';
import { HTMLElementImpl } from '../html-element';

/*
 * [Exposed=Window]
 * interface HTMLHeadElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export class HTMLHeadElementImpl
  extends withHTMLHeadElementStub(HTMLElementImpl)
  implements HTMLHeadElement
{
  constructor(
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super('head', ownerDocument, attributes);
  }
}

// -- Web IDL ------------------------------------------------------------

export const htmlHeadElementIDL = defineInterface({
  binding: bind(HTMLHeadElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLHeadElement',
});
