import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Legacy frame identity used by named collections. */
// https://html.spec.whatwg.org/multipage/obsolete.html#frame
// PROVISIONAL: Attribute reflection, child navigation, and contentWindow/contentDocument remain unimplemented.
export class HTMLFrameElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;
}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface HTMLFrameElement : HTMLElement {};
 */
export const htmlFrameElementIDL = defineInterface({
  name: 'HTMLFrameElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFrameElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['frame'],
  members: [],
});
