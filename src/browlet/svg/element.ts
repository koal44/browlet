import {
  defineElementInterface, type ElementCreationContext, ElementImpl,
  type LinkStyleInit,
} from '../dom/nodes/element';
import { SVG_NAMESPACE } from '../../shared/namespaces';
import {
  defineIncludes, defineInterface,
} from '../../web-idl/declaration/index';
import { bind } from '../../web-idl/index';
import { withSVGElementStub } from '../stubs';

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
export class SVGElementImpl
  extends withSVGElementStub(ElementImpl)
  implements SVGElement
{
  constructor(
    context: ElementCreationContext,
    linkStyle?: LinkStyleInit,
  ) {
    super(context, linkStyle);
  }

  get style(): CSSStyleDeclaration {
    return ElementImpl.getInlineStyle(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const svgElementIDL = defineInterface({
  binding: bind(SVGElementImpl),
  exposed: 'Window',
  inherits: 'Element',
  members: [],
  name: 'SVGElement',
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

export function isSVGElement(
  element: Element,
): element is SVGElementImpl {
  return element.namespaceURI === SVG_NAMESPACE;
}
