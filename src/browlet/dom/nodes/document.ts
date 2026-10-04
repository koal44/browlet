import {
  Stylelet, type TreeScope, type CSSStyleSheetImpl, type StyleSheetListImpl,
} from '../../../stylelet/index';
import type { InternalPromise, InternalPromiseWithResolvers } from '../../../infra/promises';
import type { JSEnvironment } from '../../../js-engine/index';
import type { HTMLCollectionImpl } from './collections';
import type { TreeScopeResolver } from '../../style/integration';
import type { EventTargetImpl } from '../events/event-target';
import type { EventImpl } from '../events/event';
import { isValidAttributeLocalName } from '../infra/name-validation';
import type { BrowsingContext } from '../../browsing/browsing-context';
import type { Navigable } from '../../browsing/navigable';
import type { NotRestoredReasonDetails } from '../../browsing/navigation/session-history';
import type { NavigationParams } from '../../browsing/navigation/params';
import type { BrowletEnvironment } from '../../scripting/environment';
import { InsecureRequestsPolicy } from '../../browsing/policy/upgrade-insecure-requests';
import { CSPList } from '../../browsing/policy/csp/list';
import type { FetchRequest, FetchResponse } from '../../../fetch/index';
import type { NavigationTimingRecord } from '../../performance/navigation';
import { currentCoarsenedWallTime, type DOMHighResTimeStamp } from '../../performance/high-resolution-time';
import type { WindowImpl } from '../../browsing/window/window';
import type { WindowProxy } from '../../platform';
import type { CustomElementRegistryImpl } from '../../html/custom-elements/registry';
import { PolicyContainer } from '../../browsing/policy/container';
import { OpenerPolicy } from '../../browsing/policy/coop';
import { PermissionsPolicy } from '../../browsing/policy/permissions';
import { SandboxingFlagSet, type SandboxingFlag } from '../../browsing/policy/sandbox';
import { asciiLower } from '../../../infra/ascii';
import {
  arg, atArg, ctor, defineDictionary, defineIncludes, defineInterface, definePartialInterface,
  dictMember, emptyDictionary, idlType, impl, nullable, op, roAttr, reference, union,
  DOMExceptionNames, DOMExceptionImpl, type ImplementationClass,
} from '../../../web-idl/index';
import { createOpaqueOrigin, type Origin, parseURL, serializeURL, type URLRecord } from '../../../url/index';
import { AttrImpl } from './attribute';
import { CommentImpl } from './comment';
import { DocumentFragmentImpl } from './document-fragment';
import { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import { HTML_NAMESPACE } from '../../../infra/index';
import { NodeImpl, NodeType } from './node';
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
import { HTMLElementImpl } from '../../html/elements/html-element';
import { HTMLHeadElementImpl } from '../../html/elements/metadata/head';
import { InternalError } from '../../../infra/internal-error';

/** Create a document in env with optional binding-owned node allocation. */
export function createDocument(
  options: DocumentConstructionOptions = {},
  env: BrowletEnvironment,
): DocumentImpl {
  const nodeFactory = options.nodeFactory ?? directDOMNodeFactory;
  return nodeFactory.constructNode(DocumentImpl, [nodeFactory, env]);
}

export type DocumentConstructionOptions = {
  /** Allocate this document and its descendants through the selected binding. */
  nodeFactory?: DOMNodeFactory;
};

/** Owns a document tree, node creation, and document loading state. */
// https://dom.spec.whatwg.org/#interface-document
export class DocumentImpl extends NodeImpl {
  /** Browser settings used by this document's loading, policy, and event operations. */
  declare env: BrowletEnvironment;
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
  // PROVISIONAL: full parser abort/lifecycle steps remain in the HTML parser roadmap.
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
  policyContainer = new PolicyContainer();
  /** HTTP status of the resource that created this Document; zero when there was no response. */
  httpStatus = 0;
  /** Permissions policy controlling features in this document. */
  permissionsPolicy = new PermissionsPolicy();
  /** Cross-origin opener policy selected for this document. */
  openerPolicy = new OpenerPolicy();
  /** Sandbox restrictions currently applied to the document. */
  activeSandboxingFlagSet = new SandboxingFlagSet();
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
  /** Retained navigation inputs; public Performance entry creation is provisional. */
  navigationTimingEntry?: NavigationTimingRecord;
  /** Completion timestamp, or null until the document is completely loaded. */
  completelyLoadedTime: number | null = null;
  /** Whether tasks that depend on loading completion may proceed. */
  readyForPostLoadTasks = false;

  /** Relevant Window, associated once when the document enters a realm. */
  #relevantGlobalObject: WindowImpl | null = null;
  /** First base element with an href attribute, whose frozen URL supplies the base. */
  #firstBaseElement: HTMLBaseElementImpl | null = null;
  /** Internal subscribers notified when navigation changes this document's activity. */
  #fullyActiveObservers = new Set<FullyActiveStateObserver>();
  /** Lazily created style engine for this document. */
  #stylelet: Stylelet | undefined;
  /** Registry and style-sheet access shared with shadow roots. */
  #documentOrShadowRootMixin: DocumentOrShadowRootMixin;
  /** Live child collection and element-child navigation. */
  #parentNodeMixin: ParentNodeMixin;
  /** Maps a node's tree root to its owning style scope. */
  #treeScopeResolver: TreeScopeResolver;

  /** Ordered set of sheet owners currently blocking script execution. */
  // https://html.spec.whatwg.org/#script-blocking-style-sheet-set
  #scriptBlockingStyleSheets = new Set<ElementImpl>();
  /** Shared wait resolved when the blocking style-sheet set becomes empty. */
  #scriptBlockingStyleSheetsReady: InternalPromiseWithResolvers<void> | null = null;
  /** Node allocator selected when the document is created. */
  #nodeFactory: DOMNodeFactory;
  /** Parser input callback installed while document.write() is permitted. */
  #writer: DocumentWriter | undefined;

  constructor(
    nodeFactory: DOMNodeFactory = directDOMNodeFactory,
    env: BrowletEnvironment,
  ) {
    super(NodeType.Document, null, env);
    this.nodeDocument = this;
    this.#nodeFactory = nodeFactory;
    this.#treeScopeResolver = new DocumentTreeScopeResolver(this);
    this.#documentOrShadowRootMixin = new DocumentOrShadowRootMixin({
      getCustomElementRegistry: () => this.customElementRegistry,
      getStyleScope: () => this.getCSSEngine().documentScope,
    });
    this.#parentNodeMixin = new ParentNodeMixin(this);
  }

  static is(value: unknown): value is DocumentImpl {
    return value instanceof DocumentImpl;
  }

  // https://dom.spec.whatwg.org/#dom-document-url
  get URL(): string {
    return serializeURL(this.url);
  }

  /** Legacy alias of the serialized document URL. */
  // https://dom.spec.whatwg.org/#dom-document-documenturi
  get documentURI(): string {
    return this.URL;
  }

  // https://dom.spec.whatwg.org/#dom-node-baseuri
  override get baseURI(): string {
    return serializeURL(this.getBaseURL());
  }

  // https://dom.spec.whatwg.org/#dom-document-characterset
  get characterSet(): string {
    return this.encoding;
  }

  /** Legacy alias of characterSet. */
  get charset(): string {
    return this.characterSet;
  }

  /** Legacy alias of characterSet. */
  get inputEncoding(): string {
    return this.characterSet;
  }

  /** Associated WindowProxy, or null without a browsing context. */
  // https://html.spec.whatwg.org/#dom-document-defaultview
  get defaultView(): WindowProxy | null {
    return this.browsingContext?.windowProxy.platform ?? null;
  }

  // https://html.spec.whatwg.org/#dom-document-readystate
  get readyState(): DocumentReadyState {
    return this.currentDocumentReadiness;
  }

  // https://dom.spec.whatwg.org/#dom-document-compatmode
  get compatMode(): 'BackCompat' | 'CSS1Compat' {
    return this.mode === DocumentMode.Quirks
      ? 'BackCompat'
      : 'CSS1Compat';
  }

  // https://dom.spec.whatwg.org/#dom-document-doctype
  get doctype(): DocumentTypeImpl | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (child.isDocumentType()) return child;
    }

    return null;
  }

  /** First element child of the document, or null before one is inserted. */
  // https://dom.spec.whatwg.org/#dom-document-documentelement
  get documentElement(): ElementImpl | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (child.isElement()) return child;
    }

    return null;
  }

  // https://html.spec.whatwg.org/#dom-document-head
  get head(): HTMLHeadElementImpl | null {
    const html = this.documentElement;
    if (!HTMLElementImpl.is(html) || html.localName !== 'html') {
      return null;
    }

    for (let child = html.firstChild; child; child = child.nextSibling) {
      if (HTMLHeadElementImpl.is(child)) return child;
    }

    return null;
  }

  /** First body or frameset child of an HTML document element. */
  // https://html.spec.whatwg.org/#dom-document-body
  get body(): HTMLElementImpl | null {
    const html = this.documentElement;
    if (!HTMLElementImpl.is(html) || html.localName !== 'html') {
      return null;
    }

    for (let child = html.firstChild; child; child = child.nextSibling) {
      if (
        HTMLElementImpl.is(child) &&
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

  // https://dom.spec.whatwg.org/#dom-document-createelement
  createElement(
    localName: string,
    _options?: string | ElementCreationOptionsRecord,
  ): ElementImpl {
    if (this.type === 'html') localName = asciiLower(localName);
    return this.createElementNode(localName, HTML_NAMESPACE);
  }

  // https://dom.spec.whatwg.org/#dom-document-createelementns
  createElementNS(
    namespaceURI: string | null,
    qualifiedName: string,
    _options?: string | ElementCreationOptionsRecord,
  ): ElementImpl {
    return this.createElementNode(qualifiedName, namespaceURI ?? '');
  }

  // https://dom.spec.whatwg.org/#dom-document-createtextnode
  createTextNode(data: string): TextImpl {
    return this.#nodeFactory.constructNode(TextImpl, [data, this, this.env]);
  }

  // https://dom.spec.whatwg.org/#dom-document-createcomment
  createComment(data: string): CommentImpl {
    return this.#nodeFactory.constructNode(CommentImpl, [data, this, this.env]);
  }

  // https://dom.spec.whatwg.org/#dom-document-createattribute
  createAttribute(localName: string): AttrImpl {
    if (!isValidAttributeLocalName(localName)) {
      throw new DOMExceptionImpl(
        `Invalid attribute local name ${JSON.stringify(localName)}`,
        DOMExceptionNames.invalidCharacter,
      );
    }
    if (this.type === 'html') localName = asciiLower(localName);
    return this.createAttributeNode(localName, '', null, null);
  }

  /** Feed markup to the currently installed parser writer. */
  // https://html.spec.whatwg.org/#dom-document-write
  write(...text: string[]): void {
    const writer = this.#writer;

    if (!writer) {
      throw new InternalError('Document has no active parser');
    }

    writer(text.join(''));
  }

  // https://dom.spec.whatwg.org/#dom-nonelementparentnode-getelementbyid
  getElementById(id: string): ElementImpl | null {
    return findElementById(this, id);
  }

  // https://dom.spec.whatwg.org/#dom-document-getelementsbyclassname
  getElementsByClassName(classNames: string): HTMLCollectionImpl {
    return findElementsByClassName(this, classNames);
  }

  // https://dom.spec.whatwg.org/#dom-document-getelementsbytagname
  getElementsByTagName(qualifiedName: string): HTMLCollectionImpl {
    return findElementsByTagName(this, qualifiedName);
  }

  // https://dom.spec.whatwg.org/#dom-document-getelementsbytagnamens
  getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): HTMLCollectionImpl {
    return findElementsByTagNameNS(this, namespaceURI, localName);
  }

  // ---------------------------------------------------------------------
  // HTML document lifecycle
  // ---------------------------------------------------------------------

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
    window.fireEvent('load');
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
    // An inherited list already carries its creator's origin. An empty new
    // list also needs an origin before later meta policies can be added.
    this.policyContainer.cspList ??= new CSPList(this.origin);
    this.policyContainer.cspList.initializeDocument(this);
  }

  /** Record the referrer selected by the request that created this document. */
  initializeReferrer(request: FetchRequest | null): void {
    if (request === null) return;
    if (request.referrer === undefined) throw new InternalError('Navigation request referrer has not been resolved');
    this.referrer = request.referrer === null ? '' : serializeURL(request.referrer);
  }

  /** Reset document-loading milestones around the selected navigation start. */
  initializeLoadTimingInfo(navigationStartTime: DOMHighResTimeStamp): void {
    this.loadTimingInfo = {
      navigationStartTime, domInteractiveTime: 0, domContentLoadedEventStartTime: 0,
      domContentLoadedEventEndTime: 0, domCompleteTime: 0, loadEventStartTime: 0, loadEventEndTime: 0,
    };
  }

  /** Retain navigation timing inputs for this document. */
  // https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry
  createNavigationTimingEntry(navigationParams: NavigationParams): void {
    const controller = navigationParams.fetchController;
    if (controller === null) return;
    // PROVISIONAL(Navigation Timing): retain live inputs without exposing a
    // PerformanceNavigationTiming object before its Timeline foundation exists.
    this.navigationTimingEntry = {
      type: navigationParams.navigationTimingType,
      fetchTimingInfo: controller.extractFullTimingInfo(),
      bodyInfo: navigationParams.response.bodyInfo,
      documentTimingInfo: this.loadTimingInfo,
      responseStatus: navigationParams.response.status,
    };
  }

  /** Wait until navigation permits scripts in the newly created document. */
  // https://html.spec.whatwg.org/#scripts-may-run-for-the-newly-created-document
  waitForScriptsMayRun(): InternalPromise<void> {
    // PROVISIONAL(HTML navigation): current callers commit synchronously before
    // parser tasks run. Full navigation must supply its script-readiness gate.
    return this.env.exec.Promise.try(() => {}, idlType.undefined);
  }

  /** Process response Link fields for the selected document-loading phase. */
  // https://html.spec.whatwg.org/multipage/links.html#process-link-headers
  processLinkHeaders(_response: FetchResponse, _phase: 'pre-media' | 'media'): void {
    // PROVISIONAL(HTML Link): preload/link processing and media selection are
    // not implemented. Both loader phases reach this owner without side effects.
  }

  /** Apply response integrations that require the newly created document. */
  processResponseIntegrations(navigationParams: NavigationParams): void {
    const response = navigationParams.response;
    this.httpStatus = response.status;
    this.env.getWindowOrWorkerGlobalScopeMixin().initializeReportingEndpoints(response);
    if (response.headerList.get('Refresh') !== null) {
      throw new InternalError('Refresh response processing is not implemented');
    }
    this.processLinkHeaders(response, 'pre-media');
    if (response.headerList.get('Speculation-Rules') !== null) {
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

  /** Recompute the controlling base element after insertion, removal, or an href change. */
  // https://html.spec.whatwg.org/multipage/semantics.html#frozen-base-url
  updateBaseElement(changedHref?: HTMLBaseElementImpl): void {
    const first = findElement(this, (element) =>
      HTMLBaseElementImpl.is(element) && element.hasAttributeNS(null, 'href')
    ) as HTMLBaseElementImpl | null;
    if (first === this.#firstBaseElement && first !== changedHref) return;
    this.#firstBaseElement = first;
    first?.setFrozenBaseURL();
  }

  /** Navigable whose active document is this one; null for inactive history entries. */
  // https://html.spec.whatwg.org/#node-navigable
  getNodeNavigable(): Navigable | null {
    const navigable = this.browsingContext?.navigable;
    return navigable?.activeDocument === this ? navigable : null;
  }

  /** Whether this document is active throughout its navigable ancestry. */
  // https://html.spec.whatwg.org/#fully-active
  isFullyActive(): boolean {
    const navigable = this.getNodeNavigable();
    if (navigable === null) return false;
    if (navigable.isTopLevelTraversable) return true;

    // TODO: recurse through the child navigable's container document.
    // parent.activeDocument is not a substitute: the container can remain
    // in the inactive predecessor document after its parent navigates.
    return false;
  }

  /** Subscribe to activity changes and return an unsubscribe function. */
  observeFullyActiveState(observer: FullyActiveStateObserver): () => void {
    this.#fullyActiveObservers.add(observer);
    return () => { this.#fullyActiveObservers.delete(observer); };
  }

  /** Notify internal subscribers after navigation or lifecycle state changes. */
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

  /** Propagate events to the relevant Window, except for load events. */
  // https://dom.spec.whatwg.org/#interface-document
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

  /** Associate the document with its relevant Window without permitting replacement. */
  setRelevantGlobalObject(window: WindowImpl): void {
    if (
      this.#relevantGlobalObject !== null &&
      this.#relevantGlobalObject !== window
    ) {
      throw new InternalError('A Document cannot change its relevant global object');
    }
    this.#relevantGlobalObject = window;
  }

  /** Relevant Window, retained even when this document is no longer active. */
  getRelevantGlobalObject(): WindowImpl | null {
    return this.#relevantGlobalObject;
  }

  /** Initialize or retrieve the style engine owned by this document. */
  getCSSEngine(): Stylelet {
    return this.#stylelet ??= new Stylelet(this, { env: this.env });
  }

  /** Temporarily route document.write() to a parser while the callback runs. */
  withWriter<T>(writer: DocumentWriter, callback: () => T): T {
    const previousWriter = this.#writer;
    this.#writer = writer;

    try {
      return callback();
    } finally {
      this.#writer = previousWriter;
    }
  }

  /** Allocate the registered element implementation for a namespace and local name. */
  createElementNode(localName: string, namespaceURI: string): ElementImpl {
    const elementInterface = resolveElementInterface(namespaceURI, localName);
    return this.#nodeFactory.constructNode<ElementImpl>(
      elementInterface.implementation,
      [{
        document: this,
        localName,
        namespaceURI,
        treeScopeResolver: this.#treeScopeResolver,
      }, this.env],
    );
  }

  // https://dom.spec.whatwg.org/#dom-document-createdocumentfragment
  createDocumentFragment(): DocumentFragmentImpl {
    return this.#nodeFactory.constructNode(
      DocumentFragmentImpl,
      [this, null, this.env],
    );
  }

  /** Allocate an attribute from an already selected name, namespace, and value. */
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
      this.env,
    ]);
  }

  /** Allocate a doctype associated with this document. */
  createDocumentType(
    name: string,
    publicId: string,
    systemId: string,
  ): DocumentTypeImpl {
    return this.#nodeFactory.constructNode(
      DocumentTypeImpl,
      [name, publicId, systemId, this, this.env],
    );
  }

  /** Register a sheet owner that delays script execution. */
  addScriptBlockingStyleSheet(ownerNode: ElementImpl): void {
    this.#scriptBlockingStyleSheets.add(ownerNode);
  }

  /** Release a sheet owner and wake waiters when the blocking set becomes empty. */
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

  /** Wait for the blocking set to empty, rechecking for sheets added before resumption. */
  waitForScriptBlockingStyleSheets(env: JSEnvironment): InternalPromise<void> {
    return env.exec.Promise.try(() => {
      if (this.#scriptBlockingStyleSheets.size === 0) return;
      const ready = this.#scriptBlockingStyleSheetsReady ??=
        env.exec.Promise.withResolvers(idlType.undefined);
      return ready.promise.then(() =>
        this.waitForScriptBlockingStyleSheets(env),
      );
    }, idlType.undefined);
  }
}

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
export const documentIDL = defineInterface<BrowletEnvironment>({
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
          return ctx.construct(implClass, argumentsList);
        },
      })),
      atArg(1, (ctx) => ctx.realm.env),
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
      arg('options', union(idlType.DOMString, reference('ElementCreationOptions')),
        {
          default: emptyDictionary,
          optional: true,
        },
      ),
    ]),
    op('createElementNS', reference('Element'), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('qualifiedName', idlType.DOMString),
      arg('options', union(idlType.DOMString, reference('ElementCreationOptions')),
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

/** Converted element-creation options supported by the current declaration. */
export type ElementCreationOptionsRecord = {
  is?: string;
};

/*
 * dictionary ElementCreationOptions {
 *   CustomElementRegistry? customElementRegistry;
 *   DOMString is;
 * };
 */
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

/** Resolves the document's style scope for nodes in its tree. */
class DocumentTreeScopeResolver implements TreeScopeResolver {
  /** Document whose style engine owns the scope. */
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

/** Node allocation supplied by the document's composition or binding boundary. */
export type DOMNodeFactory = {
  /** Construct an implementation, establishing binding ownership when needed. */
  constructNode<T extends object>(
    implementation: abstract new (...argumentsList: never[]) => T,
    argumentsList: unknown[],
  ): T;
};

/** Allocate standalone implementations without establishing platform-object ownership. */
export const directDOMNodeFactory: DOMNodeFactory = {
  constructNode<T extends object>(
    implementation: abstract new (...argumentsList: never[]) => T,
    argumentsList: unknown[],
  ): T {
    return Reflect.construct(implementation, argumentsList) as T;
  },
};

/** Active parser input used by document.write(). */
export type DocumentWriter = (markup: string) => void;

/** Loading stage exposed by the document's readyState attribute. */
export type DocumentReadyState = 'loading' | 'interactive' | 'complete';

/** Visibility reported for a document or its traversable. */
// https://html.spec.whatwg.org/multipage/interaction.html#document-visibility
export type DocumentVisibilityState = 'hidden' | 'visible';

/** Selects HTML or XML rules for document operations. */
// https://dom.spec.whatwg.org/#concept-document-type
export type DocumentType = 'xml' | 'html';

/** Parser-selected compatibility mode for document and CSS behavior. */
// https://dom.spec.whatwg.org/#concept-document-mode
export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}

/** Module loading results retained by the document. */
// https://html.spec.whatwg.org/#module-map
export type ModuleMap = {
  /** Entries indexed by request URL and module type. */
  entries: ModuleMapEntry[];
};

/** Request URL and module type used to identify a module-map entry. */
export type ModuleMapKey = [URLRecord, string];

export type ModuleMapEntry = {
  /** Request identity used to find this entry. */
  key: ModuleMapKey;
  /** Loading state or module result; the module loader's representation is provisional. */
  value: unknown;
};

/** Absolute loading timestamps, with zero for milestones not yet reached. */
// https://html.spec.whatwg.org/#document-load-timing-info
export type DocumentLoadTimingInfo = {
  /** Start of the navigation that created this document. */
  navigationStartTime: DOMHighResTimeStamp;
  /** Transition to interactive readiness. */
  domInteractiveTime: DOMHighResTimeStamp;
  /** Start of DOMContentLoaded dispatch. */
  domContentLoadedEventStartTime: DOMHighResTimeStamp;
  /** Completion of DOMContentLoaded dispatch. */
  domContentLoadedEventEndTime: DOMHighResTimeStamp;
  /** Transition to complete readiness. */
  domCompleteTime: DOMHighResTimeStamp;
  /** Start of Window load-event dispatch. */
  loadEventStartTime: DOMHighResTimeStamp;
  /** Completion of Window load-event dispatch. */
  loadEventEndTime: DOMHighResTimeStamp;
};

type FullyActiveStateObserver = (fullyActive: boolean) => void;

function parseDocumentURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new InternalError(`Could not parse document URL ${input}`);
  return url;
}
