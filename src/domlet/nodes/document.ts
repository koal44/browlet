import type { TreeScope } from '../../stylelet/engine/tree-scope';
import { Stylelet } from '../../stylelet/stylelet';
import {
  DocumentOrShadowRootMixin, type TreeScopeResolver,
} from '../css-engine';
import type { EventTargetImpl } from '../events/event-target';
import { asDocument } from '../stubs/interfaces';
import {
  defineDictionary, defineIncludes, defineInterface, definePartialInterface,
  emptyDictionary, idlType, nullable, reference, union,
} from '../../web-idl/definition';
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
  documentOrShadowRootIDL, isDocument, isDocumentType, isElement,
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

/*
 * [Exposed=Window]
 * interface Document : Node {
 *   constructor();
 *
 *   [SameObject] readonly attribute DOMImplementation implementation;
 *   readonly attribute USVString URL;
 *   readonly attribute USVString documentURI;
 *   readonly attribute DOMString compatMode;
 *   readonly attribute DOMString characterSet;
 *   readonly attribute DOMString charset; // legacy alias of .characterSet
 *   readonly attribute DOMString inputEncoding; // legacy alias of .characterSet
 *   readonly attribute DOMString contentType;
 *
 *   readonly attribute DocumentType? doctype;
 *   readonly attribute Element? documentElement;
 *   HTMLCollection getElementsByTagName(DOMString qualifiedName);
 *   HTMLCollection getElementsByTagNameNS(DOMString? namespace, DOMString localName);
 *   HTMLCollection getElementsByClassName(DOMString classNames);
 *
 *   [CEReactions, NewObject] Element createElement(DOMString localName, optional (DOMString or ElementCreationOptions) options = {});
 *   [CEReactions, NewObject] Element createElementNS(DOMString? namespace, DOMString qualifiedName, optional (DOMString or ElementCreationOptions) options = {});
 *   [NewObject] DocumentFragment createDocumentFragment();
 *   [NewObject] Text createTextNode(DOMString data);
 *   [NewObject] CDATASection createCDATASection(DOMString data);
 *   [NewObject] Comment createComment(DOMString data);
 *   [NewObject] ProcessingInstruction createProcessingInstruction(DOMString target, DOMString data);
 *
 *   [CEReactions, NewObject] Node importNode(Node node, optional (boolean or ImportNodeOptions) options = false);
 *   [CEReactions] Node adoptNode(Node node);
 *
 *   [NewObject] Attr createAttribute(DOMString localName);
 *   [NewObject] Attr createAttributeNS(DOMString? namespace, DOMString qualifiedName);
 *
 *   [NewObject] Event createEvent(DOMString interface); // legacy
 *
 *   [NewObject] Range createRange();
 *
 *   // NodeFilter.SHOW_ALL = 0xFFFFFFFF
 *   [NewObject] NodeIterator createNodeIterator(Node root, optional unsigned long whatToShow = 0xFFFFFFFF, optional NodeFilter? filter = null);
 *   [NewObject] TreeWalker createTreeWalker(Node root, optional unsigned long whatToShow = 0xFFFFFFFF, optional NodeFilter? filter = null);
 * };
 */
export const documentIDL = defineInterface({
  exposed: ['Window'],
  inherits: 'Node',
  members: [
    { arguments: [], kind: 'constructor' },
    {
      kind: 'attribute', name: 'doctype', readonly: true,
      type: nullable(reference('DocumentType')),
    },
    {
      kind: 'attribute', name: 'documentElement', readonly: true,
      type: nullable(reference('Element')),
    },
    { kind: 'attribute', name: 'contentType', readonly: true, type: idlType.DOMString },
    { kind: 'attribute', name: 'compatMode', readonly: true, type: idlType.DOMString },
    {
      arguments: [{ name: 'classNames', type: idlType.DOMString }],
      kind: 'operation', name: 'getElementsByClassName', returns: idlType.object,
    },
    {
      arguments: [{ name: 'qualifiedName', type: idlType.DOMString }],
      kind: 'operation', name: 'getElementsByTagName', returns: idlType.object,
    },
    {
      arguments: [
        { name: 'namespace', type: nullable(idlType.DOMString) },
        { name: 'localName', type: idlType.DOMString },
      ],
      kind: 'operation', name: 'getElementsByTagNameNS', returns: idlType.object,
    },
    {
      arguments: [
        { name: 'localName', type: idlType.DOMString },
        {
          default: emptyDictionary,
          name: 'options',
          optional: true,
          type: union(idlType.DOMString, reference('ElementCreationOptions')),
        },
      ],
      kind: 'operation', name: 'createElement', returns: reference('Element'),
    },
    {
      arguments: [
        { name: 'namespace', type: nullable(idlType.DOMString) },
        { name: 'qualifiedName', type: idlType.DOMString },
        {
          default: emptyDictionary,
          name: 'options',
          optional: true,
          type: union(idlType.DOMString, reference('ElementCreationOptions')),
        },
      ],
      kind: 'operation', name: 'createElementNS', returns: reference('Element'),
    },
    {
      arguments: [{ name: 'data', type: idlType.DOMString }],
      kind: 'operation', name: 'createTextNode', returns: reference('Text'),
    },
    {
      arguments: [{ name: 'data', type: idlType.DOMString }],
      kind: 'operation', name: 'createComment', returns: reference('Comment'),
    },
    {
      arguments: [{ name: 'elementId', type: idlType.DOMString }],
      kind: 'operation', name: 'getElementById',
      returns: nullable(reference('Element')),
    },
  ],
  name: 'Document',
});

