import type {
  DOMOperations, DOMDocument as Document, DOMElement as Element, DOMNode as Node,
} from '../../infra/index';
import {
  createObservableArray, type ObservableArrayHandle,
} from '../../infra/observable-array';
import { TypeError } from '../../infra/exceptions';

import { parseStylesheetContents } from '../syntax/index';
import { CSSStyleSheetImpl, StyleSheetListImpl, StylesheetContext } from '../cssom/index';

import type { CascadeEngine } from './cascade-engine';

/** A document's associated/adopted stylesheet collections and stylesheet-set selection state. */
// https://drafts.csswg.org/cssom/#css-style-sheet-collections
export class TreeScope {
  /** Header sheets followed by sheets associated with nodes in tree order. */
  #styleSheets = new StyleSheetListImpl<CSSStyleSheetImpl>();
  /** Number of leading entries supplied by response headers rather than tree nodes. */
  #headerStyleSheetCount = 0;
  /** Adopted-sheet collection and its current mutation/conversion hooks. */
  #adoptedStyleSheets: ObservableArrayHandle<CSSStyleSheetImpl>;
  /** Last explicitly selected set name, or null while the preferred set controls selection. */
  #lastStyleSheetSetName: string | null = null;
  /** Preferred stylesheet-set name; empty when none has been established. */
  #preferredStyleSheetSetName = '';

  /** Establish sheet collections and restrict adoption to sheets constructed for this document. */
  constructor(
    /** Document whose stylesheet collections this scope represents. */
    readonly root: Document,
    /** Engine supplying the scope's document context and style queries. */
    readonly cascade: CascadeEngine,
  ) {
    const document = this.cascade.context.dom.ownerDocument(root) ?? root;
    this.#adoptedStyleSheets = createObservableArray({
      convert: toCSSStyleSheet,
      set(styleSheet) {
        if (styleSheet.isConstructedFor(document)) return;
        throw new cascade.context.env.exec.DOMException(
          'The stylesheet was not constructed for this document.',
          'NotAllowedError',
        );
      },
    });
  }

  /** Live header/tree sheet list, excluding adopted sheets. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-stylesheets
  get styleSheets(): StyleSheetListImpl<CSSStyleSheetImpl> {
    return this.#styleSheets;
  }

  /** Mutable adopted-sheet list with construction-document checks on changes. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-adoptedstylesheets
  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#adoptedStyleSheets.value;
  }

  /** Replace adopted sheets through the provisional observable-array conversion path. */
  setAdoptedStyleSheets(styleSheets: unknown): void {
    this.#adoptedStyleSheets.replace(styleSheets);
  }

  /** Yield associated sheets first, followed by adopted sheets in their list order. */
  // https://drafts.csswg.org/cssom/#documentorshadowroot-final-css-style-sheets
  *finalStyleSheets(): IterableIterator<CSSStyleSheetImpl> {
    yield* this.#styleSheets;
    yield* this.#adoptedStyleSheets.value;
  }

  /** Append a header-supplied sheet before tree sheets and apply stylesheet-set selection. */
  addHeaderStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    this.#styleSheets.insert(this.#headerStyleSheetCount, styleSheet);
    this.#headerStyleSheetCount++;
    this.#configureAddedStyleSheet(styleSheet);
  }

  /** Insert an associated sheet by owner-node order and apply stylesheet-set selection. */
  addTreeStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    const ownerNode = styleSheet.ownerNode;
    const index = ownerNode === null
      ? this.#styleSheets.length
      : findStyleSheetInsertionIndex(this.#styleSheets, ownerNode, this.cascade.context.dom);

    this.#styleSheets.insert(index, styleSheet);
    this.#configureAddedStyleSheet(styleSheet);
  }

  /** Parse a style element's text into an origin-clean sheet and associate it with this scope. */
  createStyleElementStyleSheet(
    ownerNode: Element,
    source: string,
    {
      media = '',
      title = '',
    }: StyleElementStyleSheetOptions = {},
  ): CSSStyleSheetImpl {
    const context = this.cascade.context;

    const styleSheet = CSSStyleSheetImpl.create(
      context,
      {
        location: null,
        baseURL: new context.env.userAgent.URL(context.dom.baseURI(context.dom.ownerDocument(this.root) ?? this.root)),
        parentStyleSheet: null,
        ownerNode,
        ownerRule: null,
        media,
        title,
        alternate: false,
        originClean: true,
      },
      parseStylesheetContents(source, new StylesheetContext(null, false, context.env)),
    );
    this.addTreeStyleSheet(styleSheet);
    return styleSheet;
  }

  /** Remove an associated sheet and clear its owner associations. */
  // https://drafts.csswg.org/cssom/#remove-a-css-style-sheet
  removeStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    const index = findStyleSheetIndex(this.#styleSheets, styleSheet);
    if (index < 0) return;

    if (index < this.#headerStyleSheetCount) {
      this.#headerStyleSheetCount--;
    }
    if (!this.#styleSheets.remove(styleSheet)) return;
    styleSheet.clearAssociation();
  }

  /** Enable the named set and retain the explicit selection for subsequently added sheets. */
  // https://drafts.csswg.org/cssom/#select-a-css-style-sheet-set
  selectStyleSheetSet(name: string): void {
    this.#enableStyleSheetSet(name);
    this.#lastStyleSheetSetName = name;
  }

  /** Update the preferred set, applying it only while no explicit selection exists. */
  // https://drafts.csswg.org/cssom/#change-the-preferred-css-style-sheet-set-name
  changePreferredStyleSheetSetName(name: string): void {
    const prev = this.#preferredStyleSheetSetName;
    this.#preferredStyleSheetSetName = name;

    if (name !== prev && this.#lastStyleSheetSetName === null) {
      this.#enableStyleSheetSet(name);
    }
  }

  /** Establish a preferred set if needed and select participation for a newly associated sheet. */
  // https://drafts.csswg.org/cssom/#add-a-css-style-sheet
  #configureAddedStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    if (styleSheet.disabled) return;

    const title = styleSheet.title ?? '';
    if (
      title !== '' &&
      !styleSheet.isAlternate() &&
      this.#preferredStyleSheetSetName === ''
    ) {
      this.changePreferredStyleSheetSetName(title);
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

  /** Enable matching titled sheets and disable other titled sheets, leaving untitled sheets alone. */
  // https://drafts.csswg.org/cssom/#enable-a-css-style-sheet-set
  #enableStyleSheetSet(name: string): void {
    for (const styleSheet of this.#styleSheets) {
      const title = styleSheet.title ?? '';
      if (title !== '') styleSheet.disabled = name !== title;
    }
  }
}

