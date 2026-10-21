import {
  defineInterfaceMixin, definePartialInterfaceMixin, nullable, roAttr, reference,
} from '../../../web-idl/core/index';
import type { CSSStyleSheetImpl, StyleSheetListImpl } from '../../../stylelet/index';

import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import type { ShadowRootImpl } from './shadow-root';

/** Focus and style-sheet behavior shared by documents and shadow roots. */
// https://dom.spec.whatwg.org/#mixin-documentorshadowroot
export class DocumentOrShadowRootMixin {
  /** Document or shadow root including this mixin. */
  #root: DocumentImpl | ShadowRootImpl;

  constructor(root: DocumentImpl | ShadowRootImpl) {
    this.#root = root;
  }

  /** Focused area's element visible from this tree, with the document's body/root fallback. */
  // https://html.spec.whatwg.org/multipage/interaction.html#dom-document-activeelement
  get activeElement(): ElementImpl | null {
    const root = this.#root;
    const anchor = root.nodeDocument.focusedArea.domAnchor;
    // A focus anchor is a Document or Element; retargeting can only replace it with a shadow host.
    const candidate = anchor.retargetAgainst(root) as DocumentImpl | ElementImpl;
    if (candidate.getRoot() !== root) return null;
    if (!candidate.isDocument()) return candidate;
    return candidate.body ?? candidate.documentElement;
  }

  /** Sheets supplied by style and link nodes in this tree scope. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-stylesheets
  get styleSheets(): StyleSheetListImpl {
    return this.#root.getStyleScope().styleSheets;
  }

  /** Constructed sheets adopted by this tree scope. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-adoptedstylesheets
  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#root.getStyleScope().adoptedStyleSheets;
  }
}

/*
 * interface mixin DocumentOrShadowRoot {
 *   readonly attribute CustomElementRegistry? customElementRegistry;
 * };
 */
export const documentOrShadowRootIDL = defineInterfaceMixin({
  name: 'DocumentOrShadowRoot',
  members: [roAttr('customElementRegistry', nullable(reference('CustomElementRegistry')))],
});

/*
 * partial interface mixin DocumentOrShadowRoot {
 *   readonly attribute Element? activeElement;
 * };
 */
// https://html.spec.whatwg.org/multipage/dom.html#the-documentorshadowroot-interface
export const htmlDocumentOrShadowRootIDL = definePartialInterfaceMixin({
  name: 'DocumentOrShadowRoot',
  members: [roAttr('activeElement', nullable(reference('Element')))],
});
