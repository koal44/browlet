import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Image-map area identity used by Document links. */
// https://html.spec.whatwg.org/multipage/image-maps.html#the-area-element
export class HTMLAreaElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLArea;
    this.prototype.categories = [];
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'alt', 'download'];
    this.prototype.directionalityAttributes = [...this.prototype.directionalityAttributes, 'alt'];
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Flow || category === ContentCategory.Phrasing) {
      for (let ancestor = this.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
        if (ancestor.tag === ElementTag.HTMLMap) return true;
      }
      return false;
    }
    return super.hasCategory(category);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLAreaElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString alt;
 *   [CEReactions, Reflect] attribute DOMString coords;
 *   [CEReactions, Reflect] attribute DOMString shape;
 *   [CEReactions, Reflect] attribute DOMString download;
 *   [CEReactions, Reflect] attribute USVString ping;
 *   [CEReactions, Reflect] attribute DOMString rel;
 *   [SameObject, PutForwards=value, Reflect="rel"] readonly attribute DOMTokenList relList;
 *   [CEReactions] attribute DOMString referrerPolicy;
 *
 *   // also has obsolete members
 * };
 *
 * HTMLAreaElement includes HyperlinkElementUtils;
 * HTMLAreaElement includes HTMLHyperlinkElementUtils;
 */
export const htmlAreaElementIDL = defineInterface({
  name: 'HTMLAreaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLAreaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['area'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
