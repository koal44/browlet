import {
  type TreeScope, defaultExecutionCaps as defaultStyleletExecutionCaps, Stylelet,
  type ExecutionCaps as StyleletExecutionCaps, type CSSStyleSheetImpl, type StyleSheetListImpl,
} from '../../../stylelet/index';
import type { PromiseValue, PromiseValueCapability } from '../../../infra/promises';
import type { JSEnvironment } from '../../../js-engine/index';
import type { HTMLCollectionImpl } from './collections';
import { createStyleletExecution, type TreeScopeResolver } from '../../style/integration';
import { fireEvent, type EventTargetImpl } from '../events/event-target';
import type { EventImpl } from '../events/event';
import { asDocument } from '../../stubs';
import { isValidAttributeLocalName } from '../infra/name-validation';
import type { BrowsingContext } from '../../browsing/browsing-context';
import type { Navigable } from '../../browsing/navigable';
import type { NotRestoredReasonDetails } from '../../browsing/navigation/session-history';
import type { NavigationParams, NavigationRequest } from '../../browsing/navigation/navigation';
import type { Environment } from '../../scripting/environment';
import { InsecureRequestsPolicy } from '../../browsing/policy/upgrade-insecure-requests';
import { currentCoarsenedWallTime } from '../../performance/high-resolution-time';
import type { WindowImpl } from '../../browsing/window/window';
import type { Realm } from '../../scripting/realm';
import type { CustomElementRegistryImpl } from '../../html/custom-elements/registry';
import {
  createPolicyContainer, type PolicyContainer,
} from '../../browsing/policy/container';
import {
  createOpenerPolicy, type OpenerPolicy,
} from '../../browsing/policy/coop';
import {
  createPermissionsPolicy, type PermissionsPolicy,
} from '../../browsing/policy/permissions';
import {
  createSandboxingFlagSet, type SandboxingFlag,
  type SandboxingFlagSet,
} from '../../browsing/policy/sandbox';
import { asciiLower } from '../../../infra/ascii';
import {
  arg, atArg, ctor, defineDictionary, defineIncludes, defineInterface, definePartialInterface,
  dictMember, emptyDictionary, idlType, impl, nullable, op, roAttr, reference, union,
  DOMExceptionNames, throwDOMException, type ImplementationClass,
} from '../../../web-idl/index';
import { createOpaqueOrigin, type Origin, parseURL, serializeURL, type URLRecord } from '../../../url/index';
import { AttrImpl } from './attribute';
import { CommentImpl } from './comment';
import { DocumentFragmentImpl } from './document-fragment';
import { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import {
  HTML_NAMESPACE, type MATHML_NAMESPACE, type SVG_NAMESPACE,
} from '../../../infra/index';
import {
  isDocument, isDocumentType, isElement, NodeImpl, NodeType,
} from './node';
import {
  DocumentOrShadowRootMixin, documentOrShadowRootIDL,
} from './document-or-shadow-root';
import { ParentNodeMixin, parentNodeIDL } from './parent-node';
import { TextImpl } from './text';
import {
  findElement, findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';
import { resolveElementInterface } from '../../element-interfaces';
import { HTMLBaseElementImpl } from '../../html/elements/metadata/base';
import { isHTMLElement, type HTMLElementImpl } from '../../html/elements/html-element';
import { isHTMLHeadElement, type HTMLHeadElementImpl } from '../../html/elements/metadata/head';
import { InternalError } from '../../../infra/internal-error';

export function createDocument(
  options: DocumentConstructionOptions = {},
): DocumentImpl {
  const nodeFactory = options.nodeFactory ?? directDOMNodeFactory;
  return nodeFactory.constructNode(DocumentImpl, [nodeFactory, options.styleletExec]);
}

export type DocumentConstructionOptions = {
  nodeFactory?: DOMNodeFactory;
  styleletExec?: StyleletExecutionCaps;
};

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
export class DocumentImpl extends NodeImpl {
  /** The document's URL record, independent of its base URL. */
  // https://dom.spec.whatwg.org/#concept-document-url
  url = parseDocumentURL('about:blank');
  /** Origin used by the document's security and same-origin checks. */
  origin: Origin = createOpaqueOrigin();
  /** Whether DOM operations use HTML or XML rules. */
  type: DocumentType = 'xml';
  /** Compatibility mode selected by the parser. */
  mode = DocumentMode.NoQuirks;
  /** MIME type of the document's content. */
  contentType = 'application/xml';
  /** Encoding name exposed by characterSet and its legacy aliases. */
  encoding = 'UTF-8';
  /** Associated browsing context, or null for a detached document. */
  browsingContext: BrowsingContext | null = null;
  /** Inherited fallback base for about:blank and iframe srcdoc documents. */
  aboutBaseURL: URLRecord | null = null;
  /** Loading state exposed by readyState. */
  currentDocumentReadiness: DocumentReadyState = 'complete';
  /** Whether this document may be retained for restoration from session history. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#concept-document-salvageable
  salvageable = true;
  /** Reasons recorded when this document becomes ineligible for restoration. */
  bfcacheBlockingDetails = new Set<NotRestoredReasonDetails>();
  /** Whether load abortion has stopped this document's active parser. */
  activeParserWasAborted = false;
  /** Parser currently consuming this document, or null when none is registered. */
  // PROVISIONAL: connect BrowletParser's lifetime and implement its abort algorithm.
  activeParser: { abort(): void; } | null = null;
  /** Worker globals whose owner sets contain this document. */
  // PROVISIONAL: worker creation and ownership registration are not implemented.
  ownedWorkers: { ownerSet: Set<DocumentImpl>; }[] = [];
  /** Worklet globals whose lifetime is tied to this document. */
  // PROVISIONAL: worklet creation and registration are not implemented.
  workletGlobalScopes: { terminate(): void; }[] = [];
  /** Referrer recorded when the document was created, or the empty string. */
  referrer = '';
  /** Custom element registry associated with this document, if any. */
  customElementRegistry: CustomElementRegistryImpl | null = null;
  /** Module scripts known to this document. */
  moduleMap: ModuleMap = { entries: [] };
  /** Policies inherited or supplied when the document was created. */
  policyContainer: PolicyContainer = createPolicyContainer();
  /** Permissions policy controlling features in this document. */
  permissionsPolicy: PermissionsPolicy = createPermissionsPolicy();
  /** Cross-origin opener policy selected for this document. */
  openerPolicy: OpenerPolicy = createOpenerPolicy();
  /** Sandbox restrictions currently applied to the document. */
  activeSandboxingFlagSet: SandboxingFlagSet = createSandboxingFlagSet();
  /** Whether parsing may create declarative shadow roots. */
  allowDeclarativeShadowRoots = false;
  /** Ancestor origins retained for navigation, or null before selection. */
  internalAncestorOriginObjectsList: Origin[] | null = null;
  /** Serialized ancestor origins, or null before selection. */
  ancestorOriginsList: string[] | null = null;
  /** Whether this document was created from an iframe's srcdoc content. */
  // https://html.spec.whatwg.org/multipage/iframe-embed-object.html#an-iframe-srcdoc-document
  isIframeSrcdocDocument = false;
  /** Whether this is the initial about:blank document of a browsing context. */
  isInitialAboutBlank = false;
  /** Whether cross-origin redirects occurred while creating this document. */
  wasCreatedViaCrossOriginRedirects = false;
  /** Navigation identifier while loading, or null outside that phase. */
  duringLoadingNavigationID: string | null = null;
  /** Navigation and document-loading milestones. */
  loadTimingInfo: DocumentLoadTimingInfo = {
    navigationStartTime: 0,
    domInteractiveTime: 0,
    domContentLoadedEventStartTime: 0,
    domContentLoadedEventEndTime: 0,
    domCompleteTime: 0,
    loadEventStartTime: 0,
    loadEventEndTime: 0,
  };
  /** Completion timestamp, or null until the document is completely loaded. */
  completelyLoadedTime: number | null = null;
  /** Whether tasks that depend on loading completion may proceed. */
  readyForPostLoadTasks = false;
  /** Execution facilities supplied to the document's Stylelet instance. */
  styleletExec: StyleletExecutionCaps;

  #relevantGlobalObject: WindowImpl | null = null;
  #firstBaseElement: HTMLBaseElementImpl | null = null;
  #fullyActiveObservers = new Set<FullyActiveStateObserver>();
  #stylelet: Stylelet | undefined;
  #documentOrShadowRootMixin: DocumentOrShadowRootMixin;
  #parentNodeMixin: ParentNodeMixin;
  #treeScopeResolver: TreeScopeResolver;

  // HTML: a Document's script-blocking style sheet set is an ordered set.
  #scriptBlockingStyleSheets = new Set<ElementImpl>();
  #scriptBlockingStyleSheetsReady: PromiseValueCapability<void> | null = null;
  #nodeFactory: DOMNodeFactory;
  #writer: DocumentWriter | undefined;

  static #eventTargetVirtuals = NodeImpl.createEventTargetVirtuals({
    getParent: (target, event) => NodeImpl.is(target) && isDocument(target)
      ? target.getEventParent(event)
      : null,
  });

  constructor(
    nodeFactory: DOMNodeFactory = directDOMNodeFactory,
    styleletExec: StyleletExecutionCaps = defaultStyleletExecutionCaps,
  ) {
    super(
      NodeType.Document,
      null,
      {
        eventTargetVirtuals: DocumentImpl.#eventTargetVirtuals,
      },
    );
    this.setNodeDocument(this);
    this.#nodeFactory = nodeFactory;
    this.styleletExec = styleletExec;
    this.#treeScopeResolver = new DocumentTreeScopeResolver(this);
    this.#documentOrShadowRootMixin = new DocumentOrShadowRootMixin({
      getCustomElementRegistry: () => this.customElementRegistry,
      getStyleScope: () => this.getCSSEngine().documentScope,
    });
    this.#parentNodeMixin = new ParentNodeMixin(this);
  }

  get URL(): string {
    return serializeURL(this.url);
  }

  get documentURI(): string {
    return this.URL;
  }

  override get baseURI(): string {
    return serializeURL(this.getBaseURL());
  }

  get characterSet(): string {
    return this.encoding;
  }

  get charset(): string {
    return this.characterSet;
  }

  get inputEncoding(): string {
    return this.characterSet;
  }

  get defaultView(): Window | null {
    return this.browsingContext?.windowProxy ?? null;
  }

  get readyState(): DocumentReadyState {
    return this.currentDocumentReadiness;
  }

  get compatMode(): 'BackCompat' | 'CSS1Compat' {
    return this.mode === DocumentMode.Quirks
      ? 'BackCompat'
      : 'CSS1Compat';
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

  get styleSheets(): StyleSheetListImpl {
    return this.#documentOrShadowRootMixin.styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#documentOrShadowRootMixin.adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheetImpl[]) {
    this.#documentOrShadowRootMixin.adoptedStyleSheets = styleSheets;
  }

  get children(): HTMLCollectionImpl<ElementImpl> {
    return this.#parentNodeMixin.children;
  }

  get firstElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.firstElementChild;
  }

  get lastElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.lastElementChild;
  }

  get childElementCount(): number {
    return this.#parentNodeMixin.childElementCount;
  }

  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementTagNameMap[K] & ElementImpl;
  createElement<K extends keyof HTMLElementDeprecatedTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementDeprecatedTagNameMap[K] & ElementImpl;
  createElement(tagName: string, options?: ElementCreationOptions): HTMLElement & ElementImpl;
  createElement(
    localName: string,
    _options?: ElementCreationOptions,
  ): HTMLElement & ElementImpl {
    if (this.type === 'html') localName = asciiLower(localName);
    return this.createElementNode(localName, HTML_NAMESPACE);
  }

  createElementNS(namespaceURI: typeof HTML_NAMESPACE, qualifiedName: string): HTMLElement & ElementImpl;
  createElementNS<K extends keyof SVGElementTagNameMap>(namespaceURI: typeof SVG_NAMESPACE, qualifiedName: K): SVGElementTagNameMap[K] & ElementImpl;
  createElementNS(namespaceURI: typeof SVG_NAMESPACE, qualifiedName: string): SVGElement & ElementImpl;
  createElementNS<K extends keyof MathMLElementTagNameMap>(namespaceURI: typeof MATHML_NAMESPACE, qualifiedName: K): MathMLElementTagNameMap[K] & ElementImpl;
  createElementNS(namespaceURI: typeof MATHML_NAMESPACE, qualifiedName: string): MathMLElement & ElementImpl;
  createElementNS(namespaceURI: string | null, qualifiedName: string, options?: ElementCreationOptions): Element & ElementImpl;
  createElementNS(namespaceURI: string | null, qualifiedName: string, options?: string | ElementCreationOptions): Element & ElementImpl;
  createElementNS(
    namespaceURI: string | null,
    qualifiedName: string,
    _options?: string | ElementCreationOptions,
  ): Element & ElementImpl {
    return this.createElementNode(qualifiedName, namespaceURI ?? '');
  }

  createTextNode(data: string): TextImpl {
    return this.#nodeFactory.constructNode(TextImpl, [data, this]);
  }

  createComment(data: string): CommentImpl {
    return this.#nodeFactory.constructNode(CommentImpl, [data, this]);
  }

  createAttribute(localName: string): AttrImpl {
    if (!isValidAttributeLocalName(localName)) {
      throwDOMException(
        DOMExceptionNames.invalidCharacter,
        `Invalid attribute local name ${JSON.stringify(localName)}`,
      );
    }
    if (this.type === 'html') localName = asciiLower(localName);
    return this.createAttributeNode(localName, '', null, null);
  }

  write(...text: string[]): void {
    const writer = this.#writer;

    if (!writer) {
      throw new InternalError('Document has no active parser');
    }

    writer(text.join(''));
  }

  getElementById(id: string): ElementImpl | null {
    return findElementById(this, id);
  }

  getElementsByClassName(classNames: string): HTMLCollectionOf<Element> {
    return findElementsByClassName(this, classNames);
  }

  getElementsByTagName<K extends keyof HTMLElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<HTMLElementTagNameMap[K]>;
  getElementsByTagName<K extends keyof SVGElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<SVGElementTagNameMap[K]>;
  getElementsByTagName<K extends keyof MathMLElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<MathMLElementTagNameMap[K]>;
  /** @deprecated */
  getElementsByTagName<K extends keyof HTMLElementDeprecatedTagNameMap>(qualifiedName: K): HTMLCollectionOf<HTMLElementDeprecatedTagNameMap[K]>;
  getElementsByTagName(qualifiedName: string): HTMLCollectionOf<Element>;
  getElementsByTagName(qualifiedName: string): HTMLCollectionOf<Element> {
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

  /* ------------------------------------------------------------------
   * HTML document lifecycle
   * ------------------------------------------------------------------ */

  /** Environment of this document's relevant Window, required by HTML lifecycle operations. */
  get env(): Environment {
    if (this.#relevantGlobalObject === null) {
      throw new InternalError('Document lifecycle requires a relevant Window');
    }
    return this.#relevantGlobalObject.getWindowOrWorkerGlobalScopeMixin().env;
  }

  /** Finish the loading milestones and load event for Browlet's local route. */
  finishLoading(): void {
    const browsingContext = this.browsingContext;
    if (browsingContext === null) {
      throw new InternalError('A completely loaded Document needs a browsing context');
    }
    const window = browsingContext.activeWindow;
    if (window.getAssociatedDocument() !== this) {
      throw new InternalError('Only an active Document can finish loading');
    }

    // PROVISIONAL: the local route completes these parser/loading phases together.
    const env = this.env;
    const now = env.timing.currentHighResolutionTime().toTimestamp();
    const timing = this.loadTimingInfo;
    timing.domInteractiveTime = now;
    timing.domContentLoadedEventStartTime = now;
    timing.domContentLoadedEventEndTime = now;
    timing.domCompleteTime = now;
    timing.loadEventStartTime = now;
    this.currentDocumentReadiness = 'complete';
    this.readyForPostLoadTasks = true;
    fireEvent('load', window);
    timing.loadEventEndTime = env.timing.currentHighResolutionTime().toTimestamp();
    this.completelyFinishLoading();
  }

  /** Record that this document has completely finished loading. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#completely-finish-loading
  completelyFinishLoading(): void {
    if (this.browsingContext === null) {
      throw new InternalError('A completely loaded Document needs a browsing context');
    }
    this.completelyLoadedTime = currentCoarsenedWallTime().milliseconds;
    // PROVISIONAL: container/iframe load completion enters with child navigables.
  }

  /** Destroy an active document from a task on its owning event loop. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document
  destroy(): void {
    const env = this.env;
    const eventLoop = env.responsibleEventLoop;
    if (eventLoop.currentlyRunningTask === null) {
      throw new InternalError('Document destruction requires a task on its owning event loop');
    }

    // PROVISIONAL: inactive history destruction needs the retained document state;
    // using the navigable's current active entry would clear a different document.
    const navigable = this.getNodeNavigable();
    if (navigable === null) {
      throw new InternalError('Inactive document destruction needs session-history ownership');
    }
    const documentState = navigable.activeSessionHistoryEntry.documentState;
    const global = env.getWindowOrWorkerGlobalScopeMixin();

    this.abort();
    this.salvageable = false;
    for (const port of global.messagePorts) port.disentangle();
    this.runUnloadingCleanup();
    eventLoop.removeTasksForDocument(this);
    global.handoffReports();
    global.clearReportingState();

    this.browsingContext = null;
    documentState.document = null;
    this.notifyFullyActiveStateChanged();

    for (const worker of this.ownedWorkers) worker.ownerSet.delete(this);
    for (const worklet of this.workletGlobalScopes) worklet.terminate();
  }

  /** Stop this document's fetches and active parser from its owning event-loop task. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#abort-a-document
  abort(): void {
    const env = this.env;
    if (env.responsibleEventLoop.currentlyRunningTask === null) {
      throw new InternalError('Document abortion requires a task on its owning event loop');
    }
    if (env.fetchGroup.cancel()) this.makeUnsalvageable('fetch');

    const navigationID = this.duringLoadingNavigationID;
    if (navigationID !== null) {
      env.userAgent.webDriverBiDiNavigationAborted(this.getNodeNavigable(), {
        id: navigationID, status: 'canceled', url: this.url,
      });
      this.duringLoadingNavigationID = null;
    }

    const parser = this.activeParser;
    if (parser !== null) {
      this.activeParserWasAborted = true;
      parser.abort();
      this.makeUnsalvageable('parser-aborted');
    }
  }

  /** Clean up document-owned resources during unloading or destruction. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#unloading-document-cleanup-steps
  runUnloadingCleanup(): void {
    const env = this.env;
    const global = env.getWindowOrWorkerGlobalScopeMixin();
    for (const socket of global.webSockets) {
      socket.makeDisappear();
      this.makeUnsalvageable('websocket');
    }
    for (const transport of global.webTransports) transport.cleanup();
    if (!this.salvageable) {
      for (const source of global.eventSources) source.close();
      global.timers.clear();
    }
    env.userAgent.blobURLStore.removeForEnvironment(env);
    // TODO: connect fullscreen, media, service-worker, and lock cleanup as implemented.
  }

  /** Initialize ancestor origins for the document selected by this navigation. */
  initializeAncestry(navigationParams: NavigationParams): void {
    if (!navigationParams.navigable.isTopLevelTraversable) {
      throw new InternalError('Nested Document ancestry is not implemented');
    }
    // A top-level document has no ancestors; its iframe referrer policy is unused.
    this.internalAncestorOriginObjectsList = [];
    this.ancestorOriginsList = [];
  }

  /** Inherit the browsing context's upgrade policy before applying this document's own directives. */
  // https://w3c.github.io/webappsec-upgrade-insecure-requests/#nesting
  initializeInsecureRequestsPolicy(): void {
    const policy = this.browsingContext?.insecureRequestsPolicy;
    const env = this.env;
    if (policy?.upgrade) env.insecureRequestsPolicy = policy.clone();
    // Initial about:blank replacement can reuse the Window and environment.
    else if (env.insecureRequestsPolicy.upgrade) env.insecureRequestsPolicy = new InsecureRequestsPolicy();
  }

  /** Initialize the document's delivered Content Security Policies. */
  initializeCSP(): void {
    // PROVISIONAL: run CSP initialization when response parsing and CSP lists exist.
    // An enforced upgrade-insecure-requests directive enables
    // this.env.insecureRequestsPolicy.enableFor(this.url).
    // Report-only directives must leave that policy unchanged.
  }

  /** Record the referrer selected by the request that created this document. */
  initializeReferrer(request: NavigationRequest | null): void {
    if (request !== null) this.referrer = request.referrer === null ? '' : serializeURL(request.referrer);
  }

  /** Reset document-loading milestones around the selected navigation start. */
  initializeLoadTimingInfo(navigationStartTime: DOMHighResTimeStamp): void {
    this.loadTimingInfo = {
      navigationStartTime, domInteractiveTime: 0, domContentLoadedEventStartTime: 0,
      domContentLoadedEventEndTime: 0, domCompleteTime: 0, loadEventStartTime: 0, loadEventEndTime: 0,
    };
  }

  /** Create this document's navigation performance entry from the response timing. */
  createNavigationTimingEntry(navigationParams: NavigationParams): void {
    if (navigationParams.fetchController !== null) {
      throw new InternalError('Fetch timing extraction is not implemented');
    }
    // PROVISIONAL: create PerformanceNavigationTiming when its implementation exists.
  }

  /** Apply response integrations that require the newly created document. */
  processResponseIntegrations(navigationParams: NavigationParams): void {
    if (navigationParams.getResponseHeader('Refresh') !== null) {
      throw new InternalError('Refresh response processing is not implemented');
    }
    if (navigationParams.getResponseHeader('Link') !== null) {
      throw new InternalError('Link response processing is not implemented');
    }
    if (navigationParams.getResponseHeader('Speculation-Rules') !== null) {
      throw new InternalError('Speculation-Rules response processing is not implemented');
    }
    navigationParams.commitEarlyHints?.(this);
    // TODO(Fetch): potentially free deferred-fetch quota for this document.
  }

  // -- Internal ---------------------------------------------------------

  /** The URL used to resolve relative URLs in this document. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-url
  getBaseURL(): URLRecord {
    return this.#firstBaseElement === null ? this.getFallbackBaseURL() : this.#firstBaseElement.frozenBaseURL;
  }

  /** The base for resolving a base element's own href, or URLs without a base element. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fallback-base-url
  getFallbackBaseURL(): URLRecord {
    if (this.isIframeSrcdocDocument) {
      if (this.aboutBaseURL === null) throw new InternalError('A srcdoc document must have an about base URL');
      return this.aboutBaseURL;
    }
    const url = this.url;
    if (
      this.aboutBaseURL !== null && url.scheme === 'about' && url.path === 'blank' &&
      url.username === '' && url.password === '' && url.host === null
    ) {
      return this.aboutBaseURL;
    }
    return url;
  }

  // https://html.spec.whatwg.org/multipage/semantics.html#frozen-base-url
  updateBaseElement(changedHref?: HTMLBaseElementImpl): void {
    const first = findElement(this, (element) =>
      element instanceof HTMLBaseElementImpl && element.hasAttributeNS(null, 'href')
    ) as HTMLBaseElementImpl | null;
    if (first === this.#firstBaseElement && first !== changedHref) return;
    this.#firstBaseElement = first;
    first?.setFrozenBaseURL();
  }

  /*
   * Return the navigable whose active Document is this one. Inactive
   * Documents intentionally have no node navigable, even while session
   * history retains them for possible later reactivation.
   */
  getNodeNavigable(): Navigable | null {
    const navigable = this.browsingContext?.navigable;
    return navigable?.activeDocument === this ? navigable : null;
  }

  isFullyActive(): boolean {
    const navigable = this.getNodeNavigable();
    if (navigable === null) return false;
    if (navigable.isTopLevelTraversable) return true;

    /*
     * HTML defines a child navigable's answer recursively through its
     * container element's node Document. Browlet does not yet implement
     * navigable containers. Its parent navigable is not an equivalent
     * shortcut: after a parent navigation, the container can remain in the
     * inactive predecessor Document while parent.activeDocument refers to
     * its replacement.
     */
    return false;
  }

  observeFullyActiveState(observer: FullyActiveStateObserver): () => void {
    this.#fullyActiveObservers.add(observer);
    return () => { this.#fullyActiveObservers.delete(observer); };
  }

  notifyFullyActiveStateChanged(): void {
    const fullyActive = this.isFullyActive();
    for (const observer of this.#fullyActiveObservers) {
      observer(fullyActive);
    }
  }

  /** Prevent restoration from history and retain the reason for that decision. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#make-document-unsalvageable
  makeUnsalvageable(reason: string): void {
    this.bfcacheBlockingDetails.add({ reason });
    this.salvageable = false;
  }

  /** Copy the selected restrictions into the document's existing flag set. */
  setActiveSandboxingFlagSet(sandboxingFlagSet: ReadonlySet<SandboxingFlag>): void {
    this.activeSandboxingFlagSet.clear();
    for (const flag of sandboxingFlagSet) {
      this.activeSandboxingFlagSet.add(flag);
    }
  }

  override getEventParent(event: EventImpl): EventTargetImpl | null {
    if (event.type === 'load' || this.browsingContext === null) {
      return null;
    }

    if (this.#relevantGlobalObject === null) {
      throw new InternalError(
        'A Document with a browsing context needs a relevant global object',
      );
    }
    return this.#relevantGlobalObject;
  }

  setRelevantGlobalObject(window: WindowImpl): void {
    if (
      this.#relevantGlobalObject !== null &&
      this.#relevantGlobalObject !== window
    ) {
      throw new InternalError('A Document cannot change its relevant global object');
    }
    this.#relevantGlobalObject = window;
  }

  getRelevantGlobalObject(): WindowImpl | null {
    return this.#relevantGlobalObject;
  }

  getCSSEngine(): Stylelet {
    return this.#stylelet ??= new Stylelet(asDocument(this), {
      exec: this.styleletExec,
    });
  }

  withWriter<T>(writer: DocumentWriter, callback: () => T): T {
    const previousWriter = this.#writer;
    this.#writer = writer;

    try {
      return callback();
    } finally {
      this.#writer = previousWriter;
    }
  }

  createElementNode(localName: string, namespaceURI: typeof HTML_NAMESPACE): ElementImpl & HTMLElement;
  createElementNode(localName: string, namespaceURI: string): ElementImpl;
  createElementNode(localName: string, namespaceURI: string): ElementImpl {
    const elementInterface = resolveElementInterface(namespaceURI, localName);
    return this.#nodeFactory.constructNode<ElementImpl>(
      elementInterface.implementation,
      [{
        document: this,
        localName,
        namespaceURI,
        treeScopeResolver: this.#treeScopeResolver,
      }],
    );
  }

  createDocumentFragment(): DocumentFragmentImpl {
    return this.#nodeFactory.constructNode(
      DocumentFragmentImpl,
      [this],
    );
  }

  createAttributeNode(
    localName: string,
    value: string,
    namespaceURI: string | null,
    prefix: string | null,
  ): AttrImpl {
    return this.#nodeFactory.constructNode(AttrImpl, [
      localName,
      value,
      namespaceURI,
      prefix,
      this,
    ]);
  }

  createDocumentType(
    name: string,
    publicId: string,
    systemId: string,
  ): DocumentTypeImpl {
    return this.#nodeFactory.constructNode(
      DocumentTypeImpl,
      [name, publicId, systemId, this],
    );
  }

  addScriptBlockingStyleSheet(ownerNode: ElementImpl): void {
    this.#scriptBlockingStyleSheets.add(ownerNode);
  }

  removeScriptBlockingStyleSheet(ownerNode: ElementImpl): void {
    if (!this.#scriptBlockingStyleSheets.delete(ownerNode)) return;
    if (this.#scriptBlockingStyleSheets.size > 0) return;

    const ready = this.#scriptBlockingStyleSheetsReady;
    this.#scriptBlockingStyleSheetsReady = null;
    ready?.resolve(undefined);
  }

  hasScriptBlockingStyleSheets(): boolean {
    return this.#scriptBlockingStyleSheets.size > 0;
  }

  waitForScriptBlockingStyleSheets(env: JSEnvironment): PromiseValue<void> {
    return env.exec.promises.try(() => {
      if (this.#scriptBlockingStyleSheets.size === 0) return;
      const ready = this.#scriptBlockingStyleSheetsReady ??=
        env.exec.promises.withResolvers<void>();
      return ready.promise.then(() =>
        this.waitForScriptBlockingStyleSheets(env),
      );
    });
  }
}

// -- Web IDL ------------------------------------------------------------

export const documentIDL = defineInterface({
  name: 'Document',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(DocumentImpl, {
    constructWith: [
      atArg(0, (ctx): DOMNodeFactory => ({
        constructNode<T extends object>(
          implClass: ImplementationClass<T>,
          argumentsList: unknown[],
        ): T {
          return ctx.construct(implClass, ...argumentsList);
        },
      })),
      atArg<Realm>(1, (ctx) => createStyleletExecution(ctx.realm, ctx.getEnvironment())),
    ],
  }),
  members: [
    ctor(),
    roAttr('URL', idlType.USVString),
    roAttr('documentURI', idlType.USVString),
    roAttr('characterSet', idlType.DOMString),
    roAttr('charset', idlType.DOMString),
    roAttr('inputEncoding', idlType.DOMString),
    roAttr('doctype', nullable(reference('DocumentType'))),
    roAttr('documentElement', nullable(reference('Element'))),
    roAttr('contentType', idlType.DOMString),
    roAttr('compatMode', idlType.DOMString),
    op('getElementsByClassName', reference('HTMLCollection'), [
      arg('classNames', idlType.DOMString),
    ]),
    op('getElementsByTagName', reference('HTMLCollection'), [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getElementsByTagNameNS', reference('HTMLCollection'), [
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
  name: 'Document',
  members: [
    roAttr('head', nullable(reference('HTMLHeadElement'))),
    roAttr('body', nullable(reference('HTMLElement'))),
    op('write', idlType.undefined, [
      arg('text', idlType.DOMString, { variadic: true }),
    ]),
    roAttr('defaultView', nullable(reference('WindowProxy'))),
  ],
});

export const elementCreationOptionsIDL = defineDictionary({
  name: 'ElementCreationOptions',
  members: [dictMember('is', idlType.DOMString)],
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

class DocumentTreeScopeResolver implements TreeScopeResolver {
  #document: DocumentImpl;

  constructor(document: DocumentImpl) {
    this.#document = document;
  }

  resolve(root: NodeImpl): TreeScope | null {
    return root === this.#document
      ? this.#document.getCSSEngine().documentScope
      : null;
  }
}

export type DOMNodeFactory = {
  constructNode<T extends object>(
    implementation: abstract new (...argumentsList: never[]) => T,
    argumentsList: unknown[],
  ): T;
};

export const directDOMNodeFactory: DOMNodeFactory = {
  constructNode<T extends object>(
    implementation: abstract new (...argumentsList: never[]) => T,
    argumentsList: unknown[],
  ): T {
    return Reflect.construct(implementation, argumentsList) as T;
  },
};

export type DocumentWriter = (markup: string) => void;

export type DocumentType = 'xml' | 'html';

export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}

export type ModuleMap = {
  entries: ModuleMapEntry[];
};

export type ModuleMapKey = [URLRecord, string];

export type ModuleMapEntry = {
  key: ModuleMapKey;
  value: unknown;
};

export type DocumentLoadTimingInfo = {
  navigationStartTime: DOMHighResTimeStamp;
  domInteractiveTime: DOMHighResTimeStamp;
  domContentLoadedEventStartTime: DOMHighResTimeStamp;
  domContentLoadedEventEndTime: DOMHighResTimeStamp;
  domCompleteTime: DOMHighResTimeStamp;
  loadEventStartTime: DOMHighResTimeStamp;
  loadEventEndTime: DOMHighResTimeStamp;
};

type FullyActiveStateObserver = (fullyActive: boolean) => void;

function parseDocumentURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new InternalError(`Could not parse document URL ${input}`);
  return url;
}
