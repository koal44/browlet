import {
  arg, attr, defineInterfaceMixin, definePartialInterface, definePartialInterfaceMixin, defineTypedef,
  idlType, nullable, observableArray, op, reference, roAttr, xattr,
  type Definition,
} from '../web-idl/core/index';

import type { StyleletEnvironment } from './environment';
import {
  mediaListIDL, styleSheetIDL, styleSheetListIDL, cssStyleSheetIDL, cssStyleSheetInitIDL, legacyCSSStyleSheetIDL, StyleSheetListImpl,
  cssRuleIDL, cssRuleListIDL, cssGroupingRuleIDL, cssStyleRuleIDL, cssNestedDeclarationsIDL, cssPropertyRuleIDL,
  cssAnimationsRuleIDL, cssCounterStylesRuleIDL, cssConditionalRuleIDL, cssFontsRuleIDL,
  cssStyleDeclarationIDL, cssStylePropertiesIDL, CSSStylePropertiesImpl, CSSStyleSheetImpl,
} from './cssom/index';
import type { TreeScope } from './engine/index';

// CSSOM permits either DOMString or USVString. Keep DOMString conversion;
// CSS input preprocessing separately replaces lone surrogates during parsing.
// https://drafts.csswg.org/cssom/#cssomstring-type
/*
 * typedef DOMString CSSOMString;
 */
const cssomStringIDL = defineTypedef({ name: 'CSSOMString', type: idlType.DOMString });

// https://drafts.csswg.org/cssom/#extensions-to-the-document-or-shadow-root-interface
/*
 * partial interface mixin DocumentOrShadowRoot {
 *   [SameObject] readonly attribute StyleSheetList styleSheets;
 *   attribute ObservableArray<CSSStyleSheet> adoptedStyleSheets;
 * };
 */
const cssomDocumentOrShadowRootIDL = definePartialInterfaceMixin({
  name: 'DocumentOrShadowRoot',
  members: [
    roAttr('styleSheets', reference(StyleSheetListImpl), xattr('SameObject')),
    attr('adoptedStyleSheets', observableArray(reference(CSSStyleSheetImpl)), {
      observableArraySteps: {
        // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-adoptedstylesheets
        set(this: { getStyleScope(): TreeScope; }, value: CSSStyleSheetImpl) {
          this.getStyleScope().checkAdoptedStyleSheet(value);
        },
      },
    }),
  ],
});

// https://drafts.csswg.org/cssom/#the-elementcssinlinestyle-mixin
/*
 * interface mixin ElementCSSInlineStyle {
 *   [SameObject, PutForwards=cssText]
 *   readonly attribute CSSStyleProperties style;
 * };
 */
const elementCSSInlineStyleIDL = defineInterfaceMixin({
  name: 'ElementCSSInlineStyle',
  members: [roAttr('style', reference(CSSStylePropertiesImpl), xattr(
    'SameObject',
    ['PutForwards', 'cssText'],
  ))],
});

// https://drafts.csswg.org/cssom/#the-linkstyle-interface
/*
 * interface mixin LinkStyle {
 *   readonly attribute CSSStyleSheet? sheet;
 * };
 */
const linkStyleIDL = defineInterfaceMixin({
  name: 'LinkStyle',
  members: [roAttr('sheet', nullable(reference(CSSStyleSheetImpl)))],
});

// The implementation still returns a limited computed snapshot. This declaration
// establishes projection and author conversion, not the complete §7.2 algorithm.
// https://drafts.csswg.org/cssom/#extensions-to-the-window-interface
/*
 * partial interface Window {
 *   [NewObject] CSSStyleProperties getComputedStyle(Element elt, optional CSSOMString? pseudoElt);
 * };
 */
const cssomWindowIDL = definePartialInterface({
  name: 'Window',
  members: [
    op('getComputedStyle', reference(CSSStylePropertiesImpl),
      [
        arg('elt', reference('Element')),
        arg('pseudoElt', nullable(reference('CSSOMString')), { optional: true }),
      ],
      xattr('NewObject'),
    ),
  ],
});

/** CSSOM interfaces and host amendments supplied to the host's Web IDL assembly. */
export const styleletIDLDefinitions: Definition<StyleletEnvironment>[] = [
  cssomStringIDL,
  mediaListIDL,
  styleSheetIDL, styleSheetListIDL, cssStyleSheetInitIDL, legacyCSSStyleSheetIDL,
  cssRuleIDL, cssAnimationsRuleIDL, cssCounterStylesRuleIDL, cssConditionalRuleIDL, cssFontsRuleIDL,
  cssRuleListIDL, cssGroupingRuleIDL, cssStyleRuleIDL, cssNestedDeclarationsIDL, cssPropertyRuleIDL,
  cssStyleDeclarationIDL,
  cssomDocumentOrShadowRootIDL,
  elementCSSInlineStyleIDL,
  linkStyleIDL,
  cssomWindowIDL,
  cssStyleSheetIDL, cssStylePropertiesIDL,
];
