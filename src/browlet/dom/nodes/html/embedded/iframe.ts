import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, defineInterface, idlType, impl, reflectEnumerated, xattr } from '../../../../../web-idl/index';

import { loadingAttribute } from '../attributes/index';

import { defineElementInterface } from '../../element';
import { HTMLElementImpl } from '../html-element';

/** Iframe loading policy and the continuation retained while navigation is deferred. */
// https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element
// PROVISIONAL: child navigables, src/srcdoc processing, and the remaining iframe API are not implemented.
export class HTMLIFrameElementImpl extends HTMLElementImpl {
  /** Suspended navigation steps, installed by iframe attribute processing. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained navigation state when loading exists; see loader/ROADMAP.md.
  lazyLoadResumptionSteps: (() => void) | null = null;

  static is(value: unknown): value is HTMLIFrameElementImpl {
    return value instanceof HTMLIFrameElementImpl;
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
    // https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-loading
    if (namespace !== null || localName !== 'loading' ||
      loadingAttribute.getState(oldValue) !== 'lazy' || loadingAttribute.getState(value) !== 'eager') return;
    const steps = this.lazyLoadResumptionSteps;
    this.lazyLoadResumptionSteps = null;
    steps?.();
  }
}

/*
 * HTMLIFrameElement's implemented fragment:
 * [CEReactions] attribute DOMString loading;
 */
export const htmlIFrameElementIDL = defineInterface({
  name: 'HTMLIFrameElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLIFrameElementImpl),
  members: [
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('loading', idlType.DOMString, xattr('CEReactions', reflectEnumerated(loadingAttribute))),
  ],
});

export const htmlIFrameElementInterface = defineElementInterface({
  definition: htmlIFrameElementIDL,
  localNames: ['iframe'],
  namespaceURI: HTML_NAMESPACE,
});
