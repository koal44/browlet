import { parseStylesheet } from '../css/stylesheet';
import {
  treeScopeBrand, type TreeScope,
} from '../css/tree-scope';
import { CSSStyleSheetImpl } from '../cssom/css-stylesheet';
import {
  insertStyleSheet, removeStyleSheet, StyleSheetListImpl,
} from '../cssom/stylesheet-list';
import type { CascadeEngine } from './cascade-engine';

export class DocumentOrShadowRootStyleState implements TreeScope {
  readonly #styleSheets = new StyleSheetListImpl<CSSStyleSheetImpl>();
  readonly #adoptedStyleSheets: CSSStyleSheetImpl[] = [];

  readonly [treeScopeBrand] = true;

  constructor(
    readonly root: Document | ShadowRoot,
    readonly cascade: CascadeEngine,
  ) {}

  get styleSheets(): StyleSheetList {
    return this.#styleSheets;
  }

  *finalStyleSheets(): IterableIterator<CSSStyleSheetImpl> {
    yield* this.#styleSheets;
    yield* this.#adoptedStyleSheets;
  }

  addStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    const ownerNode = styleSheet.ownerNode;
    const index = ownerNode === null
      ? this.#styleSheets.length
      : findStyleSheetInsertionIndex(this.#styleSheets, ownerNode);

    insertStyleSheet(this.#styleSheets, index, styleSheet);
  }

  adoptStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    this.#adoptedStyleSheets.push(styleSheet);
  }

  createInlineStyleSheet(
    ownerNode: Element,
    source: string,
    {
      media = '',
      title = '',
    }: InlineStyleSheetOptions = {},
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
    if (!removeStyleSheet(this.#styleSheets, styleSheet)) return;
    styleSheet.__clearAssociation();
  }
}

export type InlineStyleSheetOptions = {
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
