import { HTML_NAMESPACE } from '../../../shared/namespaces';
import {
  defineElementInterface, type ElementCreationContext,
} from '../../dom/nodes/element';
import { defineInterface } from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import { withHTMLUnknownElementStub } from '../../stubs';
import { HTMLElementImpl } from './html-element';

/*
 * [Exposed=Window]
 * interface HTMLUnknownElement : HTMLElement {
 *   // Note: intentionally no [HTMLConstructor]
 * };
 */
export class HTMLUnknownElementImpl
  extends withHTMLUnknownElementStub(HTMLElementImpl)
  implements HTMLUnknownElement
{
  constructor(context: ElementCreationContext) {
    super(context);
  }
}

// -- Web IDL ------------------------------------------------------------

export const htmlUnknownElementIDL = defineInterface({
  binding: bind(HTMLUnknownElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLUnknownElement',
});

export const htmlUnknownElementInterface = defineElementInterface({
  definition: htmlUnknownElementIDL,
  namespaceURI: HTML_NAMESPACE,
});
