import {
  arg, attr, defineInterfaceMixin, definePartialInterface, definePartialInterfaceMixin, defineTypedef,
  idlType, nullable, op, reference, roAttr, xattr,
  type Definition,
} from '../web-idl/core/index';

import type { StyleletEnvironment } from './environment';
import {
  mediaListIDL, styleSheetIDL, styleSheetListIDL, cssStyleSheetIDL, cssStyleSheetInitIDL, legacyCSSStyleSheetIDL, StyleSheetListImpl,
  cssRuleIDL, cssRuleListIDL, cssGroupingRuleIDL, cssStyleRuleIDL, cssNestedDeclarationsIDL, cssPropertyRuleIDL,
  cssStyleDeclarationIDL, cssStylePropertiesIDL, CSSStylePropertiesImpl, CSSStyleSheetImpl,
} from './cssom/index';

// CSSOM permits either DOMString or USVString. Keep DOMString conversion;
// CSS input preprocessing separately replaces lone surrogates during parsing.
// https://drafts.csswg.org/cssom/#cssomstring-type
/*
 * typedef DOMString CSSOMString;
 */
const cssomStringIDL = defineTypedef({ name: 'CSSOMString', type: idlType.DOMString });

// Adoption still awaits its §6.2 binding.

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
    // TODO(CSSOM interface projection): Restore ObservableArray<CSSStyleSheet>
    // when adoption mutation steps are bound.
    attr('adoptedStyleSheets', idlType.any),
  ],
});

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

export const styleletIDLDefinitions: Definition<StyleletEnvironment>[] = [
  cssomStringIDL,
  mediaListIDL,
  styleSheetIDL, styleSheetListIDL, cssStyleSheetInitIDL, legacyCSSStyleSheetIDL,
  cssRuleIDL, cssRuleListIDL, cssGroupingRuleIDL, cssStyleRuleIDL, cssNestedDeclarationsIDL, cssPropertyRuleIDL,
  cssStyleDeclarationIDL,
  cssomDocumentOrShadowRootIDL,
  elementCSSInlineStyleIDL,
  linkStyleIDL,
  cssomWindowIDL,
  cssStyleSheetIDL, cssStylePropertiesIDL,
];
