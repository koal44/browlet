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

  /** Create the query engine over the document's retained stylesheet state. */
  constructor(documentScope: TreeScope) {
    this.documentScope = documentScope;
    this.context = documentScope.context;
    const { document, dom, env } = this.context;
    const environmentBaseUrl = parseURL(dom.baseURI(document), null, 'UTF-8', env.userAgent).url;
    if (environmentBaseUrl === null) throw new TypeError('The document base URL is invalid.');
    this.#cascade = new CascadeEngine({
      environmentBaseUrl,
      context: this.context,
    });
  }

  /** Create a document scope and engine together for a host that does not retain its own scope. */
  static create(document: Document, { env }: StyleletOptions): Stylelet {
    return new Stylelet(new TreeScope(document, new StyleletContext(document, env)));
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
