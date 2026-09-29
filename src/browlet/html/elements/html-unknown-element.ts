import { HTML_NAMESPACE } from '../../../infra/index';
import { defineElementInterface } from '../../dom/nodes/element';
import { defineInterface, impl } from '../../../web-idl/index';
import { HTMLElementImpl } from './html-element';

/** Represents an unrecognized HTML element name. */
// https://html.spec.whatwg.org/multipage/dom.html#htmlunknownelement
export class HTMLUnknownElementImpl extends HTMLElementImpl {
  static is(value: unknown): value is HTMLUnknownElementImpl {
    return value instanceof HTMLUnknownElementImpl;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLUnknownElement : HTMLElement {
 *   // Note: intentionally no [HTMLConstructor]
 * };
 */
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
