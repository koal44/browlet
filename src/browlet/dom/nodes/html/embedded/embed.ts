import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';
import { hasExposedObjectAncestor } from './object';

/** Embed identity and exposure used by Document's named properties. */
// https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-embed-element
// PROVISIONAL: embedded-content loading and the remaining embed API await §4.8.6.
export class HTMLEmbedElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return this.isExposed() ? 'name' : 'none';
  }

  /** Eligible for Document named access when no exposed object ancestor hides it. */
  // https://html.spec.whatwg.org/multipage/dom.html#exposed
  isExposed(): boolean {
    return !hasExposedObjectAncestor(this);
  }
}

/*
 * HTMLEmbedElement's identity fragment; its attribute/API algorithms remain in §4.8.6.
 * [Exposed=Window] interface HTMLEmbedElement : HTMLElement {};
 */
export const htmlEmbedElementIDL = defineInterface({
  name: 'HTMLEmbedElement', inherits: 'HTMLElement', exposed: 'Window',
  implementation: impl(HTMLEmbedElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['embed'],
  members: [],
});
