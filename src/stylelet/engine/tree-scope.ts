import { parseStylesheet } from '../css/stylesheet';
import { CSSStyleSheetImpl } from '../cssom/css-stylesheet';
import {
  domExceptionName, throwDOMException,
} from '../../shared/dom-exception';
import { StyleSheetListImpl } from '../cssom/stylesheet-list';
import {
  createObservableArray, type ObservableArrayHandle,
} from '../../shared/observable-array';
import type { CascadeEngine } from './cascade-engine';

export class TreeScope {
  readonly #styleSheets = new StyleSheetListImpl<CSSStyleSheetImpl>();
  #headerStyleSheetCount = 0;
  readonly #adoptedStyleSheets: ObservableArrayHandle<CSSStyleSheetImpl>;
  #lastStyleSheetSetName: string | null = null;
  #preferredStyleSheetSetName = '';

  constructor(
    readonly root: Document | ShadowRoot,
    readonly cascade: CascadeEngine,
  ) {
    const document = root.ownerDocument ?? root;
    this.#adoptedStyleSheets = createObservableArray({
      convert: toCSSStyleSheet,
      set(styleSheet) {
        if (styleSheet.__isConstructedFor(document)) return;
        throwDOMException(
          domExceptionName.notAllowed,
          'The stylesheet was not constructed for this document.',
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

  addHeaderStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    this.#styleSheets.__insert(this.#headerStyleSheetCount, styleSheet);
    this.#headerStyleSheetCount++;
    this.#configureAddedStyleSheet(styleSheet);
  }

  addTreeStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    const ownerNode = styleSheet.ownerNode;
    const index = ownerNode === null
      ? this.#styleSheets.length
      : findStyleSheetInsertionIndex(this.#styleSheets, ownerNode);

    this.#styleSheets.__insert(index, styleSheet);
    this.#configureAddedStyleSheet(styleSheet);
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
    this.addTreeStyleSheet(styleSheet);
    return styleSheet;
  }

  removeStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    const index = findStyleSheetIndex(this.#styleSheets, styleSheet);
    if (index < 0) return;

    if (index < this.#headerStyleSheetCount) {
      this.#headerStyleSheetCount--;
    }
    if (!this.#styleSheets.__remove(styleSheet)) return;
    styleSheet.__clearAssociation();
  }

  // Internal operations ----------------------------------------------------

  __selectStyleSheetSet(name: string): void {
    this.#enableStyleSheetSet(name);
    this.#lastStyleSheetSetName = name;
  }

  __changePreferredStyleSheetSetName(name: string): void {
    const prev = this.#preferredStyleSheetSetName;
    this.#preferredStyleSheetSetName = name;

    if (name !== prev && this.#lastStyleSheetSetName === null) {
      this.#enableStyleSheetSet(name);
    }
  }

  // Private helpers ---------------------------------------------------------

  #configureAddedStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    if (styleSheet.disabled) return;

    const title = styleSheet.title ?? '';
    if (
      title !== '' &&
      !styleSheet.__isAlternate() &&
      this.#preferredStyleSheetSetName === ''
    ) {
      this.__changePreferredStyleSheetSetName(title);
    }

    const matchesPreferred =
      this.#lastStyleSheetSetName === null &&
      title === this.#preferredStyleSheetSetName;
    if (
      title === '' ||
      matchesPreferred ||
      title === this.#lastStyleSheetSetName
    ) {
      styleSheet.disabled = false;
      return;
    }

    styleSheet.disabled = true;
  }

  #enableStyleSheetSet(name: string): void {
    for (const styleSheet of this.#styleSheets) {
      const title = styleSheet.title ?? '';
      if (title !== '') styleSheet.disabled = name !== title;
    }
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

function findStyleSheetIndex(
  styleSheets: StyleSheetList,
  target: CSSStyleSheet,
): number {
  let index = 0;
  for (const styleSheet of styleSheets) {
    if (styleSheet === target) return index;
    index++;
  }
  return -1;
}
