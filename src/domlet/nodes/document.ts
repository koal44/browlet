import type { TreeScope } from '../../stylelet/engine/tree-scope';
import { Stylelet } from '../../stylelet/stylelet';
import {
  DocumentOrShadowRootMixin, type TreeScopeResolver,
} from '../css-engine';
import type { EventTargetImpl } from '../events/event-target';
import { asDocument } from '../stubs/interfaces';
import {
  defineInterface, definePartialInterface, operation, readonlyAttribute,
} from '../../web-idl/binding';
import { AttrImpl } from './attribute';
import { CommentImpl } from './comment';
import { DocumentTypeImpl } from './document-type';
import {
  createElementNode as constructElementNode, isHTMLElement, isHTMLHeadElement,
} from './element';
import type {
  ElementImpl, HTMLElementImpl, HTMLHeadElementImpl,
} from './element';
import { HTML_NAMESPACE } from '../../shared/namespaces';
import type {
  MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../shared/namespaces';
import {
  documentOrShadowRootIDL, isDocument, isDocumentType, isElement, nodeIDL,
  NodeImpl, NodeType, parentNodeIDL,
} from './node';
import { TextImpl } from './text';
import {
  directDOMNodeFactory, type DOMNodeFactory,
} from './factory';
import {
  findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';

export const documentIDL = defineInterface({
  name: 'Document',
  parent: nodeIDL,
  exposed: ['Window'],
  constructible: true,
  includes: [parentNodeIDL, documentOrShadowRootIDL],
  members: {
    doctype: readonlyAttribute(),
    documentElement: readonlyAttribute(),
    contentType: readonlyAttribute(),
    compatMode: readonlyAttribute(),
    getElementsByClassName: operation(),
    getElementsByTagName: operation(),
    getElementsByTagNameNS: operation(),
    createElement: operation(),
    createElementNS: operation(),
    createTextNode: operation(),
    createComment: operation(),
    getElementById: operation(),
  },
});

export const htmlDocumentIDL = definePartialInterface({
  target: documentIDL,
  members: {
    head: readonlyAttribute(),
    body: readonlyAttribute(),
    write: operation(),
  },
});

export class DocumentImpl
  extends NodeImpl
{
  #stylelet: Stylelet | undefined;
  #documentOrShadowRoot: DocumentOrShadowRootMixin | undefined;
  #browsingContextWindow: EventTargetImpl | null = null;
  readonly #treeScopeResolver: TreeScopeResolver;

  // HTML: a Document's script-blocking style sheet set is an ordered set.
  readonly #scriptBlockingStyleSheets = new Set<ElementImpl>();
  #scriptBlockingStyleSheetsReady = Promise.resolve();
  #resolveScriptBlockingStyleSheets: (() => void) | null = null;
  readonly #nodeFactory: DOMNodeFactory;
  #writer: DocumentWriter | undefined;

  #mode = DocumentMode.NoQuirks;

  constructor(
    baseURI = 'about:blank',
    nodeFactory: DOMNodeFactory = directDOMNodeFactory,
  ) {
    super(
      NodeType.Document,
      null,
      {
        baseURI,
        eventTargetVirtuals: DocumentImpl.#eventTargetVirtuals,
      },
    );
    NodeImpl.setNodeDocument(this, this);
    this.#nodeFactory = nodeFactory;
    this.#treeScopeResolver = new DocumentTreeScopeResolver(this);
  }

  get contentType(): 'text/html' {
    return 'text/html';
  }

  get compatMode(): 'BackCompat' | 'CSS1Compat' {
    return this.#mode === DocumentMode.Quirks ? 'BackCompat' : 'CSS1Compat';
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

  get head(): HTMLHeadElementImpl | null {
    const html = this.documentElement;
    if (!html || !isHTMLElement(html) || html.localName !== 'html') {
      return null;
    }

    for (let child = html.firstChild; child; child = child.nextSibling) {
      if (isElement(child) && isHTMLHeadElement(child)) return child;
    }

    return null;
  }

  get body(): HTMLElementImpl | null {
    const html = this.documentElement;
    if (!html || !isHTMLElement(html) || html.localName !== 'html') {
      return null;
    }

    for (let child = html.firstChild; child; child = child.nextSibling) {
      if (
        isElement(child) &&
        isHTMLElement(child) &&
        (child.localName === 'body' || child.localName === 'frameset')
      ) {
        return child;
      }
    }

    return null;
  }

  get styleSheets(): StyleSheetList {
    return DocumentImpl.#getDocumentOrShadowRootMixin(this).styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheet[] {
    return DocumentImpl.#getDocumentOrShadowRootMixin(this).adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheet[]) {
    DocumentImpl.#getDocumentOrShadowRootMixin(this).adoptedStyleSheets =
      styleSheets;
  }

  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementTagNameMap[K];
  createElement<K extends keyof HTMLElementDeprecatedTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementDeprecatedTagNameMap[K];
  createElement(tagName: string, options?: ElementCreationOptions): HTMLElement;
  createElement(
    localName: string,
    _options?: ElementCreationOptions,
  ): HTMLElement {
    return DocumentImpl.createElementNode(this, localName, HTML_NAMESPACE);
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
    return DocumentImpl.createElementNode(
      this,
      qualifiedName,
      namespaceURI ?? '',
    );
  }

  createTextNode(data: string): TextImpl {
    return this.#nodeFactory.construct(TextImpl, [data, this]);
  }

  createComment(data: string): CommentImpl {
    return this.#nodeFactory.construct(CommentImpl, [data, this]);
  }

  write(...text: string[]): void {
    const writer = this.#writer;

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

  // -- Virtual ----------------------------------------------------------

  static readonly #eventTargetVirtuals = NodeImpl.createEventTargetVirtuals({
    getParent: (target, event) => NodeImpl.is(target) && isDocument(target)
      ? DocumentImpl.getEventParent(target, event)
      : null,
  });

  // -- Friends ----------------------------------------------------------

  static getMode(document: DocumentImpl): DocumentMode {
    return document.#mode;
  }

  static setMode(document: DocumentImpl, mode: DocumentMode): void {
    document.#mode = mode;
  }

  static getEventParent(
    document: DocumentImpl,
    event: Event,
  ): EventTargetImpl | null {
    return event.type === 'load' ? null : document.#browsingContextWindow;
  }

  static setBrowsingContextWindow(
    document: DocumentImpl,
    window: EventTargetImpl | null,
  ): void {
    document.#browsingContextWindow = window;
  }

  static getCSSEngine(document: DocumentImpl): Stylelet {
    return document.#stylelet ??= new Stylelet(asDocument(document));
  }

  static withWriter<T>(
    document: DocumentImpl,
    writer: DocumentWriter,
    callback: () => T,
  ): T {
    const previousWriter = document.#writer;
    document.#writer = writer;

    try {
      return callback();
    } finally {
      document.#writer = previousWriter;
    }
  }

  static createElementNode(document: DocumentImpl, localName: string, namespaceURI: typeof HTML_NAMESPACE, attributes?: AttrImpl[]): HTMLElementImpl;
  static createElementNode(document: DocumentImpl, localName: string, namespaceURI: string, attributes?: AttrImpl[]): ElementImpl;
  static createElementNode(
    document: DocumentImpl,
    localName: string,
    namespaceURI: string,
    attributes: AttrImpl[] = [],
  ): ElementImpl {
    return constructElementNode(
      localName,
      namespaceURI,
      document,
      document.#treeScopeResolver,
      attributes,
      document.#nodeFactory,
    );
  }

  static createAttribute(
    document: DocumentImpl,
    localName: string,
    value: string,
    namespaceURI: string | null,
    prefix: string | null,
  ): AttrImpl {
    return document.#nodeFactory.construct(AttrImpl, [
      localName,
      value,
      namespaceURI,
      prefix,
    ]);
  }

  static createDocumentType(
    document: DocumentImpl,
    name: string,
    publicId: string,
    systemId: string,
  ): DocumentTypeImpl {
    return document.#nodeFactory.construct(
      DocumentTypeImpl,
      [name, publicId, systemId, document],
    );
  }

  static addScriptBlockingStyleSheet(
    document: DocumentImpl,
    ownerNode: ElementImpl,
  ): void {
    if (document.#scriptBlockingStyleSheets.has(ownerNode)) return;

    if (document.#scriptBlockingStyleSheets.size === 0) {
      document.#scriptBlockingStyleSheetsReady = new Promise((resolve) => {
        document.#resolveScriptBlockingStyleSheets = resolve;
      });
    }

    document.#scriptBlockingStyleSheets.add(ownerNode);
  }

  static removeScriptBlockingStyleSheet(
    document: DocumentImpl,
    ownerNode: ElementImpl,
  ): void {
    if (!document.#scriptBlockingStyleSheets.delete(ownerNode)) return;
    if (document.#scriptBlockingStyleSheets.size > 0) return;

    document.#resolveScriptBlockingStyleSheets?.();
    document.#resolveScriptBlockingStyleSheets = null;
  }

  static async waitForScriptBlockingStyleSheets(
    document: DocumentImpl,
  ): Promise<void> {
    while (document.#scriptBlockingStyleSheets.size > 0) {
      await document.#scriptBlockingStyleSheetsReady;
    }
  }

  // -- Private ----------------------------------------------------------

  static #getDocumentOrShadowRootMixin(
    document: DocumentImpl,
  ): DocumentOrShadowRootMixin {
    return document.#documentOrShadowRoot ??=
      new DocumentOrShadowRootMixin(
        DocumentImpl.getCSSEngine(document).documentScope,
      );
  }
}

class DocumentTreeScopeResolver implements TreeScopeResolver {
  readonly #document: DocumentImpl;

  constructor(document: DocumentImpl) {
    this.#document = document;
  }

  resolve(root: NodeImpl): TreeScope | null {
    return root === this.#document
      ? DocumentImpl.getCSSEngine(this.#document).documentScope
      : null;
  }
}

export type DomletDocument = DocumentImpl & Document;

export type DocumentWriter = (markup: string) => void;

export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}
