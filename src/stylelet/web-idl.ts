import {
  attr, defineInterfaceMixin, definePartialInterfaceMixin, idlType, nullable,
  roAttr, xattr, type Definition,
} from '../web-idl/declaration/index';

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
    // TODO(Web IDL observable arrays): Restore ObservableArray<CSSStyleSheet>
    // when the specialized attribute proxy is available.
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
  cssomDocumentOrShadowRootIDL,
  elementCSSInlineStyleIDL,
  linkStyleIDL,
];