/*
 * dictionary ElementCreationOptions {
 *   CustomElementRegistry? customElementRegistry;
 *   DOMString is;
 * };
 */
export const elementCreationOptionsIDL = defineDictionary({
  members: [{ name: 'is', type: idlType.DOMString }],
  name: 'ElementCreationOptions',
});

/*
 * Document includes ParentNode;
 */
export const documentIncludesParentNodeIDL = defineIncludes({
  interface: 'Document', mixin: parentNodeIDL.name,
});

/*
 * Document includes DocumentOrShadowRoot;
 */
export const documentIncludesDocumentOrShadowRootIDL = defineIncludes({
  interface: 'Document', mixin: documentOrShadowRootIDL.name,
});

/*
 * enum DocumentReadyState { "loading", "interactive", "complete" };
 * enum DocumentVisibilityState { "visible", "hidden" };
 * typedef (HTMLScriptElement or SVGScriptElement) HTMLOrSVGScriptElement;
 *
 * [LegacyOverrideBuiltIns]
 * partial interface Document {
 *   static Document parseHTMLUnsafe((TrustedHTML or DOMString) html, optional ParseHTMLUnsafeOptions options = {});
 *   static Document parseHTML(DOMString html, optional SetHTMLOptions options = {});
 *
 *   // resource metadata management
 *   [PutForwards=href, LegacyUnforgeable] readonly attribute Location? location;
 *   attribute USVString domain;
 *   readonly attribute USVString referrer;
 *   attribute USVString cookie;
 *   readonly attribute DOMString lastModified;
 *   readonly attribute DocumentReadyState readyState;
 *
 *   // DOM tree accessors
 *   getter object (DOMString name);
 *   [CEReactions] attribute DOMString title;
 *   [CEReactions] attribute DOMString dir;
 *   [CEReactions] attribute HTMLElement? body;
 *   readonly attribute HTMLHeadElement? head;
 *   [SameObject] readonly attribute HTMLCollection images;
 *   [SameObject] readonly attribute HTMLCollection embeds;
 *   [SameObject] readonly attribute HTMLCollection plugins;
 *   [SameObject] readonly attribute HTMLCollection links;
 *   [SameObject] readonly attribute HTMLCollection forms;
 *   [SameObject] readonly attribute HTMLCollection scripts;
 *   NodeList getElementsByName(DOMString elementName);
 *   readonly attribute HTMLOrSVGScriptElement? currentScript; // classic scripts in a document tree only
 *
 *   // dynamic markup insertion
 *   [CEReactions] Document open(optional DOMString unused1, optional DOMString unused2); // both arguments are ignored
 *   WindowProxy? open(USVString url, DOMString name, DOMString features);
 *   [CEReactions] undefined close();
 *   [CEReactions] undefined write((TrustedHTML or DOMString)... text);
 *   [CEReactions] undefined writeln((TrustedHTML or DOMString)... text);
 *
 *   // user interaction
 *   readonly attribute WindowProxy? defaultView;
 *   boolean hasFocus();
 *   [CEReactions] attribute DOMString designMode;
 *   [CEReactions] boolean execCommand(DOMString commandId, optional boolean showUI = false, optional DOMString value = "");
 *   boolean queryCommandEnabled(DOMString commandId);
 *   boolean queryCommandIndeterm(DOMString commandId);
 *   boolean queryCommandState(DOMString commandId);
 *   boolean queryCommandSupported(DOMString commandId);
 *   DOMString queryCommandValue(DOMString commandId);
 *   readonly attribute boolean hidden;
 *   readonly attribute DocumentVisibilityState visibilityState;
 *
 *   // special event handler IDL attributes that only apply to Document objects
 *   [LegacyLenientThis] attribute EventHandler onreadystatechange;
 *   attribute EventHandler onvisibilitychange;
 *
 *   // also has obsolete members
 * };
 * Document includes GlobalEventHandlers;
 */
export const htmlDocumentIDL = definePartialInterface({
  members: [
    {
      kind: 'attribute', name: 'head', readonly: true,
      type: nullable(reference('HTMLHeadElement')),
    },
    {
      kind: 'attribute', name: 'body', readonly: true,
      type: nullable(reference('HTMLElement')),
    },
    {
      arguments: [{ name: 'text', type: idlType.DOMString, variadic: true }],
      kind: 'operation', name: 'write', returns: idlType.undefined,
    },
  ],
  name: 'Document',
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
