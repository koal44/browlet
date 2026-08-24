import type { TreeScope } from '../../stylelet/engine/tree-scope';
import { Stylelet } from '../../stylelet/stylelet';
import {
  DocumentOrShadowRootMixin, type TreeScopeResolver,
} from '../css-engine';
import type { EventTargetImpl } from '../events/event-target';
import { asDocument } from '../stubs/interfaces';
import { isValidAttributeLocalName } from '../algorithms/name-validation';
import { asciiLower } from '../../shared/css';
import { domExceptionName } from '../../shared/dom-exception';
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface,
  definePartialInterface, dictMember, emptyDictionary, idlType, nullable, op,
  readonlyAttr, reference, union,
} from '../../web-idl/adapter/definition';
import { bind } from '../../web-idl/adapter/projection';
import type { ImplementationConstructor } from '../../web-idl/adapter/registry';
import { createOpaqueOrigin, type Origin } from '../../url/origin';
import { parseURL, serializeURL, type URLRecord } from '../../url/url';
import { AttrImpl } from './attribute';
import { CommentImpl } from './comment';
import { DocumentFragmentImpl } from './document-fragment';
import { DocumentTypeImpl } from './document-type';
import {
  ElementImpl, HTMLElementImpl, HTMLHeadElementImpl, HTMLLinkElementImpl,
  HTMLStyleElementImpl, isHTMLElement, isHTMLHeadElement, MathMLElementImpl,
  SVGElementImpl, SVGStyleElementImpl,
} from './element';
import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../shared/namespaces';
import {
  documentOrShadowRootIDL, isDocument, isDocumentType, isElement,
  NodeImpl, type NodeVirtuals, NodeType, parentNodeIDL,
} from './node';
import { TextImpl } from './text';
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
 *
 * dictionary ElementCreationOptions {
 *   CustomElementRegistry? customElementRegistry;
 *   DOMString is;
 * };
 */
