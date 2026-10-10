import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../../../web-idl/index';
import type { CSSStyleSheetImpl } from '../../../../../stylelet/index';

import { LinkStyleMixin } from '../../../../style/index';
import type { BrowletEnvironment } from '../../../../environment';

import { defineElementInterface, type ElementCreationContext } from '../../element';
import { HTMLElementImpl } from '../html-element';

/** Associates inline HTML stylesheet text with its tree scope. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-style-element
export class HTMLStyleElementImpl extends HTMLElementImpl {
  /** Changes that require updating this element's associated stylesheet. */
  static #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

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
  members: [],
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
