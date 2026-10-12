import { HTML_NAMESPACE } from '../../../../../infra/index';
import { asciiLower } from '../../../../../infra/ascii';
import {
  attr, defineIncludes, defineInterface, idlType, impl, nullable, reference, roAttr, xattr,
} from '../../../../../web-idl/index';
import type { CSSStyleSheetImpl } from '../../../../../stylelet/index';
import type { ReferrerPolicy, RequestPriority } from '../../../../../fetch/index';

import { splitOnAsciiWhitespace } from '../../../infra/index';
import { LinkStyleMixin } from '../../../../style/index';
import {
  corsSettingsAttribute, referrerPolicyAttribute, getBlockingTokens, possibleBlockingTokens,
  fetchPriorityAttribute,
} from '../attributes/index';
import { DOMTokenListImpl } from '../../../token-list';
import type { BrowletEnvironment } from '../../../../environment';

import { defineElementInterface, type ElementCreationContext } from '../../element';
import type { DocumentImpl } from '../../document';
import { HTMLElementImpl } from '../html-element';

/** Represents an external resource link and its stylesheet association. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-link-element
export class HTMLLinkElementImpl extends HTMLElementImpl {
  /** Changes that require updating this element's associated stylesheet. */
  static #linkStyleOptions = {
    attributes: new Set([
      'crossorigin', 'href', 'integrity', 'media', 'referrerpolicy',
      'rel', 'title', 'type',
    ]),
  };

  /** Stable author-facing token list, created on first access. */
  #blocking: DOMTokenListImpl | undefined;
  /** Document whose parser created this link; adoption does not replace it. */
  #parserDocument: DocumentImpl | null = null;

  constructor(context: ElementCreationContext, env: BrowletEnvironment) {
    super(context, env);
    this.linkStyleMixin = new LinkStyleMixin(
      this, HTMLLinkElementImpl.#linkStyleOptions, context.treeScopeResolver,
    );
  }

  static is(value: unknown): value is HTMLLinkElementImpl {
    return value instanceof HTMLLinkElementImpl;
  }

  /** Canonical CORS keyword, or null for the missing attribute's No CORS state. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-link-crossOrigin
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  get crossOrigin(): string | null {
    const state = corsSettingsAttribute.getState(this.getAttributeNS(null, 'crossorigin'))!;
    return corsSettingsAttribute.getCanonicalKeyword(state);
  }

  set crossOrigin(value: string | null) {
    if (value === null) this.removeAttributeNS(null, 'crossorigin');
    else this.setAttributeValue('crossorigin', value);
  }

  /** Canonical referrer policy, or an empty string to defer to the request's policy container. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-link-referrerPolicy
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  get referrerPolicy(): ReferrerPolicy {
    return referrerPolicyAttribute.getState(this.getAttributeNS(null, 'referrerpolicy'))!;
  }

  set referrerPolicy(value: string) {
    this.setAttributeValue('referrerpolicy', value);
  }

  /** Live, case-preserving token list for the blocking content attribute. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-link-blocking
  get blocking(): DOMTokenListImpl {
    return this.#blocking ??= new DOMTokenListImpl(this, 'blocking', possibleBlockingTokens);
  }

  /** Canonical fetch-priority hint; assignment preserves the supplied attribute text. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-link-fetchPriority
  get fetchPriority(): RequestPriority {
    return fetchPriorityAttribute.getState(this.getAttributeNS(null, 'fetchpriority'))!;
  }

  set fetchPriority(value: string) {
    this.setAttributeValue('fetchpriority', value);
  }

  get sheet(): CSSStyleSheetImpl | null {
    return this.getStyleSheet();
  }

  override attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, newValue, namespace);
    this.#blocking?.attributeChanged(localName, oldValue, newValue, namespace);
  }

  override initializeFromParser(): void {
    this.#parserDocument = this.nodeDocument;
  }

  /** A parser-created stylesheet link qualifies only in the document that created it. */
  // https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet:implicitly-potentially-render-blocking
  isImplicitlyPotentiallyRenderBlocking(): boolean {
    return this.#parserDocument === this.nodeDocument &&
      splitOnAsciiWhitespace(asciiLower(this.getAttributeNS(null, 'rel') ?? '')).includes('stylesheet');
  }

  /** Potential eligibility; actual rendering waits belong to the document and resource loader. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#potentially-render-blocking
  override isPotentiallyRenderBlocking(): boolean {
    return getBlockingTokens(this).has('render') || this.isImplicitlyPotentiallyRenderBlocking();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLLinkElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString href;
 *   [CEReactions] attribute DOMString? crossOrigin;
 *   [CEReactions, Reflect] attribute DOMString rel;
 *   [CEReactions] attribute DOMString as;
 *   [SameObject, PutForwards=value, Reflect="rel"] readonly attribute DOMTokenList relList;
 *   [CEReactions, Reflect] attribute DOMString media;
 *   [CEReactions, Reflect] attribute DOMString integrity;
 *   [CEReactions, Reflect] attribute DOMString hreflang;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList sizes;
 *   [CEReactions, Reflect] attribute USVString imageSrcset;
 *   [CEReactions, Reflect] attribute DOMString imageSizes;
 *   [CEReactions] attribute DOMString referrerPolicy;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList blocking;
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   [CEReactions] attribute DOMString fetchPriority;
 *
 *   // also has obsolete members
 * };
 */
export const htmlLinkElementIDL = defineInterface({
  name: 'HTMLLinkElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLLinkElementImpl),
  members: [
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('crossOrigin', nullable(idlType.DOMString), xattr('CEReactions')),
    attr('referrerPolicy', idlType.DOMString, xattr('CEReactions')),
    roAttr('blocking', reference('DOMTokenList'), xattr('SameObject', ['PutForwards', 'value'])),
    attr('fetchPriority', idlType.DOMString, xattr('CEReactions')),
  ],
});

export const htmlLinkElementInterface = defineElementInterface({
  definition: htmlLinkElementIDL,
  localNames: ['link'],
  namespaceURI: HTML_NAMESPACE,
});

/*
 * HTMLLinkElement includes LinkStyle;
 */
export const htmlLinkElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLLinkElement', mixin: 'LinkStyle',
});