export class DocumentImpl
  extends NodeImpl
{
  #aboutBaseURL: URLRecord | null = null;
  readonly #activeSandboxingFlagSet: SandboxingFlagSet = new Set();
  #allowDeclarativeShadowRoots = false;
  #ancestorOriginsList: readonly string[] | null = null;
  #browsingContext: DocumentBrowsingContext | null = null;
  #completelyLoadedTime: number | null = null;
  #contentType = 'application/xml';
  #currentDocumentReadiness: DocumentReadyState = 'complete';
  #customElementRegistry: CustomElementRegistry | null = null;
  #duringLoadingNavigationID: string | null = null;
  #encoding = 'UTF-8';
  #internalAncestorOriginObjectsList: readonly Origin[] | null = null;
  #isInitialAboutBlank = false;
  #loadTimingInfo: DocumentLoadTimingInfo = {
    navigationStartTime: 0,
    domInteractiveTime: 0,
    domContentLoadedEventStartTime: 0,
    domContentLoadedEventEndTime: 0,
    domCompleteTime: 0,
    loadEventStartTime: 0,
    loadEventEndTime: 0,
  };
  #mode = DocumentMode.NoQuirks;
  #moduleMap: ModuleMap = { entries: [] };
  #openerPolicy: OpenerPolicy = {
    value: 'unsafe-none',
    reportingEndpoint: null,
    reportOnlyValue: 'unsafe-none',
    reportOnlyReportingEndpoint: null,
  };
  #origin: Origin = createOpaqueOrigin();
  #permissionsPolicy: PermissionsPolicy = {};
  #policyContainer: PolicyContainer = {
    cspList: [],
    embedderPolicy: {},
    referrerPolicy: 'strict-origin-when-cross-origin',
    integrityPolicy: {},
    reportOnlyIntegrityPolicy: {},
  };
  #type: DocumentType = 'xml';
  #url = parseDocumentURL('about:blank');
  #wasCreatedViaCrossOriginRedirects = false;
  #readyForPostLoadTasks = false;
  #referrer = '';
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

  constructor(
    nodeFactory: DOMNodeFactory = directDOMNodeFactory,
  ) {
    super(
      NodeType.Document,
      null,
      {
        eventTargetVirtuals: DocumentImpl.#eventTargetVirtuals,
        virtuals: DocumentImpl.#nodeVirtuals,
      },
    );
    NodeImpl.setNodeDocument(this, this);
    this.#nodeFactory = nodeFactory;
    this.#treeScopeResolver = new DocumentTreeScopeResolver(this);
  }

  get URL(): string {
    return DocumentImpl.getURL(this);
  }

  get documentURI(): string {
    return this.URL;
  }

  override get baseURI(): string {
    // HTML's full document base URL algorithm additionally consults the first
    // applicable <base href> element. Until that element behavior exists, an
    // about base URL takes precedence over the document URL.
    return serializeURL(this.#aboutBaseURL ?? this.#url);
  }

  get characterSet(): string {
    return this.#encoding;
  }

  get charset(): string {
    return this.characterSet;
  }

  get inputEncoding(): string {
    return this.characterSet;
  }

  get contentType(): string {
    return this.#contentType;
  }

  get defaultView(): Window | null {
    return this.#browsingContext?.windowProxy ?? null;
  }

  get readyState(): DocumentReadyState {
    return this.#currentDocumentReadiness;
  }

  get referrer(): string {
    return this.#referrer;
  }

  get compatMode(): 'BackCompat' | 'CSS1Compat' {
    return this.#mode === DocumentMode.Quirks
      ? 'BackCompat'
      : 'CSS1Compat';
  }

  get customElementRegistry(): CustomElementRegistry | null {
    return this.#customElementRegistry;
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

  createAttribute(localName: string): AttrImpl {
    if (!isValidAttributeLocalName(localName)) {
      throw new DOMException(
        `Invalid attribute local name ${JSON.stringify(localName)}`,
        domExceptionName.invalidCharacter,
      );
    }
    if (this.#type === 'html') localName = asciiLower(localName);
    return DocumentImpl.createAttribute(this, localName, '', null, null);
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

  static readonly #nodeVirtuals: NodeVirtuals = {
    getBaseURI: (node) => isDocument(node)
      ? DocumentImpl.getURL(node)
      : 'about:blank',
  };

  // -- Friends ----------------------------------------------------------

  static getURL(document: DocumentImpl): string {
    return serializeURL(document.#url);
  }

  static setURL(document: DocumentImpl, url: URLRecord): void {
    document.#url = url;
  }

  static setContentType(document: DocumentImpl, contentType: string): void {
    document.#contentType = contentType;
  }

  static getBrowsingContext(
    document: DocumentImpl,
  ): DocumentBrowsingContext | null {
    return document.#browsingContext;
  }

  static setBrowsingContext(
    document: DocumentImpl,
    browsingContext: DocumentBrowsingContext | null,
  ): void {
    document.#browsingContext = browsingContext;
  }

  static getMode(document: DocumentImpl): DocumentMode {
    return document.#mode;
  }

  static setMode(document: DocumentImpl, mode: DocumentMode): void {
    document.#mode = mode;
  }

  static getType(document: DocumentImpl): DocumentType {
    return document.#type;
  }

  static setType(document: DocumentImpl, type: DocumentType): void {
    document.#type = type;
  }

  static getOrigin(document: DocumentImpl): Origin {
    return document.#origin;
  }

  static setOrigin(document: DocumentImpl, origin: Origin): void {
    document.#origin = origin;
  }

  static getModuleMap(document: DocumentImpl): ModuleMap {
    return document.#moduleMap;
  }

  static getPolicyContainer(document: DocumentImpl): PolicyContainer {
    return document.#policyContainer;
  }

  static setPolicyContainer(
    document: DocumentImpl,
    policyContainer: PolicyContainer,
  ): void {
    document.#policyContainer = policyContainer;
  }

  static getPermissionsPolicy(document: DocumentImpl): PermissionsPolicy {
    return document.#permissionsPolicy;
  }

  static setPermissionsPolicy(
    document: DocumentImpl,
    permissionsPolicy: PermissionsPolicy,
  ): void {
    document.#permissionsPolicy = permissionsPolicy;
  }

  static getActiveSandboxingFlagSet(
    document: DocumentImpl,
  ): SandboxingFlagSet {
    return document.#activeSandboxingFlagSet;
  }

  static setActiveSandboxingFlagSet(
    document: DocumentImpl,
    sandboxingFlagSet: ReadonlySet<SandboxingFlag>,
  ): void {
    document.#activeSandboxingFlagSet.clear();
    for (const flag of sandboxingFlagSet) {
      document.#activeSandboxingFlagSet.add(flag);
    }
  }

  static getOpenerPolicy(document: DocumentImpl): OpenerPolicy {
    return document.#openerPolicy;
  }

  static setOpenerPolicy(
    document: DocumentImpl,
    openerPolicy: OpenerPolicy,
  ): void {
    document.#openerPolicy = openerPolicy;
  }

  static getLoadTimingInfo(
    document: DocumentImpl,
  ): DocumentLoadTimingInfo {
    return document.#loadTimingInfo;
  }

  static setLoadTimingInfo(
    document: DocumentImpl,
    loadTimingInfo: DocumentLoadTimingInfo,
  ): void {
    document.#loadTimingInfo = loadTimingInfo;
  }

  static isInitialAboutBlank(document: DocumentImpl): boolean {
    return document.#isInitialAboutBlank;
  }

  static setIsInitialAboutBlank(
    document: DocumentImpl,
    isInitialAboutBlank: boolean,
  ): void {
    document.#isInitialAboutBlank = isInitialAboutBlank;
  }

  static getAboutBaseURL(document: DocumentImpl): URLRecord | null {
    return document.#aboutBaseURL;
  }

  static setAboutBaseURL(
    document: DocumentImpl,
    aboutBaseURL: URLRecord | null,
  ): void {
    document.#aboutBaseURL = aboutBaseURL;
  }

  static allowsDeclarativeShadowRoots(document: DocumentImpl): boolean {
    return document.#allowDeclarativeShadowRoots;
  }

  static setAllowsDeclarativeShadowRoots(
    document: DocumentImpl,
    allow: boolean,
  ): void {
    document.#allowDeclarativeShadowRoots = allow;
  }

  static getCustomElementRegistry(
    document: DocumentImpl,
  ): CustomElementRegistry | null {
    return document.#customElementRegistry;
  }

  static setCustomElementRegistry(
    document: DocumentImpl,
    registry: CustomElementRegistry,
  ): void {
    document.#customElementRegistry = registry;
  }

  static getInternalAncestorOriginObjectsList(
    document: DocumentImpl,
  ): readonly Origin[] | null {
    return document.#internalAncestorOriginObjectsList;
  }

  static setInternalAncestorOriginObjectsList(
    document: DocumentImpl,
    origins: readonly Origin[],
  ): void {
    document.#internalAncestorOriginObjectsList = origins;
  }

  static getAncestorOriginsList(
    document: DocumentImpl,
  ): readonly string[] | null {
    return document.#ancestorOriginsList;
  }

  static setAncestorOriginsList(
    document: DocumentImpl,
    origins: readonly string[],
  ): void {
    document.#ancestorOriginsList = origins;
  }

  static isReadyForPostLoadTasks(document: DocumentImpl): boolean {
    return document.#readyForPostLoadTasks;
  }

  static markReadyForPostLoadTasks(document: DocumentImpl): void {
    document.#readyForPostLoadTasks = true;
  }

  static getCurrentDocumentReadiness(
    document: DocumentImpl,
  ): DocumentReadyState {
    return document.#currentDocumentReadiness;
  }

  static setCurrentDocumentReadiness(
    document: DocumentImpl,
    readiness: DocumentReadyState,
  ): void {
    document.#currentDocumentReadiness = readiness;
  }

  static setReferrer(document: DocumentImpl, referrer: string): void {
    document.#referrer = referrer;
  }

  static wasCreatedViaCrossOriginRedirects(
    document: DocumentImpl,
  ): boolean {
    return document.#wasCreatedViaCrossOriginRedirects;
  }

  static setWasCreatedViaCrossOriginRedirects(
    document: DocumentImpl,
    value: boolean,
  ): void {
    document.#wasCreatedViaCrossOriginRedirects = value;
  }

  static getDuringLoadingNavigationID(
    document: DocumentImpl,
  ): string | null {
    return document.#duringLoadingNavigationID;
  }

  static setDuringLoadingNavigationID(
    document: DocumentImpl,
    id: string | null,
  ): void {
    document.#duringLoadingNavigationID = id;
  }

  static getCompletelyLoadedTime(document: DocumentImpl): number | null {
    return document.#completelyLoadedTime;
  }

  static setCompletelyLoadedTime(
    document: DocumentImpl,
    time: number,
  ): void {
    document.#completelyLoadedTime = time;
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
    const construction = DocumentImpl.#resolveElementConstruction(
      document, localName, namespaceURI, attributes,
    );
    return document.#nodeFactory.construct(
      construction.implementation,
      construction.argumentsList,
    );
  }

  static createDocumentFragment(
    document: DocumentImpl,
  ): DocumentFragmentImpl {
    return document.#nodeFactory.construct(
      DocumentFragmentImpl,
      [document],
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
      document,
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

  /*
   * This is currently the joint DOM/HTML/SVG/MathML contribution table used
   * by Domlet. Keep its ownership with the creating Document; the individual
   * specification contributions can later be separated without exposing the
   * realm-aware node factory to Element.
   */
  static #resolveElementConstruction(
    document: DocumentImpl,
    localName: string,
    namespaceURI: string,
    attributes: AttrImpl[],
  ): ElementConstruction {
    if (namespaceURI === HTML_NAMESPACE) {
      localName = asciiLower(localName);

      if (localName === 'head') {
        return {
          implementation: HTMLHeadElementImpl,
          argumentsList: [document, attributes],
        };
      }
      if (localName === 'style') {
        return {
          implementation: HTMLStyleElementImpl,
          argumentsList: [document, document.#treeScopeResolver, attributes],
        };
      }
      if (localName === 'link') {
        return {
          implementation: HTMLLinkElementImpl,
          argumentsList: [document, document.#treeScopeResolver, attributes],
        };
      }
      return {
        implementation: HTMLElementImpl,
        argumentsList: [localName, document, attributes],
      };
    }

    if (namespaceURI === SVG_NAMESPACE) {
      return localName === 'style'
        ? {
          implementation: SVGStyleElementImpl,
          argumentsList: [document, document.#treeScopeResolver, attributes],
        }
        : {
          implementation: SVGElementImpl,
          argumentsList: [localName, document, attributes],
        };
    }

    if (namespaceURI === MATHML_NAMESPACE) {
      return {
        implementation: MathMLElementImpl,
        argumentsList: [localName, document, attributes],
      };
    }

    return {
      implementation: ElementImpl,
      argumentsList: [localName, namespaceURI, document, attributes],
    };
  }
}

// -- Web IDL ------------------------------------------------------------

export const documentIDL = defineInterface({
  binding: bind(DocumentImpl, {
    create(context, newTarget) {
      if (!newTarget) {
        throw new Error('Document construction requires newTarget');
      }
      return Reflect.construct(
        DocumentImpl,
        [context.objects],
        newTarget as NewTarget,
      );
    },
  }),
  exposed: 'Window',
  inherits: 'Node',
  members: [
    ctor(bind({ invoke() {} })),
    readonlyAttr('URL', idlType.USVString),
    readonlyAttr('documentURI', idlType.USVString),
    readonlyAttr('characterSet', idlType.DOMString),
    readonlyAttr('charset', idlType.DOMString),
    readonlyAttr('inputEncoding', idlType.DOMString),
    readonlyAttr('doctype', nullable(reference('DocumentType'))),
    readonlyAttr('documentElement', nullable(reference('Element'))),
    readonlyAttr('contentType', idlType.DOMString),
    readonlyAttr('compatMode', idlType.DOMString),
    op('getElementsByClassName', idlType.object, [
      arg('classNames', idlType.DOMString),
    ]),
    op('getElementsByTagName', idlType.object, [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getElementsByTagNameNS', idlType.object, [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('createElement', reference('Element'), [
      arg('localName', idlType.DOMString),
      arg(
        'options',
        union(idlType.DOMString, reference('ElementCreationOptions')),
        {
          default: emptyDictionary,
          optional: true,
        },
      ),
    ]),
    op('createElementNS', reference('Element'), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('qualifiedName', idlType.DOMString),
      arg(
        'options',
        union(idlType.DOMString, reference('ElementCreationOptions')),
        {
          default: emptyDictionary,
          optional: true,
        },
      ),
    ]),
    op('createTextNode', reference('Text'), [
      arg('data', idlType.DOMString),
    ]),
    op('createComment', reference('Comment'), [
      arg('data', idlType.DOMString),
    ]),
    op('createAttribute', reference('Attr'), [
      arg('localName', idlType.DOMString),
    ]),
    op('getElementById', nullable(reference('Element')), [
      arg('elementId', idlType.DOMString),
    ]),
  ],
  name: 'Document',
});

export const elementCreationOptionsIDL = defineDictionary({
  members: [dictMember('is', idlType.DOMString)],
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
    readonlyAttr('head', nullable(reference('HTMLHeadElement'))),
    readonlyAttr('body', nullable(reference('HTMLElement'))),
    op('write', idlType.undefined, [
      arg('text', idlType.DOMString, { variadic: true }),
    ]),
    readonlyAttr('defaultView', nullable(reference('WindowProxy'))),
  ],
  name: 'Document',
});

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

export type DOMNodeFactory = {
  construct<T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ): T;
};

export const directDOMNodeFactory: DOMNodeFactory = {
  construct: <T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ) => Reflect.construct(implementation, argumentsList) as T,
};

