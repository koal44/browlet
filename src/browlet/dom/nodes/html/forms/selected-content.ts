import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Selected-option content element identity. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmlselectedcontentelement
export class HTMLSelectedContentElementImpl extends HTMLElementImpl {}

/*
 * [Exposed=Window]
 * interface HTMLSelectedContentElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlSelectedContentElementIDL = defineInterface({
  name: 'HTMLSelectedContentElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSelectedContentElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['selectedcontent'],
  members: [ctor([], xattr('HTMLConstructor'))],
});
