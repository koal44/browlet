import {
  defineElementInterface, type ElementCreationContext,
} from '../../../dom/nodes/element';
import { HTML_NAMESPACE } from '../../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../../web-idl/index';
import { HTMLElementImpl } from '../html-element';
import type { CSSStyleSheetImpl } from '../../../../stylelet/index';
import type { Environment } from '../../../scripting/environment';
import { LinkStyleMixin } from '../../../style/integration';

/** Associates inline HTML stylesheet text with its tree scope. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-style-element
export class HTMLStyleElementImpl extends HTMLElementImpl {
  /** Changes that require updating this element's associated stylesheet. */
  static #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  constructor(context: ElementCreationContext, env: Environment) {
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
 * HTMLStyleElement includes LinkStyle;
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

export const htmlStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLStyleElement', mixin: 'LinkStyle',
});
