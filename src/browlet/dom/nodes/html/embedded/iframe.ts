import { HTML_NAMESPACE } from '../../../../../infra/index';
import {
  attr, ctor, defineInterface, idlType, impl, nullable, reference, reflect, reflectEnumerated, roAttr, xattr,
} from '../../../../../web-idl/core/index';
import { areSameOriginDomain, createOpaqueOrigin, obtainURLOrigin, type Origin } from '../../../../../url/index';
import type { ReferrerPolicy } from '../../../../../fetch/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';
import { loadingAttribute, referrerPolicyAttribute } from '../attributes/index';
import {
  SandboxingFlagSet, PermissionsPolicy, PermissionsPolicyAllowlist, PermissionsPolicyImpl, type PermissionsPolicyDirective,
} from '../../../../browsing/policy/index';
import type { WindowProxyHandle } from '../../../../browsing/window/index';
import type { Navigable } from '../../../../browsing/navigation/index';

import type { DocumentImpl } from '../../document';
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
  /** Stable inspection object associated with this element, including while detached or adopted. */
  #permissionsPolicy?: PermissionsPolicyImpl;

  static is(value: unknown): value is HTMLIFrameElementImpl {
    return value instanceof HTMLIFrameElementImpl;
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#determining-the-iframe-element-referrer-policy
  static determineReferrerPolicy(embedder: ElementImpl | null): ReferrerPolicy {
    return embedder instanceof HTMLIFrameElementImpl
      ? referrerPolicyAttribute.getState(embedder.getAttributeNS(null, 'referrerpolicy'))!
      : '';
  }

  /** Inspection object for this element's attributes and embedding Document. */
  // https://w3c.github.io/webappsec-permissions-policy/#iframe-policy-object
  get permissionsPolicy(): PermissionsPolicyImpl {
    return this.#permissionsPolicy ??= new PermissionsPolicyImpl(this, this.env);
  }

  /** Child navigation destination, or null before creation and after destruction. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#content-navigable
  // TODO(HTML §4.8.5): Insertion/removal must call the node Document's user agent to create/destroy its child.
  // Context inheritance, recursive Document teardown, and history queuing must work before connecting those calls.
  // SPEC_CLASH(iframe-ancestor-collection-input): Attribute processing supplies a Navigable to a Document collection; resolve there.
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

  /** Active child Document when it shares this container's node Document origin-domain. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#concept-bcc-content-document
  get contentDocument(): DocumentImpl | null {
    const document = this.#contentNavigable?.activeDocument ?? null;
    return document !== null && areSameOriginDomain(document.origin, this.nodeDocument.origin) ? document : null;
  }

  /** Active child's WindowProxy, including for a cross-origin child. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#content-window
  get contentWindow(): WindowProxyHandle | null {
    return this.#contentNavigable?.activeWindowProxy ?? null;
  }

  /** Origin selected by this iframe's current attributes for Permissions Policy. */
  // https://w3c.github.io/webappsec-permissions-policy/#declared-origin
  get declaredOrigin(): Origin {
    const document = this.nodeDocument;
    if (document.activeSandboxingFlagSet.has('sandboxed-origin') || this.sandboxingFlagSet.has('sandboxed-origin')) {
      return createOpaqueOrigin();
    }
    if (this.hasAttributeNS(null, 'srcdoc')) return document.origin;
    const src = this.getAttributeNS(null, 'src');
    if (src !== null) {
      const url = document.parseHTMLURL(src);
      // SPEC_CLASH(permissions-policy-blank-origin): Keep the draft's opaque URL origin
      // for about:blank. Firefox also denies 'src'; Chromium/WebKit use the inherited origin.
      if (url !== null) return obtainURLOrigin(url);
    }
    return document.origin;
  }

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return 'name';
  }

  /** Read a fresh container policy from this iframe's current attributes and node Document. */
  // https://w3c.github.io/webappsec-permissions-policy/#process-policy-attributes
  override processPolicyAttributes(): PermissionsPolicyDirective {
    const directive = PermissionsPolicy.parseDirective(
      this.getAttributeNS(null, 'allow') ?? '', this.nodeDocument.origin, this.declaredOrigin,
    );
    // TODO(Fullscreen): Register its feature and test legacy precedence when the API is implemented.
    const fullscreen = PermissionsPolicy.getSupportedFeature('fullscreen');
    if (fullscreen !== undefined && this.hasAttributeNS(null, 'allowfullscreen') && !directive.has(fullscreen)) {
      const allowlist = new PermissionsPolicyAllowlist();
      allowlist.matchesAllOrigins = true;
      directive.set(fullscreen, allowlist);
    }
    return directive;
  }

  /** Report potential restrictions from the current embedding policy, retaining the supplied attribute text. */
  // https://w3c.github.io/webappsec-permissions-policy/#check-potential-violation-in-container
  // TODO(HTML iframe loading): Call after the element's load handlers return, reading
  // the current raw allow/src, before clearing the child Document's load-in-progress flag (§10.1).
  checkPotentialPermissionsPolicyViolation(allowAttribute: string | null, srcAttribute: string | null): void {
    const document = this.nodeDocument;
    const env = document.env;
    const origin = this.declaredOrigin;
    // SPEC_CLASH(permissions-policy-potential-features): §9.12 checks every supported
    // feature; Chromium checks only declarations in a nonempty allow attribute. Follow the draft.
    for (const feature of PermissionsPolicy.getSupportedFeatures()) {
      // SPEC_CLASH(permissions-policy-report-disposition): Keep §8's lowercase values,
      // as for actual reports, instead of §9.12's Enforce/Report spellings.
      if (PermissionsPolicy.getInheritedValue(feature, this, origin) === 'Disabled') {
        env.reportPotentialPermissionsPolicyViolation(
          feature, 'enforce', document.permissionsPolicyState.getReportingEndpoint(feature), allowAttribute, srcAttribute,
        );
      } else if (PermissionsPolicy.getInheritedValue(feature, this, origin, true) === 'Disabled') {
        // SPEC_CLASH(permissions-policy-potential-endpoint): §9.12 selects this
        // report-only endpoint; Chromium's branch reads the enforced policy's endpoint.
        env.reportPotentialPermissionsPolicyViolation(
          feature, 'report', document.reportOnlyPermissionsPolicyState.getReportingEndpoint(feature), allowAttribute, srcAttribute,
        );
      }
    }
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

  protected override insertionSteps(): void {
    this.nodeDocument.recordNavigableContainerInsertion(this);
    super.insertionSteps();
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
    attr('allow', idlType.DOMString, xattr('CEReactions', reflect())),
    attr('allowFullscreen', idlType.boolean, xattr('CEReactions', reflect())),
    attr('referrerPolicy', idlType.DOMString, xattr('CEReactions', reflectEnumerated(referrerPolicyAttribute))),
    attr('loading', idlType.DOMString, xattr('CEReactions', reflectEnumerated(loadingAttribute))),
    roAttr('contentDocument', nullable(reference('Document'))),
    roAttr('contentWindow', nullable(reference('WindowProxy'))),
  ],
});
