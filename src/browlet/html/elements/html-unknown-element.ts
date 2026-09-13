import { HTML_NAMESPACE } from '../../../infra/index';
import { defineElementInterface } from '../../dom/nodes/element';
import { defineInterface, impl } from '../../../web-idl/index';
import { withHTMLUnknownElementStub } from '../../stubs';
import { HTMLElementImpl } from './html-element';

/*
 * [Exposed=Window]
 * interface HTMLUnknownElement : HTMLElement {
 *   // Note: intentionally no [HTMLConstructor]
 * };
 */
export class HTMLUnknownElementImpl
  extends withHTMLUnknownElementStub(HTMLElementImpl) {}

// -- Web IDL ------------------------------------------------------------

export const htmlUnknownElementIDL = defineInterface({
  name: 'HTMLUnknownElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLUnknownElementImpl),
  members: [],
});

export const htmlUnknownElementInterface = defineElementInterface({
  definition: htmlUnknownElementIDL,
  namespaceURI: HTML_NAMESPACE,
});
