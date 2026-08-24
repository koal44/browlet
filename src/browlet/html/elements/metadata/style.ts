import type { TreeScopeResolver } from '../../../style/integration';
import type { AttrImpl } from '../../../dom/nodes/attribute';
import type { DocumentImpl } from '../../../dom/nodes/document';
import { ElementImpl } from '../../../dom/nodes/element';
import { HTML_NAMESPACE } from '../../../../shared/namespaces';
import {
  defineIncludes, defineInterface,
} from '../../../../web-idl/declaration/index';
import { bind } from '../../../../web-idl/index';
import { withHTMLStyleElementStub } from '../../../stubs';
import { HTMLElementImpl } from '../html-element';

/*
 * [Exposed=Window]
 * interface HTMLStyleElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   attribute boolean disabled;
 *   [CEReactions, Reflect] attribute DOMString media;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList blocking;
 *
 *   // also has obsolete members
 * };
 * HTMLStyleElement includes LinkStyle;
 */
export class HTMLStyleElementImpl
  extends withHTMLStyleElementStub(HTMLElementImpl)
  implements HTMLStyleElement
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
        options: HTMLStyleElementImpl.#linkStyleOptions,
        treeScopeResolver,
      },
    );
  }

  get sheet(): CSSStyleSheet | null {
    return ElementImpl.getStyleSheet(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const htmlStyleElementIDL = defineInterface({
  binding: bind(HTMLStyleElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLStyleElement',
});

export const htmlStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLStyleElement', mixin: 'LinkStyle',
});

export function isHTMLStyleElement(
  element: Element,
): element is HTMLStyleElementImpl {
  return element.namespaceURI === HTML_NAMESPACE &&
    element.localName === 'style';
}
