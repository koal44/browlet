import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, ctor, defineInterface, idlType, impl, reflectEnumerated, xattr } from '../../../../../web-idl/core/index';
import type { ReferrerPolicy } from '../../../../../fetch/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';
import { loadingAttribute, referrerPolicyAttribute } from '../attributes/index';
import { SandboxingFlagSet } from '../../../../browsing/policy/index';
import type { Navigable } from '../../../../browsing/navigation/index';

import type { ElementImpl } from '../../element';
import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';

/** Iframe loading policy and the continuation retained while navigation is deferred. */
// https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element
export class HTMLIFrameElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLIframe;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Interactive,
      ContentCategory.Palpable,
    ];
    // Localization must parse srcdoc as HTML and recursively translate the embedded document.
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'srcdoc'];
  }

  /** Restrictions from the current sandbox attribute, used by subsequent navigations. */
  // https://html.spec.whatwg.org/multipage/browsers.html#iframe-sandboxing-flag-set
  sandboxingFlagSet = new SandboxingFlagSet();

  /** Suspended navigation steps, installed by iframe attribute processing. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained navigation state when loading exists; see loader/ROADMAP.md.
  lazyLoadResumptionSteps: (() => void) | null = null;
  /** Retained child destination; the accessor keeps its reverse container link in sync. */
  #contentNavigable: Navigable | null = null;

  static is(value: unknown): value is HTMLIFrameElementImpl {
    return value instanceof HTMLIFrameElementImpl;
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#determining-the-iframe-element-referrer-policy
  static determineReferrerPolicy(embedder: ElementImpl | null): ReferrerPolicy {
    return embedder instanceof HTMLIFrameElementImpl
      ? referrerPolicyAttribute.getState(embedder.getAttributeNS(null, 'referrerpolicy'))!
      : '';
  }

  /** Child navigation destination, or null before creation and after destruction. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#content-navigable
  // TODO(HTML child navigation): create/destroy the child and maintain this association.
  get contentNavigable(): Navigable | null {
    return this.#contentNavigable;
  }

  set contentNavigable(value: Navigable | null) {
    if (this.#contentNavigable === value) return;
    const previous = this.#contentNavigable;
    this.#contentNavigable = value;
    previous?.setContainer(null);
    value?.setContainer(this);
  }

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return 'name';
  }

  /** Lazy loading is disabled without scripting, even for an explicit lazy attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#will-lazy-load-element-steps
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-n-noscript
  willLazyLoad(): boolean {
    if (!this.env.isScriptingEnabledFor(this)) return false;
    return loadingAttribute.getState(this.getAttributeNS(null, 'loading')) === 'lazy';
  }

  override attributeChanged(
    localName: string, oldValue: string | null, value: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, value, namespace);
    if (namespace === null && localName === 'sandbox') {
      this.sandboxingFlagSet = value === null ? new SandboxingFlagSet() : SandboxingFlagSet.parse(value);
    }
    // https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-loading
    if (namespace !== null || localName !== 'loading' ||
      loadingAttribute.getState(oldValue) !== 'lazy' || loadingAttribute.getState(value) !== 'eager') return;
    const steps = this.lazyLoadResumptionSteps;
    this.lazyLoadResumptionSteps = null;
    steps?.();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLIFrameElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions] attribute (TrustedHTML or DOMString) srcdoc;
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList sandbox;
 *   [CEReactions, Reflect] attribute DOMString allow;
 *   [CEReactions, Reflect] attribute boolean allowFullscreen;
 *   [CEReactions, Reflect] attribute DOMString width;
 *   [CEReactions, Reflect] attribute DOMString height;
 *   [CEReactions] attribute DOMString referrerPolicy;
 *   [CEReactions] attribute DOMString loading;
 *   readonly attribute Document? contentDocument;
 *   readonly attribute WindowProxy? contentWindow;
 *   Document? getSVGDocument();
 *
 *   // also has obsolete members
 * };
 */
export const htmlIFrameElementIDL = defineInterface({
  name: 'HTMLIFrameElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLIFrameElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['iframe'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('referrerPolicy', idlType.DOMString, xattr('CEReactions', reflectEnumerated(referrerPolicyAttribute))),
    attr('loading', idlType.DOMString, xattr('CEReactions', reflectEnumerated(loadingAttribute))),
  ],
});
