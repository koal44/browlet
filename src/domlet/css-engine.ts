import type { Document as DomletDocument } from './nodes/document';
import type {
  HTMLLinkElement, HTMLStyleElement, SVGStyleElement,
} from './nodes/element';
import { isText } from './nodes/node';
import { createStylelet, type Stylelet } from '../stylelet/stylelet';

export function withCssEngine<T extends DomletDocument>(document: T): T {
  if (!cssEngines.has(document)) {
    cssEngines.set(document, undefined);
  }

  return document;
}

export function getCssEngine(document: DomletDocument): Stylelet {
  if (!cssEngines.has(document)) {
    throw new Error('Document is not associated with a CSS engine');
  }

  let cssEngine = cssEngines.get(document);
  if (!cssEngine) {
    cssEngine = createStylelet(document as unknown as Document);
    cssEngines.set(document, cssEngine);
  }

  return cssEngine;
}

const cssEngines = new WeakMap<DomletDocument, Stylelet | undefined>();

/*
 * interface mixin DocumentOrShadowRoot {
 *   [SameObject] readonly attribute StyleSheetList styleSheets;
 * };
 */
export function getStyleSheets(
  document: DomletDocument,
): StyleSheetList {
  return getCssEngine(document).styleSheets;
}

/*
 * interface mixin LinkStyle {
 *   readonly attribute CSSStyleSheet? sheet;
 * };
 */
type LinkStyleElement =
  | HTMLLinkElement
  | HTMLStyleElement
  | SVGStyleElement;

export class LinkStyleState {
  readonly #owner: LinkStyleElement;
  #sheet: CSSStyleSheet | null = null;
  #deferred = false;

  constructor(owner: LinkStyleElement) {
    this.#owner = owner;
  }

  get sheet(): CSSStyleSheet | null {
    return this.#sheet;
  }

  defer(): void {
    this.#deferred = true;
  }

  finish(): void {
    this.#deferred = false;
    this.update();
  }

  update(): void {
    if (this.#deferred) return;

    const document = this.#owner.ownerDocument;
    if (!document) {
      this.#sheet = null;
      return;
    }

    const cssEngine = getCssEngine(document);
    if (this.#sheet) cssEngine.removeStyleSheet(this.#sheet);

    const type = this.#owner.getAttribute('type')?.toLowerCase() ?? '';
    if (
      !this.#owner.isConnected ||
      this.#owner.localName === 'link' ||
      (type !== '' && type !== 'text/css')
    ) {
      this.#sheet = null;
      return;
    }

    let source = '';
    for (
      let child = this.#owner.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (isText(child)) source += child.data;
    }

    this.#sheet = cssEngine.createInlineStyleSheet(
      this.#owner as unknown as Element,
      source,
      {
        media: this.#owner.getAttribute('media') ?? '',
        title: this.#owner.getAttribute('title') ?? '',
      },
    );
  }
}
