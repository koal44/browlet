import {
  defineElementInterface, type ElementCreationContext, ElementImpl,
} from '../dom/nodes/element';
import { SVG_NAMESPACE } from '../../infra/index';
import {
  defineIncludes, defineInterface,
} from '../../web-idl/declaration/index';
import { impl } from '../../web-idl/index';
import { withSVGStyleElementStub } from '../stubs';
import { isSVGElement, SVGElementImpl } from './element';
import type { CSSStyleSheetImpl } from '../../stylelet/cssom/css-stylesheet';

/*
 * [Exposed=Window]
 * interface SVGStyleElement : SVGElement {
 *   attribute DOMString type;
 *   attribute DOMString media;
 *   attribute DOMString title;
 *   attribute boolean disabled;
 * };
 * SVGStyleElement includes LinkStyle;
 */
export class SVGStyleElementImpl
  extends withSVGStyleElementStub(SVGElementImpl)
{
  static readonly #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  constructor(context: ElementCreationContext) {
    super(
      context,
      {
        options: SVGStyleElementImpl.#linkStyleOptions,
        treeScopeResolver: context.treeScopeResolver,
      },
    );
  }

  get sheet(): CSSStyleSheetImpl | null {
    return ElementImpl.getStyleSheet(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const svgStyleElementIDL = defineInterface({
  name: 'SVGStyleElement',
  inherits: 'SVGElement',
  exposed: 'Window',
  implementation: impl(SVGStyleElementImpl),
  members: [],
});

export const svgStyleElementInterface = defineElementInterface({
  definition: svgStyleElementIDL,
  localNames: ['style'],
  namespaceURI: SVG_NAMESPACE,
});

export const svgStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'SVGStyleElement', mixin: 'LinkStyle',
});

export function isSVGStyleElement(
  element: Element,
): element is SVGStyleElementImpl {
  return isSVGElement(element) && element.localName === 'style';
}
