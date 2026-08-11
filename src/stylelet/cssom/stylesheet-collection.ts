import { parseStylesheet } from '../css/stylesheet';
import type { Snapshot } from '../snapshot';
import { CSSStyleSheetImpl } from './css-stylesheet';
import {
  insertStyleSheet, removeStyleSheet, StyleSheetListImpl,
} from './stylesheet-list';

export class StyleSheetCollection {
  readonly #snapshot: Snapshot;
  readonly #list = new StyleSheetListImpl();

  constructor(snapshot: Snapshot) {
    this.#snapshot = snapshot;
  }

  get list(): StyleSheetList {
    return this.#list;
  }

  createInlineStyleSheet(
    ownerNode: Element,
    source: string,
    {
      media = '',
      title = '',
    }: InlineStyleSheetOptions = {},
  ): CSSStyleSheet {
    const styleSheet = CSSStyleSheetImpl.__create(
      this.#snapshot,
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
      parseStylesheet(source),
    );
    const index = findStyleSheetInsertionIndex(this.#list, ownerNode);

    insertStyleSheet(this.#list, index, styleSheet);
    return styleSheet;
  }

  removeStyleSheet(styleSheet: CSSStyleSheet): void {
    if (!removeStyleSheet(this.#list, styleSheet)) return;
    if (styleSheet instanceof CSSStyleSheetImpl) {
      styleSheet.__clearAssociation();
    }
  }
}

export type InlineStyleSheetOptions = {
  media?: string;
  title?: string;
};

function findStyleSheetInsertionIndex(
  styleSheets: StyleSheetList,
  ownerNode: Element,
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
