import {
  defineInterfaceMixin, nullable, readonlyAttr, reference,
} from '../../../web-idl/declaration/index';
import type { TreeScope } from '../../../stylelet/engine/tree-scope';

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

  get customElementRegistry(): CustomElementRegistry | null {
    return this.#options.getCustomElementRegistry();
  }

  get styleSheets(): StyleSheetList {
    return this.#options.getStyleScope().styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheet[] {
    return this.#options.getStyleScope().adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheet[]) {
    this.#options.getStyleScope().setAdoptedStyleSheets(styleSheets);
  }
}

// -- Web IDL ------------------------------------------------------------

export const documentOrShadowRootIDL = defineInterfaceMixin({
  members: [readonlyAttr(
    'customElementRegistry',
    nullable(reference('CustomElementRegistry')),
  )],
  name: 'DocumentOrShadowRoot',
});

type DocumentOrShadowRootMixinOptions = {
  getCustomElementRegistry(): CustomElementRegistry | null;
  getStyleScope(): TreeScope;
};
