import { defineElementInterface, ElementImpl } from '../../dom/nodes/element';
import { HTML_NAMESPACE } from '../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../web-idl/index';
import type { CSSStyleDeclarationImpl } from '../../../stylelet/index';

/** Base implementation for elements in the HTML namespace. */
// https://html.spec.whatwg.org/multipage/dom.html#htmlelement
export class HTMLElementImpl extends ElementImpl {
  static is(value: unknown): value is HTMLElementImpl {
    return value instanceof HTMLElementImpl;
  }

  get style(): CSSStyleDeclarationImpl {
    return this.getInlineStyle();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLElement : Element {
 *   [HTMLConstructor] constructor();
 *
 *   // metadata attributes
 *   [CEReactions, Reflect] attribute DOMString title;
 *   [CEReactions, Reflect] attribute DOMString lang;
 *   [CEReactions] attribute boolean translate;
 *   [CEReactions] attribute DOMString dir;
 *
 *   // user interaction
 *   [CEReactions] attribute (boolean or unrestricted double or DOMString)? hidden;
 *   [CEReactions, Reflect] attribute boolean inert;
 *   undefined click();
 *   [CEReactions, Reflect] attribute DOMString accessKey;
 *   readonly attribute DOMString accessKeyLabel;
 *   [CEReactions] attribute boolean draggable;
 *   [CEReactions] attribute boolean spellcheck;
 *   [CEReactions, ReflectSetter] attribute DOMString writingSuggestions;
 *   [CEReactions, ReflectSetter] attribute DOMString autocapitalize;
 *   [CEReactions] attribute boolean autocorrect;
 *
 *   [CEReactions] attribute [LegacyNullToEmptyString] DOMString innerText;
 *   [CEReactions] attribute [LegacyNullToEmptyString] DOMString outerText;
 *
 *   ElementInternals attachInternals();
 *
 *   // The popover API
 *   undefined showPopover(optional ShowPopoverOptions options = {});
 *   undefined hidePopover();
 *   boolean togglePopover(optional (TogglePopoverOptions or boolean) options = {});
 *   [CEReactions] attribute DOMString? popover;
 *
 *   [CEReactions, Reflect, ReflectRange=(0, 8)] attribute unsigned long headingOffset;
 *   [CEReactions, Reflect] attribute boolean headingReset;
 * };
 * HTMLElement includes GlobalEventHandlers;
 * HTMLElement includes ElementContentEditable;
 * HTMLElement includes HTMLOrSVGOrMathMLElement;
 */
export const htmlElementIDL = defineInterface({
  name: 'HTMLElement',
  inherits: 'Element',
  exposed: 'Window',
  implementation: impl(HTMLElementImpl),
  members: [],
});

export const htmlElementInterface = defineElementInterface({
  definition: htmlElementIDL,
  namespaceURI: HTML_NAMESPACE,
});

/*
 * HTMLElement includes ElementCSSInlineStyle;
 */
export const htmlElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'HTMLElement', mixin: 'ElementCSSInlineStyle',
});
