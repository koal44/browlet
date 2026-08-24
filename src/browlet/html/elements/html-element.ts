import {
  defineElementInterface, type ElementCreationContext, ElementImpl,
  type LinkStyleInit,
} from '../../dom/nodes/element';
import { HTML_NAMESPACE } from '../../../shared/namespaces';
import {
  defineIncludes, defineInterface,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import { withHTMLElementStub } from '../../stubs';

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
export class HTMLElementImpl
  extends withHTMLElementStub(ElementImpl)
  implements HTMLElement
{
  constructor(
    context: ElementCreationContext,
    linkStyle?: LinkStyleInit,
  ) {
    super(context, linkStyle);
  }

  get style(): CSSStyleDeclaration {
    return ElementImpl.getInlineStyle(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const htmlElementIDL = defineInterface({
  binding: bind(HTMLElementImpl),
  exposed: 'Window',
  inherits: 'Element',
  members: [],
  name: 'HTMLElement',
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

export function isHTMLElement(
  element: Element,
): element is HTMLElementImpl {
  return element.namespaceURI === HTML_NAMESPACE;
}
