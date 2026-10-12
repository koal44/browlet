import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, defineInterface, idlType, impl, xattr } from '../../../../../web-idl/index';
import type { RequestPriority } from '../../../../../fetch/index';

import { loadingAttribute, type LoadingState, fetchPriorityAttribute } from '../attributes/index';

import { defineElementInterface } from '../../element';
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

  /** Canonical loading keyword; assignment preserves the supplied attribute text. */
  // https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-loading
  get loading(): LoadingState {
    return loadingAttribute.getState(this.getAttributeNS(null, 'loading'))!;
  }

  set loading(value: string) {
    this.setAttributeValue('loading', value);
  }

  /** Canonical fetch-priority hint; assignment preserves the supplied attribute text. */
  // https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-fetchPriority
  get fetchPriority(): RequestPriority {
    return fetchPriorityAttribute.getState(this.getAttributeNS(null, 'fetchpriority'))!;
  }

  set fetchPriority(value: string) {
    this.setAttributeValue('fetchpriority', value);
  }

  /** Lazy loading is disabled without scripting, even for an explicit lazy attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#will-lazy-load-element-steps
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-n-noscript
  willLazyLoad(): boolean {
    if (!this.env.isScriptingEnabled() || this.nodeDocument.browsingContext === null) return false;
    return this.loading === 'lazy';
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
  members: [
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('loading', idlType.DOMString, xattr('CEReactions')),
    attr('fetchPriority', idlType.DOMString, xattr('CEReactions')),
  ],
});

export const htmlImageElementInterface = defineElementInterface({
  definition: htmlImageElementIDL,
  localNames: ['img'],
  namespaceURI: HTML_NAMESPACE,
});
