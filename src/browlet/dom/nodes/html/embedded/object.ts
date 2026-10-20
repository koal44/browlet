import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory, transparentContent } from '../../element-definitions/index';

import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';
import { HTMLEmbedElementImpl } from './embed';

/** Object identity and exposure state used by Document's named properties. */
// https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-object-element
export class HTMLObjectElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLObject;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Palpable,
      ContentCategory.FormAssociated, ContentCategory.Listed,
    ];
    this.prototype.contentModel = { childRules: [transparentContent] };
  }

  #showsFallbackContent = false;

  /** Whether resource selection has chosen the element's fallback content. */
  // TODO(HTML §4.8.7): object loading must maintain this state as its representation changes.
  get showsFallbackContent(): boolean {
    return this.#showsFallbackContent;
  }

  set showsFallbackContent(value: boolean) {
    if (value === this.#showsFallbackContent) return;
    this.#showsFallbackContent = value;
    this.nodeDocument.collectionVersion++;
  }

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return this.isExposed() ? 'name-or-id' : 'none';
  }

  /** Eligible for Document named access, considering exposed ancestors and fallback descendants. */
  // https://html.spec.whatwg.org/multipage/dom.html#exposed
  // SPEC_CLASH(document-named-object-exposure): follow HTML's fallback-sensitive rule; browser rules differ.
  isExposed(): boolean {
    if (hasExposedObjectAncestor(this)) return false;
    if (!this.showsFallbackContent) return true;
    for (let node = this.firstChild; node; node = node.nextDescendant(this)) {
      if (node instanceof HTMLObjectElementImpl || node instanceof HTMLEmbedElementImpl) return false;
    }
    return true;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLObjectElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString data;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [CEReactions, Reflect] attribute DOMString name;
 *   readonly attribute HTMLFormElement? form;
 *   [CEReactions, Reflect] attribute DOMString width;
 *   [CEReactions, Reflect] attribute DOMString height;
 *   readonly attribute Document? contentDocument;
 *   readonly attribute WindowProxy? contentWindow;
 *   Document? getSVGDocument();
 *
 *   readonly attribute boolean willValidate;
 *   readonly attribute ValidityState validity;
 *   readonly attribute DOMString validationMessage;
 *   boolean checkValidity();
 *   boolean reportValidity();
 *   undefined setCustomValidity(DOMString error);
 *
 *   // also has obsolete members
 * };
 */
export const htmlObjectElementIDL = defineInterface({
  name: 'HTMLObjectElement', inherits: 'HTMLElement', exposed: 'Window',
  implementation: impl(HTMLObjectElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['object'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});

/** Shared ancestor condition for object and embed exposure. */
export function hasExposedObjectAncestor(element: HTMLObjectElementImpl | HTMLEmbedElementImpl): boolean {
  // Each object ancestor already has an object/embed descendant: element itself.
  // Fallback ancestors cannot be exposed; the outermost non-fallback ancestor is exposed.
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLObjectElementImpl && !ancestor.showsFallbackContent) return true;
  }
  return false;
}
