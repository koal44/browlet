import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineIncludes, defineInterface, impl, reference, roAttr, xattr } from '../../../../../web-idl/index';
import type { CSSStyleSheetImpl } from '../../../../../stylelet/index';

import { LinkStyleMixin } from '../../../../style/index';
import { getBlockingTokens, possibleBlockingTokens } from '../attributes/index';
import { DOMTokenListImpl } from '../../../token-list';
import type { BrowletEnvironment } from '../../../../environment';

import { defineElementInterface, type ElementCreationContext } from '../../element';
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

  /** Stable author-facing token list, created on first access. */
  #blocking: DOMTokenListImpl | undefined;
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

  /** Live, case-preserving token list for the blocking content attribute. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-style-blocking
  get blocking(): DOMTokenListImpl {
    return this.#blocking ??= new DOMTokenListImpl(this, 'blocking', possibleBlockingTokens);
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
 */
export const htmlStyleElementIDL = defineInterface({
  name: 'HTMLStyleElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLStyleElementImpl),
  members: [
    roAttr('blocking', reference('DOMTokenList'), xattr('SameObject', ['PutForwards', 'value'])),
  ],
});

export const htmlStyleElementInterface = defineElementInterface({
  definition: htmlStyleElementIDL,
  localNames: ['style'],
  namespaceURI: HTML_NAMESPACE,
});

/*
 * HTMLStyleElement includes LinkStyle;
 */
export const htmlStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLStyleElement', mixin: 'LinkStyle',
});
