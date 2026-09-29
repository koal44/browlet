import {
  defineInterfaceMixin, nullable, roAttr, reference,
} from '../../../web-idl/index';
import type { TreeScope, CSSStyleSheetImpl, StyleSheetListImpl } from '../../../stylelet/index';
import type { CustomElementRegistryImpl } from '../../html/custom-elements/registry';

/** Registry access and style-sheet ownership shared by documents and shadow roots. */
// https://dom.spec.whatwg.org/#mixin-documentorshadowroot
export class DocumentOrShadowRootMixin {
  /** Access to the includer's registry and lazily initialized style scope. */
  #options: DocumentOrShadowRootMixinOptions;

  constructor(options: DocumentOrShadowRootMixinOptions) {
    this.#options = options;
  }

  /** Registry currently associated with the containing document or shadow root. */
  // https://dom.spec.whatwg.org/#dom-documentorshadowroot-customelementregistry
  get customElementRegistry(): CustomElementRegistryImpl | null {
    return this.#options.getCustomElementRegistry();
  }

  /** Sheets supplied by style and link nodes in this tree scope. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-stylesheets
  get styleSheets(): StyleSheetListImpl {
    return this.#options.getStyleScope().styleSheets;
  }

  /** Constructed sheets adopted by this tree scope. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-adoptedstylesheets
  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#options.getStyleScope().adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheetImpl[]) {
    this.#options.getStyleScope().setAdoptedStyleSheets(styleSheets);
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

type DocumentOrShadowRootMixinOptions = {
  /** Read the includer's current custom element registry. */
  getCustomElementRegistry(): CustomElementRegistryImpl | null;
  /** Initialize or retrieve the tree scope used for CSSOM operations. */
  getStyleScope(): TreeScope;
};
