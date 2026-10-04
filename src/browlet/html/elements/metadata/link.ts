import {
  defineElementInterface, type ElementCreationContext,
} from '../../../dom/nodes/element';
import { HTML_NAMESPACE } from '../../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../../web-idl/index';
import { HTMLElementImpl } from '../html-element';
import type { CSSStyleSheetImpl } from '../../../../stylelet/index';
import type { BrowletEnvironment } from '../../../scripting/environment';
import { LinkStyleMixin } from '../../../style/integration';

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
  members: [],
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
