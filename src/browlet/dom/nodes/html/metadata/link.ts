import { HTML_NAMESPACE } from '../../../../../infra/index';
import { asciiLower } from '../../../../../infra/ascii';
import {
  attr, ctor, defineIncludes, defineInterface, idlType, impl, nullable, reference, reflectEnumerated,
  reflectTokens, roAttr, xattr,
} from '../../../../../web-idl/index';
import type { CSSStyleSheetImpl } from '../../../../../stylelet/index';

import { splitOnAsciiWhitespace } from '../../../infra/index';
import { LinkStyleMixin } from '../../../../style/index';
import {
  corsSettingsAttribute, referrerPolicyAttribute, getBlockingTokens, blockingAttribute,
  fetchPriorityAttribute,
} from '../attributes/index';
import type { BrowletEnvironment } from '../../../../environment';

import type { ElementCreationContext } from '../../element';
import type { DocumentImpl } from '../../document';
import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

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

  static {
    this.prototype.tag = ElementTag.HTMLLink;
    this.prototype.categories = [
      ContentCategory.Metadata,
    ];
  }

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

  get sheet(): CSSStyleSheetImpl | null {
    return this.getStyleSheet();
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

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Flow || category === ContentCategory.Phrasing) return this.isAllowedInBody();
    return super.hasCategory(category);
  }

  /** Whether itemprop or the current rel tokens permit this link in phrasing content. */
  // https://html.spec.whatwg.org/multipage/semantics.html#allowed-in-the-body
  isAllowedInBody(): boolean {
    if (this.hasAttributeNS(null, 'itemprop')) return true;
    const rel = this.getAttributeNS(null, 'rel');
    return rel !== null && splitOnAsciiWhitespace(asciiLower(rel)).every((token) => bodyAllowedLinkTypes.has(token));
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
 *
 * HTMLLinkElement includes LinkStyle;
 */
export const htmlLinkElementIDL = defineInterface({
  name: 'HTMLLinkElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLLinkElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['link'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('crossOrigin', nullable(idlType.DOMString), xattr('CEReactions', reflectEnumerated(corsSettingsAttribute))),
    attr('referrerPolicy', idlType.DOMString, xattr('CEReactions', reflectEnumerated(referrerPolicyAttribute))),
    roAttr('blocking', reference('DOMTokenList'),
      xattr('SameObject', ['PutForwards', 'value'], reflectTokens(blockingAttribute)),
    ),
    attr('fetchPriority', idlType.DOMString, xattr('CEReactions', reflectEnumerated(fetchPriorityAttribute))),
  ],
});

/*
 * HTMLLinkElement includes LinkStyle;
 */
export const htmlLinkElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLLinkElement', mixin: 'LinkStyle',
});

// https://html.spec.whatwg.org/multipage/links.html#body-ok
const bodyAllowedLinkTypes = new Set([
  'dns-prefetch', 'modulepreload', 'pingback', 'preconnect', 'prefetch', 'preload', 'stylesheet',
]);
