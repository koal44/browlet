import type { DOMDocument as Document, DOMElement as Element } from '../infra/index';

import { createStyleletEnvironment, type StyleletOptions } from './environment';
import { StyleletContext } from './context';
import type { CSSStyleDeclarationImpl, CSSStyleSheetImpl, CSSStyleSheetInit } from './cssom/index';
import { CascadeEngine, TreeScope } from './engine/index';

export class Stylelet {
  version = 'stylelet-__VERSION__' as const;
  context: StyleletContext;
  documentScope: TreeScope;

  #cascade: CascadeEngine;

  constructor(document: Document, options: StyleletOptions = {}) {
    const env = createStyleletEnvironment(options);
    this.context = new StyleletContext(document, env);
    this.#cascade = new CascadeEngine({
      environmentBaseUrl: new env.userAgent.URL(this.context.dom.baseURI(document)),
      context: this.context,
    });
    this.documentScope = new TreeScope(document, this.#cascade);
  }

  createStyleSheet(options: CSSStyleSheetInit = {}): CSSStyleSheetImpl {
    return this.#cascade.createStyleSheet(options);
  }

  getComputedStyle(element: Element): CSSStyleDeclarationImpl {
    return this.#cascade.getComputedStyle(element, this.documentScope);
  }
}

export { StyleletContext } from './context';
export type { StyleletOptions } from './environment';
