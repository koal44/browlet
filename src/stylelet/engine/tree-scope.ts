import { parseStylesheet } from '../css/stylesheet';
import { CSSStyleSheetImpl } from '../cssom/css-stylesheet';
import { domExceptionName } from '../cssom/exceptions';
import { StyleSheetListImpl } from '../cssom/stylesheet-list';
import {
  createObservableArray, type ObservableArrayHandle,
} from '../../shared/observable-array';
import type { CascadeEngine } from './cascade-engine';

export class TreeScope {
  readonly #styleSheets = new StyleSheetListImpl<CSSStyleSheetImpl>();
  readonly #adoptedStyleSheets: ObservableArrayHandle<CSSStyleSheetImpl>;

  constructor(
    readonly root: Document | ShadowRoot,
    readonly cascade: CascadeEngine,
  ) {
    const document = root.ownerDocument ?? root;
    this.#adoptedStyleSheets = createObservableArray({
      convert: toCSSStyleSheet,
      set(styleSheet) {
        if (styleSheet.__isConstructedFor(document)) return;
        throw new DOMException(
          'The stylesheet was not constructed for this document.',
          domExceptionName.notAllowed,
        );
      },
    });
  }

  get styleSheets(): StyleSheetList {
    return this.#styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#adoptedStyleSheets.value;
  }

  setAdoptedStyleSheets(styleSheets: unknown): void {
    this.#adoptedStyleSheets.replace(styleSheets);
  }

  *finalStyleSheets(): IterableIterator<CSSStyleSheetImpl> {
    yield* this.#styleSheets;
    yield* this.#adoptedStyleSheets.value;
  }

  addStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    const ownerNode = styleSheet.ownerNode;
    const index = ownerNode === null
      ? this.#styleSheets.length
      : findStyleSheetInsertionIndex(this.#styleSheets, ownerNode);

    this.#styleSheets.__insert(index, styleSheet);
  }

  createStyleElementStyleSheet(
    ownerNode: Element,
    source: string,
    {
      media = '',
      title = '',
    }: StyleElementStyleSheetOptions = {},
  ): CSSStyleSheetImpl {
    const snapshot = this.cascade.snapshot;

    const styleSheet = CSSStyleSheetImpl.__create(
      snapshot,
      {
        location: null,
        parentStyleSheet: null,
        ownerNode,
        ownerRule: null,
        media,
        title,
        alternate: false,
        originClean: true,
      },
      parseStylesheet(source, {
        baseUrl: new URL((this.root.ownerDocument ?? this.root).baseURI),
      }),
    );
    this.addStyleSheet(styleSheet);
    return styleSheet;
  }

  removeStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    if (!this.#styleSheets.__remove(styleSheet)) return;
    styleSheet.__clearAssociation();
  }
}

function toCSSStyleSheet(value: unknown): CSSStyleSheetImpl {
  if (value instanceof CSSStyleSheetImpl) return value;
  throw new TypeError('Expected a CSSStyleSheet');
}

export type StyleElementStyleSheetOptions = {
  media?: string;
  title?: string;
};

function findStyleSheetInsertionIndex(
  styleSheets: StyleSheetList,
  ownerNode: Node,
): number {
  let index = 0;

  for (const styleSheet of styleSheets) {
    const currentOwner = styleSheet.ownerNode;
    if (
      currentOwner !== null &&
      (ownerNode.compareDocumentPosition(currentOwner) &
        DOCUMENT_POSITION_FOLLOWING)
    ) {
      return index;
    }

    index++;
  }

  return index;
}

const DOCUMENT_POSITION_FOLLOWING = 0x04;
