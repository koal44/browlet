import { HTML_NAMESPACE } from '../../../../infra/index';
import {
  attr, ctor, defineDictionary, defineIncludes, defineInterface, dictMember, idlType, impl, reference,
  reflect, xattr,
} from '../../../../web-idl/index';

import { htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';
import { HTMLElementImpl } from './html-element';
import {
  HTMLAddressElementImpl, HTMLArticleElementImpl, HTMLAsideElementImpl, HTMLFooterElementImpl,
  HTMLHeaderElementImpl, HTMLHGroupElementImpl, HTMLNavElementImpl, HTMLSectionElementImpl,
} from './sections/index';
import {
  HTMLDDElementImpl, HTMLDTElementImpl, HTMLFigCaptionElementImpl, HTMLFigureElementImpl,
  HTMLMainElementImpl, HTMLSearchElementImpl,
} from './grouping/index';
import {
  HTMLAbbrElementImpl, HTMLBElementImpl, HTMLBDIElementImpl, HTMLBDOElementImpl, HTMLCiteElementImpl,
  HTMLCodeElementImpl, HTMLDFNElementImpl, HTMLEmElementImpl, HTMLIElementImpl, HTMLKbdElementImpl,
  HTMLMarkElementImpl, HTMLRPElementImpl, HTMLRTElementImpl, HTMLRubyElementImpl, HTMLSElementImpl,
  HTMLSampElementImpl, HTMLSmallElementImpl, HTMLStrongElementImpl, HTMLSubElementImpl,
  HTMLSupElementImpl, HTMLUElementImpl, HTMLVarElementImpl, HTMLWBRElementImpl,
} from './text/index';
import { HTMLSummaryElementImpl } from './interactive/index';
import { HTMLNoScriptElementImpl } from './scripting/index';
import {
  HTMLAcronymElementImpl, HTMLBaseFontElementImpl, HTMLBigElementImpl, HTMLCenterElementImpl,
  HTMLNoBRElementImpl, HTMLNoEmbedElementImpl, HTMLNoFramesElementImpl, HTMLPlainTextElementImpl,
  HTMLRBElementImpl, HTMLRTCElementImpl, HTMLStrikeElementImpl, HTMLTTElementImpl,
} from './legacy/index';

// This declaration sits above the concrete tags; their shared implementation remains below them.
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
 *
 * HTMLElement includes GlobalEventHandlers;
 * HTMLElement includes ElementContentEditable;
 * HTMLElement includes HTMLOrSVGOrMathMLElement;
 */
export const htmlElementIDL = defineInterface({
  name: 'HTMLElement',
  inherits: 'Element',
  exposed: 'Window',
  implementation: [
    impl(HTMLElementImpl),
    impl(HTMLAddressElementImpl),
    impl(HTMLArticleElementImpl),
    impl(HTMLAsideElementImpl),
    impl(HTMLFooterElementImpl),
    impl(HTMLHeaderElementImpl),
    impl(HTMLHGroupElementImpl),
    impl(HTMLNavElementImpl),
    impl(HTMLSectionElementImpl),
    impl(HTMLDDElementImpl),
    impl(HTMLDTElementImpl),
    impl(HTMLFigCaptionElementImpl),
    impl(HTMLFigureElementImpl),
    impl(HTMLMainElementImpl),
    impl(HTMLSearchElementImpl),
    impl(HTMLAbbrElementImpl),
    impl(HTMLBElementImpl),
    impl(HTMLBDIElementImpl),
    impl(HTMLBDOElementImpl),
    impl(HTMLCiteElementImpl),
    impl(HTMLCodeElementImpl),
    impl(HTMLDFNElementImpl),
    impl(HTMLEmElementImpl),
    impl(HTMLIElementImpl),
    impl(HTMLKbdElementImpl),
    impl(HTMLMarkElementImpl),
    impl(HTMLRPElementImpl),
    impl(HTMLRTElementImpl),
    impl(HTMLRubyElementImpl),
    impl(HTMLSElementImpl),
    impl(HTMLSampElementImpl),
    impl(HTMLSmallElementImpl),
    impl(HTMLStrongElementImpl),
    impl(HTMLSubElementImpl),
    impl(HTMLSupElementImpl),
    impl(HTMLUElementImpl),
    impl(HTMLVarElementImpl),
    impl(HTMLWBRElementImpl),
    impl(HTMLSummaryElementImpl),
    impl(HTMLNoScriptElementImpl),
    impl(HTMLAcronymElementImpl),
    impl(HTMLBaseFontElementImpl),
    impl(HTMLBigElementImpl),
    impl(HTMLCenterElementImpl),
    impl(HTMLNoBRElementImpl),
    impl(HTMLNoEmbedElementImpl),
    impl(HTMLNoFramesElementImpl),
    impl(HTMLPlainTextElementImpl),
    impl(HTMLRBElementImpl),
    impl(HTMLRTCElementImpl),
    impl(HTMLStrikeElementImpl),
    impl(HTMLTTElementImpl),
  ],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
    attr('title', idlType.DOMString, xattr('CEReactions', reflect())),
    attr('lang', idlType.DOMString, xattr('CEReactions', reflect())),
    // TODO(HTML): translate/dir require the inherited translation state and directionality algorithms in §3.2.6.
    attr('inert', idlType.boolean, xattr('CEReactions', reflect())),
    attr('accessKey', idlType.DOMString, xattr('CEReactions', reflect())),
    // TODO(HTML): interaction/editing owns hidden, click, accessKeyLabel, draggable, spellcheck,
    // writingSuggestions, autocapitalize, and autocorrect. Reflection alone does not implement inertness.
    // TODO(HTML): §3.2.7 owns innerText/outerText; custom elements own attachInternals.
    // TODO(HTML): popover state, show/hide/toggle operations, and popover reflection belong to §6.12.
    attr('headingOffset', idlType.unsignedLong, xattr('CEReactions', reflect({ range: [0, 8] }))),
    attr('headingReset', idlType.boolean, xattr('CEReactions', reflect())),
    // TODO(HTML): heading-level computation and accessibility presentation are not implemented.
  ],
});

// TODO(HTML): include GlobalEventHandlers and ElementContentEditable when their implementations exist.
// Missing members and their owning algorithms are inventoried in ../../../html/ROADMAP.md.

/*
 * dictionary ShowPopoverOptions {
 *   HTMLElement source;
 * };
 */
export const showPopoverOptionsIDL = defineDictionary({
  name: 'ShowPopoverOptions',
  members: [dictMember('source', reference(HTMLElementImpl))],
});

/*
 * dictionary TogglePopoverOptions : ShowPopoverOptions {
 *   boolean force;
 * };
 */
export const togglePopoverOptionsIDL = defineDictionary({
  name: 'TogglePopoverOptions',
  inherits: 'ShowPopoverOptions',
  members: [dictMember('force', idlType.boolean)],
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
