import { Stylelet } from '../../stylelet/stylelet';
import type { TreeScope } from '../../stylelet/engine/tree-scope';
import { DocumentOrShadowRootMixin } from '../css-engine';
import { asDocument } from '../stubs/interfaces';
import { CommentImpl } from './comment';
import {
  createElementNode, HTML_NAMESPACE,
} from './element';
import type {
  ElementImpl, MATHML_NAMESPACE, SVG_NAMESPACE,
} from './element';
import {
  isDocumentType, isElement, NodeImpl, NodeType,
} from './node';
import { TextImpl } from './text';
import type { DocumentTypeImpl } from './document-type';
import {
  findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';

export class DocumentImpl
  extends NodeImpl
{
  #stylelet: Stylelet | undefined;
  #documentOrShadowRoot: DocumentOrShadowRootMixin | undefined;

  readonly nodeType = NodeType.Document;
  readonly contentType = 'text/html';
  readonly baseURI: string;
  mode = DocumentMode.NoQuirks;

  constructor(baseURI = 'about:blank') {
    super();
    this.baseURI = baseURI;
  }

  get ownerDocument(): null {
    return null;
  }

  get compatMode(): 'BackCompat' | 'CSS1Compat' {
    return this.mode === DocumentMode.Quirks ? 'BackCompat' : 'CSS1Compat';
  }

  get doctype(): DocumentTypeImpl | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (isDocumentType(child)) return child;
    }

    return null;
  }

  get documentElement(): ElementImpl | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (isElement(child)) return child;
    }

    return null;
  }

  get styleSheets(): StyleSheetList {
    return this.documentOrShadowRoot.styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheet[] {
    return this.documentOrShadowRoot.adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheet[]) {
    this.documentOrShadowRoot.adoptedStyleSheets = styleSheets;
  }

  get cssEngine(): Stylelet {
    return this.#stylelet ??= new Stylelet(asDocument(this));
  }

  get __treeScope(): TreeScope {
    return this.documentOrShadowRoot.scope;
  }

  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementTagNameMap[K];
  createElement<K extends keyof HTMLElementDeprecatedTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementDeprecatedTagNameMap[K];
  createElement(tagName: string, options?: ElementCreationOptions): HTMLElement;
  createElement(
    localName: string,
    _options?: ElementCreationOptions,
  ): HTMLElement {
    return createElementNode(
      localName,
      HTML_NAMESPACE,
      this,
    );
  }

  createElementNS(namespaceURI: typeof HTML_NAMESPACE, qualifiedName: string): HTMLElement;
  createElementNS<K extends keyof SVGElementTagNameMap>(namespaceURI: typeof SVG_NAMESPACE, qualifiedName: K): SVGElementTagNameMap[K];
  createElementNS(namespaceURI: typeof SVG_NAMESPACE, qualifiedName: string): SVGElement;
  createElementNS<K extends keyof MathMLElementTagNameMap>(namespaceURI: typeof MATHML_NAMESPACE, qualifiedName: K): MathMLElementTagNameMap[K];
  createElementNS(namespaceURI: typeof MATHML_NAMESPACE, qualifiedName: string): MathMLElement;
  createElementNS(namespaceURI: string | null, qualifiedName: string, options?: ElementCreationOptions): Element;
  createElementNS(namespaceURI: string | null, qualifiedName: string, options?: string | ElementCreationOptions): Element;
  createElementNS(
    namespaceURI: string | null,
    qualifiedName: string,
    _options?: string | ElementCreationOptions,
  ): Element {
    return createElementNode(
      qualifiedName,
      namespaceURI ?? '',
      this,
    );
  }

  createTextNode(data: string): TextImpl {
    return new TextImpl(data, this);
  }

  createComment(data: string): CommentImpl {
    return new CommentImpl(data, this);
  }

  addEventListener(
    _type: string,
    _listener: unknown,
    _options?: unknown,
  ): void {}

  removeEventListener(
    _type: string,
    _listener: unknown,
    _options?: unknown,
  ): void {}

  dispatchEvent(_event: unknown): boolean {
    return true;
  }

  write(...text: string[]): void {
    const writer = documentWriters.get(this);

    if (!writer) {
      throw new Error('Document has no active parser');
    }

    writer(text.join(''));
  }

  getElementById(id: string): ElementImpl | null {
    return findElementById(this, id);
  }

  getElementsByClassName(
    classNames: string,
  ): HTMLCollectionOf<Element> {
    return findElementsByClassName(this, classNames);
  }

  getElementsByTagName<K extends keyof HTMLElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<HTMLElementTagNameMap[K]>;
  getElementsByTagName<K extends keyof SVGElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<SVGElementTagNameMap[K]>;
  getElementsByTagName<K extends keyof MathMLElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<MathMLElementTagNameMap[K]>;
  /** @deprecated */
  getElementsByTagName<K extends keyof HTMLElementDeprecatedTagNameMap>(qualifiedName: K): HTMLCollectionOf<HTMLElementDeprecatedTagNameMap[K]>;
  getElementsByTagName(qualifiedName: string): HTMLCollectionOf<Element>;
  getElementsByTagName(
    qualifiedName: string,
  ): HTMLCollectionOf<Element> {
    return findElementsByTagName(this, qualifiedName);
  }

  getElementsByTagNameNS(namespaceURI: typeof HTML_NAMESPACE, localName: string): HTMLCollectionOf<HTMLElement>;
  getElementsByTagNameNS(namespaceURI: typeof SVG_NAMESPACE, localName: string): HTMLCollectionOf<SVGElement>;
  getElementsByTagNameNS(namespaceURI: typeof MATHML_NAMESPACE, localName: string): HTMLCollectionOf<MathMLElement>;
  getElementsByTagNameNS(namespaceURI: string | null, localName: string): HTMLCollectionOf<Element>;
  getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): HTMLCollectionOf<Element> {
    return findElementsByTagNameNS(this, namespaceURI, localName);
  }

  private get documentOrShadowRoot(): DocumentOrShadowRootMixin {
    return this.#documentOrShadowRoot ??=
      new DocumentOrShadowRootMixin(this.cssEngine.documentScope);
  }
}

export type DomletDocument = DocumentImpl & Document;

export function withDocumentWriter<T>(
  document: DocumentImpl,
  writer: DocumentWriter,
  callback: () => T,
): T {
  const previousWriter = documentWriters.get(document);
  documentWriters.set(document, writer);

  try {
    return callback();
  } finally {
    if (previousWriter) {
      documentWriters.set(document, previousWriter);
    } else {
      documentWriters.delete(document);
    }
  }
}

export type DocumentWriter = (markup: string) => void;

export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}

const documentWriters = new WeakMap<DocumentImpl, DocumentWriter>();
