import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';
import { HTMLEmbedElementImpl } from './embed';

/** Object identity and exposure state used by Document's named properties. */
// https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-object-element
// PROVISIONAL: resource selection, fallback activation, and the remaining object API await §4.8.7.
export class HTMLObjectElementImpl extends HTMLElementImpl {
  #showsFallbackContent = false;

  override readonly isAllNamedElement = true;

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
 * HTMLObjectElement's identity fragment; its attribute/API algorithms remain in §4.8.7.
 * [Exposed=Window] interface HTMLObjectElement : HTMLElement {};
 */
export const htmlObjectElementIDL = defineInterface({
  name: 'HTMLObjectElement', inherits: 'HTMLElement', exposed: 'Window',
  implementation: impl(HTMLObjectElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['object'],
  members: [],
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
