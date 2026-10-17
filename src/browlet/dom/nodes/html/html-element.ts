import { HTML_NAMESPACE } from '../../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../../web-idl/index';
import type { CSSStyleDeclarationImpl } from '../../../../stylelet/index';

import { ElementImpl } from '../element';
import { HTMLOrSVGOrMathMLElementMixin, htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';

/** Base implementation for elements in the HTML namespace. */
// https://html.spec.whatwg.org/multipage/dom.html#htmlelement
export class HTMLElementImpl extends ElementImpl {
  /** Common HTML, SVG, and MathML state and attribute behavior. */
  #htmlOrSVGOrMathMLElementMixin = new HTMLOrSVGOrMathMLElementMixin(this);

  /** Fixed eligibility for name-based document.all lookup; ID lookup does not use this flag. */
  // https://html.spec.whatwg.org/#all-named-elements
  readonly isAllNamedElement: boolean = false;

  static is(value: unknown): value is HTMLElementImpl {
    return value instanceof HTMLElementImpl;
  }

  /** Cryptographic nonce exposed to script, independently of the content attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#dom-noncedelement-nonce
  get nonce(): string { return this.#htmlOrSVGOrMathMLElementMixin.nonce; }
  set nonce(value: string) { this.#htmlOrSVGOrMathMLElementMixin.nonce = value; }

  get style(): CSSStyleDeclarationImpl {
    return this.getInlineStyle();
  }

  /** Current participation in Document named-property lookup, including exposure rules. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem-filter
  getDocumentNamedItemType(): DocumentNamedItemType {
    return 'none';
  }

  /** Whether this element matches a supported Document named property. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem-filter
  matchesDocumentName(name: string): boolean {
    const type = this.getDocumentNamedItemType();
    if (type === 'none') return false;
    const elementName = this.getAttributeNS(null, 'name');
    return elementName === name ||
      ((type === 'name-or-id' || (type === 'name-or-id-with-name' && !!elementName)) &&
        this.getAttributeNS(null, 'id') === name);
  }

  override attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null,
    namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, newValue, namespace);
    this.#htmlOrSVGOrMathMLElementMixin.attributeChanged(localName, newValue, namespace);
  }

  protected override insertionSteps(): void {
    super.insertionSteps();
    this.#htmlOrSVGOrMathMLElementMixin.insertionSteps();
  }

  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#nonce-attributes
  protected override cloningSteps(copy: HTMLElementImpl, subtree: boolean): void {
    super.cloningSteps(copy, subtree);
    copy.nonce = this.nonce;
  }
}

/** Name/ID eligibility; name-or-id-with-name requires a nonempty name before an ID can match. */
export type DocumentNamedItemType = 'none' | 'name' | 'name-or-id' | 'name-or-id-with-name';

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
  namespaceURI: HTML_NAMESPACE,
  members: [],
});

/*
 * HTMLElement includes ElementCSSInlineStyle;
 */
export const htmlElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'HTMLElement', mixin: 'ElementCSSInlineStyle',
});

/*
 * HTMLElement includes HTMLOrSVGOrMathMLElement;
 */
export const htmlElementIncludesHTMLOrSVGOrMathMLElementIDL = defineIncludes({
  interface: 'HTMLElement', mixin: htmlOrSVGOrMathMLElementIDL.name,
});
