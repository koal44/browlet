import { HTML_NAMESPACE } from '../../../../infra/index';
import {
  attr, ctor, defineDictionary, defineIncludes, defineInterface, dictMember, idlType, impl, reference,
  reflect, xattr, type Definition,
} from '../../../../web-idl/core/index';

import { htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';
import { HTMLElementImpl } from './html-element';
import {
  HTMLAddressElementImpl, HTMLArticleElementImpl, HTMLAsideElementImpl, HTMLFooterElementImpl,
  HTMLHeaderElementImpl, HTMLHGroupElementImpl, HTMLNavElementImpl, HTMLSectionElementImpl,
  htmlBodyElementIDL, htmlHeadingElementIDL,
} from './sections/index';
import {
  HTMLDDElementImpl, HTMLDTElementImpl, HTMLFigCaptionElementImpl, HTMLFigureElementImpl,
  HTMLMainElementImpl, HTMLSearchElementImpl, htmlParagraphElementIDL, htmlHRElementIDL,
  htmlPreElementIDL, htmlOListElementIDL, htmlUListElementIDL, htmlMenuElementIDL, htmlLIElementIDL,
  htmlDListElementIDL, htmlDivElementIDL, htmlQuoteElementIDL,
} from './grouping/index';
import {
  HTMLAbbrElementImpl, HTMLBElementImpl, HTMLBDIElementImpl, HTMLBDOElementImpl, HTMLCiteElementImpl,
  HTMLCodeElementImpl, HTMLDFNElementImpl, HTMLEmElementImpl, HTMLIElementImpl, HTMLKbdElementImpl,
  HTMLMarkElementImpl, HTMLRPElementImpl, HTMLRTElementImpl, HTMLRubyElementImpl, HTMLSElementImpl,
  HTMLSampElementImpl, HTMLSmallElementImpl, HTMLStrongElementImpl, HTMLSubElementImpl,
  HTMLSupElementImpl, HTMLUElementImpl, HTMLVarElementImpl, HTMLWBRElementImpl, htmlAnchorElementIDL,
  htmlDataElementIDL, htmlTimeElementIDL, htmlSpanElementIDL, htmlBRElementIDL, htmlModElementIDL,
  hyperlinkElementUtilsIDL, htmlHyperlinkElementUtilsIDL,
  htmlAnchorElementIncludesHyperlinkElementUtilsIDL, htmlAnchorElementIncludesHTMLHyperlinkElementUtilsIDL,
} from './text/index';
import { HTMLSummaryElementImpl, htmlDetailsElementIDL, htmlDialogElementIDL } from './interactive/index';
import {
  HTMLNoScriptElementImpl, htmlScriptElementIDL, assignedNodesOptionsIDL, htmlSlotElementIDL,
  htmlCanvasElementIDL, htmlTemplateElementIDL,
} from './scripting/index';
import {
  HTMLAcronymElementImpl, HTMLBaseFontElementImpl, HTMLBigElementImpl, HTMLCenterElementImpl,
  HTMLNoBRElementImpl, HTMLNoEmbedElementImpl, HTMLNoFramesElementImpl, HTMLPlainTextElementImpl,
  HTMLRBElementImpl, HTMLRTCElementImpl, HTMLStrikeElementImpl, HTMLTTElementImpl, htmlFrameElementIDL,
  htmlFrameSetElementIDL, htmlDirectoryElementIDL, htmlFontElementIDL, htmlMarqueeElementIDL,
  htmlParamElementIDL,
} from './legacy/index';
import { htmlUnknownElementIDL } from './html-unknown-element';
import { htmlHtmlElementIDL } from './document/index';
import {
  htmlHeadElementIDL, htmlTitleElementIDL, htmlBaseElementIDL, htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL, htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL,
  htmlMetaElementIDL,
} from './metadata/index';
import { customElementRegistryIDL, elementInternalsIDL } from './custom-elements/index';
import {
  htmlImageElementIDL, htmlIFrameElementIDL, htmlMediaElementIDL, htmlAudioElementIDL,
  htmlVideoElementIDL, htmlEmbedElementIDL, htmlObjectElementIDL, htmlMapElementIDL, htmlAreaElementIDL,
  htmlPictureElementIDL, htmlSourceElementIDL, htmlTrackElementIDL,
  htmlAreaElementIncludesHyperlinkElementUtilsIDL, htmlAreaElementIncludesHTMLHyperlinkElementUtilsIDL,
} from './embedded/index';
import {
  htmlTableElementIDL, htmlTableCaptionElementIDL, htmlTableColElementIDL, htmlTableSectionElementIDL,
  htmlTableRowElementIDL, htmlTableCellElementIDL,
} from './tables/index';
import {
  htmlFormElementIDL, htmlInputElementIDL, htmlSelectElementIDL, htmlOptionElementIDL,
  htmlOptGroupElementIDL, htmlFormControlsCollectionIDL, radioNodeListIDL, htmlOptionsCollectionIDL,
  htmlButtonElementIDL, htmlDataListElementIDL, htmlTextAreaElementIDL, htmlLabelElementIDL,
  htmlOutputElementIDL, htmlProgressElementIDL, htmlMeterElementIDL, htmlFieldSetElementIDL,
  htmlLegendElementIDL, htmlSelectedContentElementIDL,
} from './forms/index';

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
    attr('translate', idlType.boolean, xattr('CEReactions')),
    attr('dir', idlType.DOMString, xattr('CEReactions')),
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

export const htmlIDLDefinitions: Definition[] = [
  htmlOrSVGOrMathMLElementIDL,
  customElementRegistryIDL,
  elementInternalsIDL,
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlElementIncludesHTMLOrSVGOrMathMLElementIDL,
  showPopoverOptionsIDL,
  togglePopoverOptionsIDL,
  htmlUnknownElementIDL,
  htmlHtmlElementIDL,
  htmlScriptElementIDL,
  htmlSlotElementIDL,
  assignedNodesOptionsIDL,
  htmlTemplateElementIDL,
  htmlCanvasElementIDL,
  htmlHeadElementIDL,
  htmlTitleElementIDL,
  htmlBaseElementIDL,
  htmlMetaElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
  htmlBodyElementIDL,
  htmlHeadingElementIDL,
  htmlParagraphElementIDL,
  htmlHRElementIDL,
  htmlPreElementIDL,
  htmlOListElementIDL,
  htmlUListElementIDL,
  htmlMenuElementIDL,
  htmlLIElementIDL,
  htmlDListElementIDL,
  htmlDivElementIDL,
  htmlAnchorElementIDL,
  hyperlinkElementUtilsIDL,
  htmlHyperlinkElementUtilsIDL,
  htmlAnchorElementIncludesHyperlinkElementUtilsIDL,
  htmlAnchorElementIncludesHTMLHyperlinkElementUtilsIDL,
  htmlQuoteElementIDL,
  htmlDataElementIDL,
  htmlTimeElementIDL,
  htmlSpanElementIDL,
  htmlBRElementIDL,
  htmlModElementIDL,
  htmlPictureElementIDL,
  htmlSourceElementIDL,
  htmlImageElementIDL,
  htmlIFrameElementIDL,
  htmlEmbedElementIDL,
  htmlObjectElementIDL,
  htmlMediaElementIDL,
  htmlAudioElementIDL,
  htmlVideoElementIDL,
  htmlTrackElementIDL,
  htmlMapElementIDL,
  htmlAreaElementIDL,
  htmlAreaElementIncludesHyperlinkElementUtilsIDL,
  htmlAreaElementIncludesHTMLHyperlinkElementUtilsIDL,
  htmlTableElementIDL,
  htmlTableCaptionElementIDL,
  htmlTableColElementIDL,
  htmlTableSectionElementIDL,
  htmlTableRowElementIDL,
  htmlTableCellElementIDL,
  htmlFormElementIDL,
  htmlLabelElementIDL,
  htmlInputElementIDL,
  htmlButtonElementIDL,
  htmlSelectElementIDL,
  htmlOptionElementIDL,
  htmlOptGroupElementIDL,
  htmlDataListElementIDL,
  htmlTextAreaElementIDL,
  htmlOutputElementIDL,
  htmlProgressElementIDL,
  htmlMeterElementIDL,
  htmlFieldSetElementIDL,
  htmlLegendElementIDL,
  htmlSelectedContentElementIDL,
  htmlFormControlsCollectionIDL,
  radioNodeListIDL,
  htmlOptionsCollectionIDL,
  htmlDetailsElementIDL,
  htmlDialogElementIDL,
  htmlFrameSetElementIDL,
  htmlFrameElementIDL,
  htmlDirectoryElementIDL,
  htmlFontElementIDL,
  htmlMarqueeElementIDL,
  htmlParamElementIDL,
];
