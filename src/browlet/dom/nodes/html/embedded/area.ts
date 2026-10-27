import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineIncludes, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';
import type { Origin } from '../../../../../url/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';
import { HyperlinkElementUtilsMixin } from '../text/index';

/** Image-map area identity used by Document links. */
// https://html.spec.whatwg.org/multipage/image-maps.html#the-area-element
export class HTMLAreaElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLArea;
    this.prototype.categories = [];
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'alt', 'download'];
    this.prototype.directionalityAttributes = [...this.prototype.directionalityAttributes, 'alt'];
  }

  #hyperlinkElementUtilsMixin = new HyperlinkElementUtilsMixin();

  static override is(value: unknown): value is HTMLAreaElementImpl {
    return typeof value === 'object' && value !== null && #hyperlinkElementUtilsMixin in value;
  }

  extractOrigin(): Origin | null {
    return this.#hyperlinkElementUtilsMixin.extractOrigin();
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

export const htmlAreaElementIncludesHyperlinkElementUtilsIDL = defineIncludes({
  interface: 'HTMLAreaElement', mixin: 'HyperlinkElementUtils',
});

export const htmlAreaElementIncludesHTMLHyperlinkElementUtilsIDL = defineIncludes({
  interface: 'HTMLAreaElement', mixin: 'HTMLHyperlinkElementUtils',
});
