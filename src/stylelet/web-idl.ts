import {
  attr, defineInterfaceMixin, definePartialInterfaceMixin, idlType, nullable,
  readonlyAttr, xattr, type Definition,
} from '../web-idl/declaration/index';

/*
 * partial interface mixin DocumentOrShadowRoot {
 *   [SameObject] readonly attribute StyleSheetList styleSheets;
 *   attribute ObservableArray<CSSStyleSheet> adoptedStyleSheets;
 * };
 */
const cssomDocumentOrShadowRootIDL = definePartialInterfaceMixin({
  members: [
    readonlyAttr('styleSheets', idlType.object, xattr('SameObject')),
    // TODO(Web IDL observable arrays): Restore ObservableArray<CSSStyleSheet>
    // when the specialized attribute proxy is available.
    attr('adoptedStyleSheets', idlType.any),
  ],
  name: 'DocumentOrShadowRoot',
});

/*
 * interface mixin ElementCSSInlineStyle {
 *   [SameObject, PutForwards=cssText]
 *   readonly attribute CSSStyleProperties style;
 * };
 */
const elementCSSInlineStyleIDL = defineInterfaceMixin({
  members: [readonlyAttr('style', idlType.object, xattr(
    'SameObject',
    ['PutForwards', 'cssText'],
  ))],
  name: 'ElementCSSInlineStyle',
});

/*
 * interface mixin LinkStyle {
 *   readonly attribute CSSStyleSheet? sheet;
 * };
 */
const linkStyleIDL = defineInterfaceMixin({
  members: [readonlyAttr('sheet', nullable(idlType.object))],
  name: 'LinkStyle',
});

export const styleletIDLDefinitions: readonly Definition[] = [
  cssomDocumentOrShadowRootIDL,
  elementCSSInlineStyleIDL,
  linkStyleIDL,
];
