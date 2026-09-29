import { defineElementInterface, ElementImpl } from '../dom/nodes/element';
import { SVG_NAMESPACE } from '../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../web-idl/index';
import type { CSSStyleDeclarationImpl } from '../../stylelet/index';

/** Base implementation for elements in the SVG namespace. */
// https://svgwg.org/svg2-draft/types.html#InterfaceSVGElement
export class SVGElementImpl extends ElementImpl {
  static is(value: unknown): value is SVGElementImpl {
    return value instanceof SVGElementImpl;
  }

  get style(): CSSStyleDeclarationImpl {
    return this.getInlineStyle();
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
 * SVGElement includes HTMLOrSVGElement;
 */
export const svgElementIDL = defineInterface({
  name: 'SVGElement',
  inherits: 'Element',
  exposed: 'Window',
  implementation: impl(SVGElementImpl),
  members: [],
});

export const svgElementInterface = defineElementInterface({
  definition: svgElementIDL,
  namespaceURI: SVG_NAMESPACE,
});

/*
 * SVGElement includes ElementCSSInlineStyle;
 */
export const svgElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'SVGElement', mixin: 'ElementCSSInlineStyle',
});
