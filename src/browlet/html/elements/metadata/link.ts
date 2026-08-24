import type { TreeScopeResolver } from '../../../style/integration';
import type { AttrImpl } from '../../../dom/nodes/attribute';
import type { DocumentImpl } from '../../../dom/nodes/document';
import { ElementImpl } from '../../../dom/nodes/element';
import { HTML_NAMESPACE } from '../../../../shared/namespaces';
import {
  defineIncludes, defineInterface,
} from '../../../../web-idl/declaration/index';
import { bind } from '../../../../web-idl/index';
import { withHTMLLinkElementStub } from '../../../stubs';
import { HTMLElementImpl } from '../html-element';

/*
 * [Exposed=Window]
 * interface HTMLLinkElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString href;
 *   [CEReactions] attribute DOMString? crossOrigin;
 *   [CEReactions, Reflect] attribute DOMString rel;
 *   [CEReactions] attribute DOMString as;
 *   [SameObject, PutForwards=value, Reflect="rel"] readonly attribute DOMTokenList relList;
 *   [CEReactions, Reflect] attribute DOMString media;
 *   [CEReactions, Reflect] attribute DOMString integrity;
 *   [CEReactions, Reflect] attribute DOMString hreflang;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList sizes;
 *   [CEReactions, Reflect] attribute USVString imageSrcset;
 *   [CEReactions, Reflect] attribute DOMString imageSizes;
 *   [CEReactions] attribute DOMString referrerPolicy;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList blocking;
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   [CEReactions] attribute DOMString fetchPriority;
 *
 *   // also has obsolete members
 * };
 * HTMLLinkElement includes LinkStyle;
 */
export class HTMLLinkElementImpl
  extends withHTMLLinkElementStub(HTMLElementImpl)
  implements HTMLLinkElement
{
  static readonly #linkStyleOptions = {
    attributes: new Set([
      'crossorigin', 'href', 'integrity', 'media', 'referrerpolicy',
      'rel', 'title', 'type',
    ]),
  };

  constructor(
    ownerDocument: DocumentImpl,
    treeScopeResolver: TreeScopeResolver,
    attributes: AttrImpl[] = [],
  ) {
    super(
      'link',
      ownerDocument,
      attributes,
      {
        options: HTMLLinkElementImpl.#linkStyleOptions,
        treeScopeResolver,
      },
    );
  }

  get sheet(): CSSStyleSheet | null {
    return ElementImpl.getStyleSheet(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const htmlLinkElementIDL = defineInterface({
  binding: bind(HTMLLinkElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLLinkElement',
});

export const htmlLinkElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLLinkElement', mixin: 'LinkStyle',
});

export function isHTMLLinkElement(
  element: Element,
): element is HTMLLinkElementImpl {
  return element.namespaceURI === HTML_NAMESPACE &&
    element.localName === 'link';
}
