import { attr, defineInterfaceMixin, idlType, reflect, xattr } from '../../../web-idl/core/index';

import type { ElementImpl } from './element';

/** State and behavior shared by HTML, SVG, and MathML elements. */
// https://html.spec.whatwg.org/multipage/dom.html#htmlorsvgelement
export class HTMLOrSVGOrMathMLElementMixin {
  /** Cryptographic nonce, independent of the visible content attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cryptographicnonce
  nonce = '';
  /** Element including this mixin. */
  #element: ElementImpl;

  constructor(element: ElementImpl) {
    this.#element = element;
  }

  /** Update the private nonce when its null-namespace content attribute changes. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#nonce-attributes
  attributeChanged(localName: string, value: string | null, namespace: string | null): void {
    if (namespace !== null || localName !== 'nonce') return;
    // SPEC_CLASH(nonce-empty-attribute): HTML/Firefox/WebKit clear on an empty value; Chromium retains the previous nonce.
    this.nonce = value ?? '';
  }

  /** Hide the content attribute on browsing-context connection when a header policy is present. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#nonce-attributes
  // https://html.spec.whatwg.org/multipage/infrastructure.html#becomes-browsing-context-connected
  insertionSteps(): void {
    const element = this.#element;
    const value = element.getAttributeNS(null, 'nonce');
    if (value === null || value === '') return;
    const root = element.getShadowIncludingRoot();
    if (!root.isDocument() || root.browsingContext === null ||
      !root.policyContainer.cspList?.hasHeaderDeliveredPolicy()) return;
    const nonce = this.nonce;
    element.setAttributeValue('nonce', '');
    this.nonce = nonce;
  }
}

/*
 * interface mixin HTMLOrSVGOrMathMLElement {
 *   [SameObject] readonly attribute DOMStringMap dataset;
 *   attribute DOMString nonce; // intentionally no [CEReactions]
 *
 *   [CEReactions, Reflect] attribute boolean autofocus;
 *   [CEReactions, ReflectSetter] attribute long tabIndex;
 *   undefined focus(optional FocusOptions options = {});
 *   undefined blur();
 * };
 */
export const htmlOrSVGOrMathMLElementIDL = defineInterfaceMixin({
  name: 'HTMLOrSVGOrMathMLElement',
  members: [
    attr('nonce', idlType.DOMString),
    attr('autofocus', idlType.boolean, xattr('CEReactions', reflect())),
    // TODO(HTML): §3.2.6's DOMStringMap owns dataset; §6.6 owns tabIndex, focus/blur,
    // FocusOptions, and autofocus processing beyond this reflected attribute.
  ],
});
