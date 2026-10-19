import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';
import { hasExposedObjectAncestor } from './object';

/** Embed identity and exposure used by Document's named properties. */
// https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-embed-element
export class HTMLEmbedElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLEmbed;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Interactive,
      ContentCategory.Palpable,
    ];
  }

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return this.isExposed() ? 'name' : 'none';
  }

  /** Eligible for Document named access when no exposed object ancestor hides it. */
  // https://html.spec.whatwg.org/multipage/dom.html#exposed
  isExposed(): boolean {
    return !hasExposedObjectAncestor(this);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLEmbedElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [CEReactions, Reflect] attribute DOMString width;
 *   [CEReactions, Reflect] attribute DOMString height;
 *   Document? getSVGDocument();
 *
 *   // also has obsolete members
 * };
 */
export const htmlEmbedElementIDL = defineInterface({
  name: 'HTMLEmbedElement', inherits: 'HTMLElement', exposed: 'Window',
  implementation: impl(HTMLEmbedElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['embed'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