type ElementConstruction = {
  implementation: ImplementationConstructor<ElementImpl>;
  argumentsList: readonly unknown[];
};

export type DocumentWriter = (markup: string) => void;

type NewTarget = new (...argumentsList: never[]) => object;

export type DocumentType = 'xml' | 'html';

/*
 * Domlet remains independent of any one HTML host. This is the narrow shape
 * required by HTML's Document browsing-context slot; Browlet's concrete
 * BrowsingContext supplies it.
 */
export type DocumentBrowsingContext = {
  readonly windowProxy: Window;
};

export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}

export type ModuleMap = {
  entries: ModuleMapEntry[];
};

export type ModuleMapKey = readonly [URLRecord, string];

export type ModuleMapEntry = {
  key: ModuleMapKey;
  value: unknown;
};

export type PolicyContainer = {
  cspList: object[];
  embedderPolicy: EmptyPolicy;
  referrerPolicy: string;
  integrityPolicy: EmptyPolicy;
  reportOnlyIntegrityPolicy: EmptyPolicy;
};

export type PermissionsPolicy = EmptyPolicy;

export type SandboxingFlagSet = Set<SandboxingFlag>;

export type SandboxingFlag =
  | 'sandboxed-navigation'
  | 'sandboxed-auxiliary-navigation'
  | 'sandboxed-top-level-navigation-without-user-activation'
  | 'sandboxed-top-level-navigation-with-user-activation'
  | 'sandboxed-origin'
  | 'sandboxed-forms'
  | 'sandboxed-pointer-lock'
  | 'sandboxed-scripts'
  | 'sandboxed-automatic-features'
  | 'sandboxed-document-domain'
  | 'sandbox-propagates-to-auxiliary-browsing-contexts'
  | 'sandboxed-modals'
  | 'sandboxed-orientation-lock'
  | 'sandboxed-presentation'
  | 'sandboxed-downloads'
  | 'sandboxed-custom-protocols-navigation';

export type OpenerPolicy = {
  value: OpenerPolicyValue;
  reportingEndpoint: string | null;
  reportOnlyValue: OpenerPolicyValue;
  reportOnlyReportingEndpoint: string | null;
};

export type OpenerPolicyValue =
  | 'unsafe-none'
  | 'same-origin-allow-popups'
  | 'same-origin'
  | 'same-origin-plus-COEP'
  | 'noopener-allow-popups';

export type DocumentLoadTimingInfo = {
  navigationStartTime: DOMHighResTimeStamp;
  domInteractiveTime: DOMHighResTimeStamp;
  domContentLoadedEventStartTime: DOMHighResTimeStamp;
  domContentLoadedEventEndTime: DOMHighResTimeStamp;
  domCompleteTime: DOMHighResTimeStamp;
  loadEventStartTime: DOMHighResTimeStamp;
  loadEventEndTime: DOMHighResTimeStamp;
};

type EmptyPolicy = Record<never, never>;

function parseDocumentURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new Error(`Could not parse document URL ${input}`);
  return url;
}
