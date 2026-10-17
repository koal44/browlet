import { SVG_NAMESPACE } from '../../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../../web-idl/index';
import type { CSSStyleDeclarationImpl } from '../../../../stylelet/index';

import { ElementImpl } from '../element';
import { HTMLOrSVGOrMathMLElementMixin, htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';

/** Base implementation for elements in the SVG namespace. */
// https://svgwg.org/svg2-draft/types.html#InterfaceSVGElement
export class SVGElementImpl extends ElementImpl {
  /** Common HTML, SVG, and MathML state and attribute behavior. */
  #htmlOrSVGOrMathMLElementMixin = new HTMLOrSVGOrMathMLElementMixin(this);

  static is(value: unknown): value is SVGElementImpl {
    return value instanceof SVGElementImpl;
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
  protected override cloningSteps(copy: SVGElementImpl, subtree: boolean): void {
    super.cloningSteps(copy, subtree);
    copy.nonce = this.nonce;
  }
}

/*
 * [Exposed=Window]
 * interface SVGElement : Element {
 *   [SameObject] readonly attribute SVGAnimatedString className;
 *
 *   readonly attribute SVGSVGElement? ownerSVGElement;
 *   readonly attribute SVGElement? viewportElement;
 * };
 * SVGElement includes GlobalEventHandlers;
 * SVGElement includes SVGElementInstance;
 * SVGElement includes HTMLOrSVGOrMathMLElement;
 */
export const svgElementIDL = defineInterface({
  name: 'SVGElement',
  inherits: 'Element',
  exposed: 'Window',
  implementation: impl(SVGElementImpl),
  namespaceURI: SVG_NAMESPACE,
  members: [],
});

/*
 * SVGElement includes ElementCSSInlineStyle;
 */
export const svgElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'SVGElement', mixin: 'ElementCSSInlineStyle',
});

/*
 * SVGElement includes HTMLOrSVGOrMathMLElement;
 */
export const svgElementIncludesHTMLOrSVGOrMathMLElementIDL = defineIncludes({
  interface: 'SVGElement', mixin: htmlOrSVGOrMathMLElementIDL.name,
});