/** Require a stylesheet implementation at the provisional adopted-array boundary. */
function toCSSStyleSheet(value: unknown): CSSStyleSheetImpl {
  if (value instanceof CSSStyleSheetImpl) return value;
  throw new TypeError('Expected a CSSStyleSheet');
}

/** Media conditions and stylesheet-set title supplied by a style element. */
export type StyleElementStyleSheetOptions = {
  /** Media-query text; omitted means no media restriction. */
  media?: string;
  /** Stylesheet-set title; omitted means untitled. */
  title?: string;
};

/** Find the first sheet whose owner follows the new owner, or the end of the collection. */
function findStyleSheetInsertionIndex(
  styleSheets: StyleSheetListImpl<CSSStyleSheetImpl>,
  ownerNode: Node, dom: DOMOperations,
): number {
  let index = 0;

  for (const styleSheet of styleSheets) {
    const currentOwner = styleSheet.ownerNode;
    if (
      currentOwner !== null &&
      (dom.compareDocumentPosition(ownerNode, currentOwner) &
        DOCUMENT_POSITION_FOLLOWING)
    ) {
      return index;
    }

    index++;
  }

  return index;
}

/** DOM comparison bit indicating that the compared node follows the reference node. */
const DOCUMENT_POSITION_FOLLOWING = 0x04;

/** Find a sheet's position by implementation identity, or -1 when it is absent. */
function findStyleSheetIndex(
  styleSheets: StyleSheetListImpl<CSSStyleSheetImpl>,
  target: CSSStyleSheetImpl,
): number {
  let index = 0;
  for (const styleSheet of styleSheets) {
    if (styleSheet === target) return index;
    index++;
  }
  return -1;
}
