import { attr, defineInterface, idlType, impl, xattr } from '../../../../../web-idl/index';

import { loadingAttribute, type LoadingState } from '../attributes/index';

import { HTMLElementImpl } from '../html-element';

/** Loading policy shared by audio and video elements. */
// https://html.spec.whatwg.org/multipage/media.html#htmlmediaelement
// PROVISIONAL: resource selection, fetching, playback, and the remaining media API are not implemented.
export class HTMLMediaElementImpl extends HTMLElementImpl {
  /** Suspended media-resource loading steps, installed by resource selection. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained load state when the loader exists; see loader/ROADMAP.md.
  lazyLoadResumptionSteps: (() => void) | null = null;

  static is(value: unknown): value is HTMLMediaElementImpl {
    return value instanceof HTMLMediaElementImpl;
  }

  /** Canonical loading keyword; assignment preserves the supplied attribute text. */
  // https://html.spec.whatwg.org/multipage/media.html#dom-media-loading
  get loading(): LoadingState {
    return loadingAttribute.getState(this.getAttributeNS(null, 'loading'))!;
  }

  set loading(value: string) {
    this.setAttributeValue('loading', value);
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
    // https://html.spec.whatwg.org/multipage/media.html#attr-media-loading
    if (namespace !== null || localName !== 'loading' ||
      loadingAttribute.getState(oldValue) !== 'lazy' || loadingAttribute.getState(value) !== 'eager') return;
    this.resumeLazyLoading();
  }

  /** Resume resource loading after a change to eager; video also resumes its poster. */
  // https://html.spec.whatwg.org/multipage/media.html#attr-media-loading
  protected resumeLazyLoading(): void {
    const steps = this.lazyLoadResumptionSteps;
    this.lazyLoadResumptionSteps = null;
    steps?.();
  }
}

/*
 * HTMLMediaElement's implemented fragment:
 * [CEReactions] attribute DOMString loading;
 */
export const htmlMediaElementIDL = defineInterface({
  name: 'HTMLMediaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMediaElementImpl),
  members: [
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('loading', idlType.DOMString, xattr('CEReactions')),
  ],
});
