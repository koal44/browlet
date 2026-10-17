import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Legacy body and named-collection identity. */
// https://html.spec.whatwg.org/multipage/obsolete.html#frameset
// PROVISIONAL: WindowEventHandlers, rows/cols reflection, and frame layout remain unimplemented.
export class HTMLFrameSetElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLFrameSetElement : HTMLElement {};
 */
export const htmlFrameSetElementIDL = defineInterface({
  name: 'HTMLFrameSetElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFrameSetElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['frameset'],
  members: [],
});
