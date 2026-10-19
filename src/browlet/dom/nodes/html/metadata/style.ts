import { HTML_NAMESPACE } from '../../../../../infra/index';
import {
  ctor, defineIncludes, defineInterface, impl, reference, reflectTokens, roAttr, xattr,
} from '../../../../../web-idl/index';
import type { CSSStyleSheetImpl } from '../../../../../stylelet/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';
import { LinkStyleMixin } from '../../../../style/index';
import { getBlockingTokens, blockingAttribute } from '../attributes/index';
import type { BrowletEnvironment } from '../../../../environment';

import type { ElementCreationContext } from '../../element';
import type { DocumentImpl } from '../../document';
import { HTMLElementImpl } from '../html-element';

/** Associates inline HTML stylesheet text with its tree scope. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-style-element
export class HTMLStyleElementImpl extends HTMLElementImpl {
  /** Changes that require updating this element's associated stylesheet. */
  static #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  static {
    this.prototype.tag = ElementTag.HTMLStyle;
    this.prototype.excludeFromAutoDirection = true;
    this.prototype.categories = [
      ContentCategory.Metadata,
    ];
  }

  /** Document whose parser created this style element; adoption does not replace it. */
  #parserDocument: DocumentImpl | null = null;

  constructor(context: ElementCreationContext, env: BrowletEnvironment) {
    super(context, env);
    this.linkStyleMixin = new LinkStyleMixin(
      this, HTMLStyleElementImpl.#linkStyleOptions, context.treeScopeResolver,
    );
  }

  static is(value: unknown): value is HTMLStyleElementImpl {
    return value instanceof HTMLStyleElementImpl;
  }

  get sheet(): CSSStyleSheetImpl | null {
    return this.getStyleSheet();
  }

  override initializeFromParser(): void {
    this.#parserDocument = this.nodeDocument;
  }

  /** A style element is implicitly eligible when created by its current document's parser. */
  // https://html.spec.whatwg.org/multipage/semantics.html#the-style-element:implicitly-potentially-render-blocking
  isImplicitlyPotentiallyRenderBlocking(): boolean {
    return this.#parserDocument === this.nodeDocument;
  }

  /** Potential eligibility; actual rendering waits belong to the document and resource loader. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#potentially-render-blocking
  override isPotentiallyRenderBlocking(): boolean {
    return getBlockingTokens(this).has('render') || this.isImplicitlyPotentiallyRenderBlocking();
  }

  /** A style title applies only in a document tree and is never inherited. */
  // https://html.spec.whatwg.org/multipage/semantics.html#attr-style-title
  protected override getOwnAdvisoryInformation(): string {
    if (!this.getRoot().isDocument()) return '';
    return super.getOwnAdvisoryInformation() ?? '';
  }
}

/*
 * [Exposed=Window]
 * interface HTMLStyleElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   attribute boolean disabled;
 *   [CEReactions, Reflect] attribute DOMString media;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList blocking;
 *
 *   // also has obsolete members
 * };
 *
 * HTMLStyleElement includes LinkStyle;
 */
export const htmlStyleElementIDL = defineInterface({
  name: 'HTMLStyleElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLStyleElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['style'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    roAttr('blocking', reference('DOMTokenList'),
      xattr('SameObject', ['PutForwards', 'value'], reflectTokens(blockingAttribute)),
    ),
  ],
});

/*
 * HTMLStyleElement includes LinkStyle;
 */
export const htmlStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLStyleElement', mixin: 'LinkStyle',
});
