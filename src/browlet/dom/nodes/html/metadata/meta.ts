import { HTML_NAMESPACE } from '../../../../../infra/index';
import { InternalError } from '../../../../../infra/internal-error';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Metadata identity used by named collections. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-meta-element
export class HTMLMetaElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLMeta;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Metadata,
    ];
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Flow || category === ContentCategory.Phrasing) {
      return this.hasAttributeNS(null, 'itemprop');
    }
    return super.hasCategory(category);
  }

  protected override isDirectionalityCapableAttributeName(name: string): boolean {
    if (name === 'content' && this.getAttributeNS(null, 'name')) {
      // TODO(HTML §4.2.5): Classify metadata names whose values are primarily human-readable.
      throw new InternalError('Metadata-name directionality rules are not implemented');
    }
    return super.isDirectionalityCapableAttributeName(name);
  }

  protected override isTranslatableAttributeName(name: string): boolean {
    if (name === 'content' && this.getAttributeNS(null, 'name')) {
      // TODO(HTML §4.2.5): Determine whether this metadata name has a translatable value.
      throw new InternalError('Metadata-name translation rules are not implemented');
    }
    return super.isTranslatableAttributeName(name);
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
