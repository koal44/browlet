import {
  defineInterfaceMixin, nullable, roAttr, reference,
} from '../../../web-idl/index';
import type { TreeScope } from '../../../stylelet/engine/tree-scope';
import type { CSSStyleSheetImpl } from '../../../stylelet/cssom/css-stylesheet';
import type { StyleSheetListImpl } from '../../../stylelet/cssom/stylesheet-list';
import type { CustomElementRegistryImpl } from '../../html/custom-elements/registry';

/*
 * interface mixin DocumentOrShadowRoot {
 *   readonly attribute CustomElementRegistry? customElementRegistry;
 * };
 *
 * CSSOM contributes the styleSheets and adoptedStyleSheets partial members.
 */
export class DocumentOrShadowRootMixin {
  readonly #options: DocumentOrShadowRootMixinOptions;

  constructor(options: DocumentOrShadowRootMixinOptions) {
    this.#options = options;
  }

  get customElementRegistry(): CustomElementRegistryImpl | null {
    return this.#options.getCustomElementRegistry();
  }

  get styleSheets(): StyleSheetListImpl {
    return this.#options.getStyleScope().styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#options.getStyleScope().adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheetImpl[]) {
    this.#options.getStyleScope().setAdoptedStyleSheets(styleSheets);
  }
}

// -- Web IDL ------------------------------------------------------------

export const documentOrShadowRootIDL = defineInterfaceMixin({
  name: 'DocumentOrShadowRoot',
  members: [roAttr(
    'customElementRegistry',
    nullable(reference('CustomElementRegistry')),
  )],
});

type DocumentOrShadowRootMixinOptions = {
  getCustomElementRegistry(): CustomElementRegistryImpl | null;
  getStyleScope(): TreeScope;
};
