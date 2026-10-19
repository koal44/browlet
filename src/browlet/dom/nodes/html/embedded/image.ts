import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, ctor, defineInterface, idlType, impl, reflectEnumerated, xattr } from '../../../../../web-idl/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';
import { loadingAttribute, fetchPriorityAttribute } from '../attributes/index';

import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';

/** Image loading policy and the continuation retained while loading is deferred. */
// https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element
export class HTMLImageElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLImg;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Palpable,
      ContentCategory.FormAssociated,
    ];
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'alt'];
    this.prototype.directionalityAttributes = [...this.prototype.directionalityAttributes, 'alt'];
  }

  /** Suspended image-loading steps, installed by the image loading algorithm. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained load state when the loader exists; see loader/ROADMAP.md.
  lazyLoadResumptionSteps: (() => void) | null = null;

  static is(value: unknown): value is HTMLImageElementImpl {
    return value instanceof HTMLImageElementImpl;
  }

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return 'name-or-id-with-name';
  }

  /** Lazy loading is disabled without scripting, even for an explicit lazy attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#will-lazy-load-element-steps
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-n-noscript
  willLazyLoad(): boolean {
    if (!this.env.isScriptingEnabled() || this.nodeDocument.browsingContext === null) return false;
    return loadingAttribute.getState(this.getAttributeNS(null, 'loading')) === 'lazy';
  }

  override attributeChanged(
    localName: string, oldValue: string | null, value: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, value, namespace);
    // https://html.spec.whatwg.org/multipage/embedded-content.html#attr-img-loading
    if (namespace !== null || localName !== 'loading' ||
      loadingAttribute.getState(oldValue) !== 'lazy' || loadingAttribute.getState(value) !== 'eager') return;
    const steps = this.lazyLoadResumptionSteps;
    this.lazyLoadResumptionSteps = null;
    steps?.();
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Interactive) {
      return this.hasAttributeNS(null, 'usemap') || this.hasAttributeNS(null, 'controls');
    }
    return super.hasCategory(category);
  }
}

/*
 * [Exposed=Window,
 *  LegacyFactoryFunction=Image(optional unsigned long width, optional unsigned long height)]
 * interface HTMLImageElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString alt;
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute USVString srcset;
 *   [CEReactions, Reflect] attribute DOMString sizes;
 *   [CEReactions] attribute DOMString? crossOrigin;
 *   [CEReactions, Reflect] attribute DOMString useMap;
 *   [CEReactions, Reflect] attribute boolean isMap;
 *   [CEReactions, Reflect] attribute boolean controls;
 *   [CEReactions, ReflectSetter] attribute unsigned long width;
 *   [CEReactions, ReflectSetter] attribute unsigned long height;
 *   readonly attribute unsigned long naturalWidth;
 *   readonly attribute unsigned long naturalHeight;
 *   readonly attribute boolean complete;
 *   readonly attribute USVString currentSrc;
 *   [CEReactions] attribute DOMString referrerPolicy;
 *   [CEReactions] attribute DOMString decoding;
 *   [CEReactions] attribute DOMString loading;
 *   [CEReactions] attribute DOMString fetchPriority;
 *
 *   Promise<undefined> decode();
 *
 *   // also has obsolete members
 * };
 */
export const htmlImageElementIDL = defineInterface({
  name: 'HTMLImageElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLImageElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['img'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('loading', idlType.DOMString, xattr('CEReactions', reflectEnumerated(loadingAttribute))),
    attr('fetchPriority', idlType.DOMString, xattr('CEReactions', reflectEnumerated(fetchPriorityAttribute))),
  ],
});
