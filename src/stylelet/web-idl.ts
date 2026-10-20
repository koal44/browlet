import {
  attr, defineInterfaceMixin, definePartialInterfaceMixin, defineTypedef, idlType, nullable, roAttr, xattr,
  type Definition,
} from '../web-idl/core/index';

import { mediaListIDL } from './cssom/index';

// CSSOM permits either DOMString or USVString. Keep DOMString conversion;
// CSS input preprocessing separately replaces lone surrogates during parsing.
// https://drafts.csswg.org/cssom/#cssomstring-type
/*
 * typedef DOMString CSSOMString;
 */
const cssomStringIDL = defineTypedef({ name: 'CSSOMString', type: idlType.DOMString });

// These object-typed CSSOM members are provisional. Stylelet must define and
// export the CSSOM interfaces before Browlet can project their semantic
// implementations; do not patch individual host returns around that boundary.

/*
 * partial interface mixin DocumentOrShadowRoot {
 *   [SameObject] readonly attribute StyleSheetList styleSheets;
 *   attribute ObservableArray<CSSStyleSheet> adoptedStyleSheets;
 * };
 */
const cssomDocumentOrShadowRootIDL = definePartialInterfaceMixin({
  name: 'DocumentOrShadowRoot',
  members: [
    roAttr('styleSheets', idlType.object, xattr('SameObject')),
    // TODO(CSSOM interface projection): Restore ObservableArray<CSSStyleSheet>
    // when CSSStyleSheet projection and adoption mutation steps are bound.
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
  members: [roAttr('style', idlType.object, xattr(
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
  members: [roAttr('sheet', nullable(idlType.object))],
});

export const styleletIDLDefinitions: Definition[] = [
  cssomStringIDL,
  mediaListIDL,
  cssomDocumentOrShadowRootIDL,
  elementCSSInlineStyleIDL,
  linkStyleIDL,
];
