import type { CSSStyleDeclarationImpl } from './cssom/declaration';
import type { CSSStyleSheetImpl } from './cssom/css-stylesheet';
import { CascadeEngine } from './engine/cascade-engine';
import { TreeScope } from './engine/tree-scope';
import { StyleletContext } from './context';
import type { Promises } from '../js-engine/promises';
import type { DOMExceptionName } from '../web-idl/core/index';

export class Stylelet {
  readonly version = 'stylelet-__VERSION__';
  readonly context: StyleletContext;
  readonly documentScope: TreeScope;

  readonly #cascade: CascadeEngine;

  constructor(
    document: Document,
    options: StyleletOptions = {},
  ) {
    this.context = new StyleletContext(document, options);
    this.#cascade = new CascadeEngine({
      environmentBaseUrl: new URL(document.baseURI),
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

export type StyleletOptions = {
  document?: DocumentCaps;
  element?: ElementCaps;
  tree?: TreeCaps;
  runtime?: RuntimeCaps;
};

export type DocumentCaps = {
  designMode?: (document: Document) => string | undefined;
};

export type ElementCaps = {
  getId?: (element: Element) => string;
  getClass?: (element: Element) => string;
  getLocalName?: (element: Element) => string;
  getNamespaceURI?: (element: Element) => string | null;
  getAttribute?: (element: Element, name: string) => string | null;
  getAttributeNS?: (
    element: Element,
    namespace: string | null,
    localName: string,
  ) => string | null;
  hasAttribute?: (element: Element, name: string) => boolean;
  hasAttributeNS?: (
    element: Element,
    namespace: string | null,
    localName: string,
  ) => boolean;
  hasCustomState?: (element: Element, name: string) => boolean;
};

export type TreeCaps = {
  version?: (root: Node) => number | undefined;
};

/** Execution and failure facilities supplied by the embedding host. */
export type RuntimeCaps = {
  readonly promises: Promises;
  runInParallel(steps: () => void): void;
  createDOMException(name: DOMExceptionName, message?: string): DOMException;
};

// Hosts can configure the small Promise facility without loading JSRealm or JSRuntime.
export { defaultRuntimeCaps, StyleletContext } from './context';
export { Promises } from '../js-engine/promises';
export type { NativePromiseObserver, PromiseValue } from '../js-engine/promises';
export type { DOMExceptionName };
