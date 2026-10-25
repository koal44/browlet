import type { DOMDocument as Document, DOMElement as Element } from '../infra/index';
import { TypeError } from '../infra/exceptions';
import { parseURL } from '../url/index';

import type { StyleletOptions } from './environment';
import { StyleletContext } from './context';
import type { CSSStyleDeclarationImpl, CSSStyleSheetImpl, CSSStyleSheetInit } from './cssom/index';
import { CascadeEngine, TreeScope } from './engine/index';

/** Host-supplied entry point for one document's stylesheets and current style-query implementation. */
export class Stylelet {
  /** Build version substituted when the Stylelet package is bundled. */
  version = 'stylelet-__VERSION__' as const;
  /** Document state and caches shared by matching and stylesheet operations. */
  context: StyleletContext;
  /** The document's associated and adopted stylesheet collections. */
  documentScope: TreeScope;

  /** Declaration selection and style-query engine used by this instance. */
  #cascade: CascadeEngine;

  /** Retain the host environment and establish this document's matching and stylesheet state. */
  constructor(document: Document, { env }: StyleletOptions) {
    this.context = new StyleletContext(document, env);
    const environmentBaseUrl = parseURL(this.context.dom.baseURI(document), null, 'UTF-8', env.userAgent).url;
    if (environmentBaseUrl === null) throw new TypeError('The document base URL is invalid.');
    this.#cascade = new CascadeEngine({
      environmentBaseUrl,
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
