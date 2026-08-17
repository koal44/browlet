import { parseStylesheet } from '../css/stylesheet';
import { CSSStyleSheetImpl } from '../cssom/css-stylesheet';
import { StyleSheetListImpl } from '../cssom/stylesheet-list';
import type { CascadeEngine } from './cascade-engine';

export class TreeScope {
  readonly #styleSheets = new StyleSheetListImpl<CSSStyleSheetImpl>();
  readonly #adoptedStyleSheets: CSSStyleSheetImpl[] = [];

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

    this.#styleSheets.__insert(index, styleSheet);
  }

  adoptStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    this.#adoptedStyleSheets.push(styleSheet);
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
