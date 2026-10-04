import type { CSSStyleDeclarationImpl } from './cssom/declaration';
import type {
  DOMDocument as Document, DOMElement as Element,
} from '../infra/index';
import type { CSSStyleSheetImpl, CSSStyleSheetInit } from './cssom/css-stylesheet';
import { CascadeEngine } from './engine/cascade-engine';
import { TreeScope } from './engine/tree-scope';
import { StyleletContext } from './context';
import { createStyleletEnvironment, type StyleletOptions } from './environment';

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
export { InternalPromise } from '../infra/promises';
export type { StyleletOptions } from './environment';
