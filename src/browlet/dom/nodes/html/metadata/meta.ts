import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Metadata identity used by named collections. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-meta-element
export class HTMLMetaElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLMeta;
    this.prototype.categories = [
      ContentCategory.Metadata,
    ];
  }

  override readonly isAllNamedElement = true;

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Flow || category === ContentCategory.Phrasing) {
      return this.hasAttributeNS(null, 'itemprop');
    }
    return super.hasCategory(category);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLMetaElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect="http-equiv"] attribute DOMString httpEquiv;
 *   [CEReactions, Reflect] attribute DOMString content;
 *   [CEReactions, Reflect] attribute DOMString media;
 *
 *   // also has obsolete members
 * };
 */
export const htmlMetaElementIDL = defineInterface({
  name: 'HTMLMetaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMetaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['meta'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
