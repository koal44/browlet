import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, defineInterface, idlType, impl, reflectEnumerated, xattr } from '../../../../../web-idl/index';

import { loadingAttribute, fetchPriorityAttribute } from '../attributes/index';

import { HTMLElementImpl } from '../html-element';

/** Image loading policy and the continuation retained while loading is deferred. */
// https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element
// PROVISIONAL: image selection, fetching, decoding, and the remaining image API are not implemented.
export class HTMLImageElementImpl extends HTMLElementImpl {
  /** Suspended image-loading steps, installed by the image loading algorithm. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained load state when the loader exists; see loader/ROADMAP.md.
  lazyLoadResumptionSteps: (() => void) | null = null;

  static is(value: unknown): value is HTMLImageElementImpl {
    return value instanceof HTMLImageElementImpl;
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
}

/*
 * HTMLImageElement's implemented fragment:
 * [CEReactions] attribute DOMString loading;
 * [CEReactions] attribute DOMString fetchPriority;
 */
export const htmlImageElementIDL = defineInterface({
  name: 'HTMLImageElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLImageElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['img'],
  members: [
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('loading', idlType.DOMString, xattr('CEReactions', reflectEnumerated(loadingAttribute))),
    attr('fetchPriority', idlType.DOMString, xattr('CEReactions', reflectEnumerated(fetchPriorityAttribute))),
  ],
});
