import type {
  DOMOperations, DOMDocument as Document, DOMShadowRoot as ShadowRoot, DOMElement as Element, DOMNode as Node,
} from '../../infra/index';
import { DOMExceptionImpl } from '../../web-idl/core/index';

import { parseStylesheetContents } from '../syntax/index';
import { CSSStyleSheetImpl, StyleSheetListImpl, StylesheetContext } from '../cssom/index';

import type { CascadeEngine } from './cascade-engine';

/** A document or shadow root's stylesheet collections and stylesheet-set selection state. */
// https://drafts.csswg.org/cssom/#css-style-sheet-collections
export class TreeScope {
  /** Adopted implementations in cascade order; Binding owns author conversion and mutation hooks. */
  readonly adoptedStyleSheets: CSSStyleSheetImpl[] = [];
  /** Header sheets followed by sheets associated with nodes in tree order. */
  #styleSheets = new StyleSheetListImpl<CSSStyleSheetImpl>();
  /** Number of leading entries supplied by response headers rather than tree nodes. */
  #headerStyleSheetCount = 0;
  /** Last explicitly selected set name, or null while the preferred set controls selection. */
  #lastStyleSheetSetName: string | null = null;
  /** Preferred stylesheet-set name; empty when none has been established. */
  #preferredStyleSheetSetName = '';

  /** Establish the collections and their current document's style engine. */
  constructor(
    /** Document or shadow root whose stylesheet collections this scope represents. */
    readonly root: Document | ShadowRoot,
    /** Engine supplying the scope's document context and style queries. */
    public cascade: CascadeEngine,
  ) {}

  /** Live header/tree sheet list, excluding adopted sheets. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-stylesheets
  get styleSheets(): StyleSheetListImpl<CSSStyleSheetImpl> {
    return this.#styleSheets;
  }

  /** Reject a sheet unless it was constructed for the root's current node document. */
  // https://drafts.csswg.org/cssom/#dom-documentorshadowroot-adoptedstylesheets
  checkAdoptedStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    const dom = this.cascade.context.dom;
    const document = dom.isDocument(this.root) ? this.root : dom.ownerDocument(this.root)!;
    if (!styleSheet.isConstructedFor(document)) {
      throw new DOMExceptionImpl('The stylesheet was not constructed for this document.', 'NotAllowedError');
    }
  }

  /** Yield associated sheets first, followed by adopted sheets in their list order. */
  // https://drafts.csswg.org/cssom/#documentorshadowroot-final-css-style-sheets
  *finalStyleSheets(): IterableIterator<CSSStyleSheetImpl> {
    yield* this.#styleSheets;
    yield* this.adoptedStyleSheets;
  }

  /** Insert a header sheet in header order, before tree sheets, and apply set selection. */
  addHeaderStyleSheet(styleSheet: CSSStyleSheetImpl, index = this.#headerStyleSheetCount): void {
    this.#styleSheets.insert(index, styleSheet);
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

  /** Restore an associated tree sheet's order after its owner moves, preserving its state. */
  moveTreeStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    this.#styleSheets.remove(styleSheet);
    const index = findStyleSheetInsertionIndex(this.#styleSheets, styleSheet.ownerNode!, this.cascade.context.dom);
    this.#styleSheets.insert(index, styleSheet);
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
  // SPEC_CLASH(stylesheet-set-disabled-flags): Follow CSSOM/Firefox; Chromium/WebKit select sets without changing each sheet's disabled flag.
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
