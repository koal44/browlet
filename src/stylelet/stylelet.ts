import type { DOMDocument as Document, DOMElement as Element } from '../infra/index';

import { createStyleletEnvironment, type StyleletOptions } from './environment';
import { StyleletContext } from './context';
import type { CSSStyleDeclarationImpl, CSSStyleSheetImpl, CSSStyleSheetInit } from './cssom/index';
import { CascadeEngine, TreeScope } from './engine/index';

/** Standalone entry point for one document's stylesheets and current style-query implementation. */
export class Stylelet {
  /** Build version substituted when the Stylelet package is bundled. */
  version = 'stylelet-__VERSION__' as const;
  /** Document state and caches shared by matching and stylesheet operations. */
  context: StyleletContext;
  /** The document's associated and adopted stylesheet collections. */
  documentScope: TreeScope;

  /** Declaration selection and style-query engine used by this instance. */
  #cascade: CascadeEngine;

  /** Compose the host environment, matching context, and document stylesheet scope. */
  constructor(document: Document, options: StyleletOptions = {}) {
    const env = createStyleletEnvironment(options);
    this.context = new StyleletContext(document, env);
    this.#cascade = new CascadeEngine({
      environmentBaseUrl: new env.userAgent.URL(this.context.dom.baseURI(document)),
      context: this.context,
    });
    this.documentScope = new TreeScope(document, this.#cascade);
  }

  /** Create a constructed stylesheet owned by this document. */
  createStyleSheet(options: Partial<CSSStyleSheetInit> = {}): CSSStyleSheetImpl {
    return this.#cascade.createStyleSheet(options);
  }

  /** Obtain the current limited computed-style snapshot for an element. */
  getComputedStyle(element: Element): CSSStyleDeclarationImpl {
    return this.#cascade.getComputedStyle(element, this.documentScope);
  }
}

export { StyleletContext } from './context';
export type { StyleletOptions } from './environment';
