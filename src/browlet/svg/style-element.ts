import type { AttrImpl } from '../dom/nodes/attribute';
import type { DocumentImpl } from '../dom/nodes/document';
import { ElementImpl } from '../dom/nodes/element';
import type { TreeScopeResolver } from '../style/integration';
import {
  defineIncludes, defineInterface,
} from '../../web-idl/declaration/index';
import { bind } from '../../web-idl/index';
import { withSVGStyleElementStub } from '../stubs';
import { isSVGElement, SVGElementImpl } from './element';

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
  implements SVGStyleElement
{
  static readonly #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  constructor(
    ownerDocument: DocumentImpl,
    treeScopeResolver: TreeScopeResolver,
    attributes: AttrImpl[] = [],
  ) {
    super(
      'style',
      ownerDocument,
      attributes,
      {
        options: SVGStyleElementImpl.#linkStyleOptions,
        treeScopeResolver,
      },
    );
  }

  get sheet(): CSSStyleSheet | null {
    return ElementImpl.getStyleSheet(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const svgStyleElementIDL = defineInterface({
  binding: bind(SVGStyleElementImpl),
  exposed: 'Window',
  inherits: 'SVGElement',
  members: [],
  name: 'SVGStyleElement',
});

export const svgStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'SVGStyleElement', mixin: 'LinkStyle',
});

export function isSVGStyleElement(
  element: Element,
): element is SVGStyleElementImpl {
  return isSVGElement(element) && element.localName === 'style';
}
