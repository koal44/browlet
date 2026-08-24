import type { TreeScopeResolver } from '../../css-engine';
import type { AttrImpl } from '../../dom/nodes/attribute';
import type { DocumentImpl } from '../../dom/nodes/document';
import { type LinkStyleInit, ElementImpl } from '../../dom/nodes/element';
import { SVG_NAMESPACE } from '../../../shared/namespaces';
import {
  defineIncludes, defineInterface,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import {
  withSVGElementStub, withSVGStyleElementStub,
} from '../../stubs/interfaces';

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
    localName: string,
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
    linkStyle?: LinkStyleInit,
  ) {
    super(
      localName,
      SVG_NAMESPACE,
      ownerDocument,
      attributes,
      linkStyle,
    );
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

/*
 * SVGElement includes ElementCSSInlineStyle;
 */
export const svgElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'SVGElement', mixin: 'ElementCSSInlineStyle',
});

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

export function isSVGElement(
  element: Element,
): element is SVGElementImpl {
  return element.namespaceURI === SVG_NAMESPACE;
}

export function isSVGStyleElement(
  element: Element,
): element is SVGStyleElementImpl {
  return isSVGElement(element) && element.localName === 'style';
}
