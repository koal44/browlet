import { MATHML_NAMESPACE } from '../../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../../web-idl/index';
import type { CSSStyleDeclarationImpl } from '../../../../stylelet/index';

import { defineElementInterface, ElementImpl } from '../element';
import { HTMLOrSVGOrMathMLElementMixin, htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';

/** Base implementation for elements in the MathML namespace. */
// https://w3c.github.io/mathml-core/#dom-mathmlelement
export class MathMLElementImpl extends ElementImpl {
  /** Common HTML, SVG, and MathML state and attribute behavior. */
  #htmlOrSVGOrMathMLElementMixin = new HTMLOrSVGOrMathMLElementMixin(this);

  static is(value: unknown): value is MathMLElementImpl {
    return value instanceof MathMLElementImpl;
  }

  /** Cryptographic nonce exposed to script, independently of the content attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#dom-noncedelement-nonce
  get nonce(): string { return this.#htmlOrSVGOrMathMLElementMixin.nonce; }
  set nonce(value: string) { this.#htmlOrSVGOrMathMLElementMixin.nonce = value; }

  get style(): CSSStyleDeclarationImpl {
    return this.getInlineStyle();
  }

  override attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null,
    namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, newValue, namespace);
    this.#htmlOrSVGOrMathMLElementMixin.attributeChanged(localName, newValue, namespace);
  }

  protected override insertionSteps(): void {
    super.insertionSteps();
    this.#htmlOrSVGOrMathMLElementMixin.insertionSteps();
  }

  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#nonce-attributes
  protected override cloningSteps(copy: MathMLElementImpl, subtree: boolean): void {
    super.cloningSteps(copy, subtree);
    copy.nonce = this.nonce;
  }
}

/*
 * [Exposed=Window]
 * interface MathMLElement : Element { };
 * MathMLElement includes GlobalEventHandlers;
 * MathMLElement includes HTMLOrSVGOrMathMLElement;
 */
export const mathMLElementIDL = defineInterface({
  name: 'MathMLElement',
  inherits: 'Element',
  exposed: 'Window',
  implementation: impl(MathMLElementImpl),
  members: [],
});

export const mathMLElementInterface = defineElementInterface({
  definition: mathMLElementIDL,
  namespaceURI: MATHML_NAMESPACE,
});

/*
 * MathMLElement includes ElementCSSInlineStyle;
 */
export const mathMLElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'MathMLElement', mixin: 'ElementCSSInlineStyle',
});

/*
 * MathMLElement includes HTMLOrSVGOrMathMLElement;
 */
// SPEC_CLASH(mathml-nonce): follow HTML/WebKit; Chromium's attribute hooks are incomplete and Firefox lacks the IDL property.
export const mathMLElementIncludesHTMLOrSVGOrMathMLElementIDL = defineIncludes({
  interface: 'MathMLElement', mixin: htmlOrSVGOrMathMLElementIDL.name,
});
