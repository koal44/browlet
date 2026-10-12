import type { InternalPromise, InternalPromiseWithResolvers } from '../../../infra/promises';
import { asciiLower } from '../../../infra/ascii';
import { HTML_NAMESPACE } from '../../../infra/index';
import { InternalError } from '../../../infra/internal-error';
import type { JSEnvironment } from '../../../js-engine/index';
import {
  arg, atArg, ctor, defineDictionary, defineIncludes, defineInterface, definePartialInterface,
  dictMember, emptyDictionary, idlType, impl, integer, nullable, op, roAttr, reference, union,
  DOMExceptionNames, DOMExceptionImpl, xattr, type ImplementationClass,
} from '../../../web-idl/index';
import { createSelectlet, type Selectlet } from '../../../selectlet/index';
import {
  Stylelet, type TreeScope, type CSSStyleSheetImpl, type StyleSheetListImpl,
} from '../../../stylelet/index';
import { createOpaqueOrigin, type Origin, parseURL, serializeURL, type URLRecord } from '../../../url/index';
import type { FetchRequest, FetchResponse, ReferrerPolicy } from '../../../fetch/index';

import { currentCoarsenedWallTime, type DOMHighResTimeStamp } from '../../timing/index';
import { isValidAttributeLocalName, isValidElementLocalName, validateAndExtract } from '../infra/index';
import type { TreeScopeResolver } from '../../style/index';
import type { SpeculationRulesParseResult } from '../../scripting/index';
import { EventImpl, CustomEventImpl, type EventTargetImpl } from '../events/index';
import {
  InsecureRequestsPolicy, PolicyContainer, OpenerPolicy, PermissionsPolicy, SandboxingFlagSet,
  type SandboxingFlag,
} from '../../browsing/policy/index';
import { CSPList } from '../../browsing/policy/csp/index';
import { RangeImpl } from '../ranges/index';
import { NodeIteratorImpl, TreeWalkerImpl, SHOW_ALL, type NodeFilterCallback } from '../traversal/index';
import type { NavigationTimingRecord } from '../../performance/index';
import type { BrowletEnvironment } from '../../environment';
import type { WindowImpl, WindowProxyHandle } from '../../browsing/window/index';
import type {
  BrowsingContext, Navigable, NotRestoredReasonDetails, NavigationParams,
} from '../../browsing/navigation/index';

import type { HTMLCollectionImpl, NodeListImpl } from './collections';
import { AttrImpl } from './attribute';
import { CDATASectionImpl } from './cdata-section';
import { CommentImpl } from './comment';
import { DOMImplementationImpl } from './dom-implementation';
import { ProcessingInstructionImpl } from './processing-instruction';
import { DocumentFragmentImpl } from './document-fragment';
import { DocumentTypeImpl } from './document-type';
import { ShadowRootImpl, type ShadowRootMode } from './shadow-root';
import type { ElementImpl } from './element';
import { NodeImpl, NodeType } from './node';
import {
  DocumentOrShadowRootMixin, documentOrShadowRootIDL,
} from './document-or-shadow-root';
import { ParentNodeMixin, parentNodeIDL } from './parent-node';
import { nonElementParentNodeIDL } from './non-element-parent-node';
import { TextImpl } from './text';
import {
  findElement, findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';
import { resolveElementInterface } from './element-interfaces';
import { HTMLBaseElementImpl, HTMLHeadElementImpl } from './html/metadata/index';
import { HTMLElementImpl, HTMLScriptElementImpl } from './html/index';
import type { CustomElementRegistryImpl } from './html/custom-elements/index';

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
  /** Invalidates live collections after any tree or attribute mutation in this document. */
  collectionVersion = 0;
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

  /** Relevant Window of the construction realm, retained independently of document activity. */
  #relevantGlobalObject: WindowImpl | null = null;
  /** First base element with an href attribute, whose frozen URL supplies the base. */
  #firstBaseElement: HTMLBaseElementImpl | null = null;
  /** Internal subscribers notified when navigation changes this document's activity. */
  #fullyActiveObservers = new Set<FullyActiveStateObserver>();
  /** Lazily created style engine for this document. */
  #stylelet: Stylelet | undefined;
  /** Selector parsing and compilation caches shared by queries in this document. */
  #selectlet: Selectlet<NodeImpl, ElementImpl, DocumentImpl, DocumentFragmentImpl> | undefined;
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
  /** Stable factory object associated with this document. */
  #implementation: DOMImplementationImpl | undefined;
  /** Parser input callback installed while document.write() is permitted. */
  #writer: DocumentWriter | undefined;

  constructor(
    nodeFactory: DOMNodeFactory = directDOMNodeFactory,
    env: BrowletEnvironment,
  ) {
    super(NodeType.Document, null, env);
    this.nodeDocument = this;
    if (env.realm.isWindow()) this.#relevantGlobalObject = env.realm.windowImplementation;
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

  /** Associated WindowProxy handle, or null without a browsing context. */
  // https://html.spec.whatwg.org/#dom-document-defaultview
  get defaultView(): WindowProxyHandle | null {
    return this.browsingContext?.windowProxy ?? null;
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

  get children(): HTMLCollectionImpl {
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

  prepend(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.prepend(...nodes);
  }

  append(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.append(...nodes);
  }

  replaceChildren(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.replaceChildren(...nodes);
  }

  moveBefore(node: NodeImpl, child: NodeImpl | null): void {
    this.#parentNodeMixin.moveBefore(node, child);
  }

  querySelector(selectors: string): ElementImpl | null {
    return this.#parentNodeMixin.querySelector(selectors);
  }

  querySelectorAll(selectors: string): NodeListImpl {
    return this.#parentNodeMixin.querySelectorAll(selectors);
  }

  // https://dom.spec.whatwg.org/#dom-document-createelement
  createElement(
    localName: string,
    options: string | ElementCreationOptionsRecord = {},
  ): ElementImpl {
    if (!isValidElementLocalName(localName)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    }
    if (this.type === 'html') localName = asciiLower(localName);
    const namespace = this.type === 'html' || this.contentType === 'application/xhtml+xml' ? HTML_NAMESPACE : '';
    const [registry, isValue] = this.#extractElementCreationOptions(options);
    return this.createElementNode(localName, namespace, null, isValue, registry);
  }

  // https://dom.spec.whatwg.org/#dom-document-createelementns
  createElementNS(
    namespaceURI: string | null,
    qualifiedName: string,
    options: string | ElementCreationOptionsRecord = {},
  ): ElementImpl {
    const [namespace, prefix, localName] = validateAndExtract(namespaceURI, qualifiedName, 'element');
    const [registry, isValue] = this.#extractElementCreationOptions(options);
    return this.createElementNode(localName, namespace ?? '', prefix, isValue, registry);
  }

  /** Stable DOM factory object; the associated document selects origin and allocation realm. */
  // https://dom.spec.whatwg.org/#dom-document-implementation
  get implementation(): DOMImplementationImpl {
    return this.#implementation ??= new DOMImplementationImpl(this, this.env);
  }

  /** Create a detached Document or XMLDocument through this document's allocator. */
  createDocumentNode(xml = false): DocumentImpl {
    return this.#nodeFactory.constructNode(xml ? XMLDocumentImpl : DocumentImpl, [this.#nodeFactory, this.env]);
  }

  /** Copy document metadata without copying its browsing context or runtime services. */
  // https://dom.spec.whatwg.org/#concept-node-clone-single
  cloneDocument(document: DocumentImpl): DocumentImpl {
    const copy = document.createDocumentNode(this instanceof XMLDocumentImpl);
    copy.encoding = this.encoding;
    copy.contentType = this.contentType;
    copy.url = this.url;
    copy.origin = this.origin;
    copy.type = this.type;
    copy.mode = this.mode;
    copy.allowDeclarativeShadowRoots = this.allowDeclarativeShadowRoots;
    if (this.customElementRegistry?.isScoped) copy.customElementRegistry = this.customElementRegistry;
    return copy;
  }

  /** Validate XML-only CDATA construction; later data mutations need not preserve XML syntax. */
  // https://dom.spec.whatwg.org/#dom-document-createcdatasection
  createCDATASection(data: string): CDATASectionImpl {
    if (this.type === 'html') throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    if (data.includes(']]>')) throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    return this.createCDATASectionNode(data);
  }

  /** Allocate existing CDATA data, including data that became non-XML after mutation. */
  createCDATASectionNode(data: string): CDATASectionImpl {
    return this.#nodeFactory.constructNode(CDATASectionImpl, [data, this, this.env]);
  }

  /** Create and initialize a processing instruction in this document. */
  // https://dom.spec.whatwg.org/#dom-document-createprocessinginstruction
  createProcessingInstruction(target: string, data: string): ProcessingInstructionImpl {
    return this.#nodeFactory.constructNode(ProcessingInstructionImpl, [target, data, this, this.env]);
  }

  /** Copy retained instruction data without repeating public creation validation. */
  createProcessingInstructionNode(target: string, data: string): ProcessingInstructionImpl {
    // SPEC_GAP(processing-instruction-clone-attributes): Cloning copies data without specifying
    // how to initialize the pseudo-attribute map. Reparse the copied data through the shared setter.
    const copy = this.createProcessingInstruction(target, '');
    copy.data = data;
    return copy;
  }

  /** Copy a foreign node into this document, selecting the destination's registry and realm. */
  // https://dom.spec.whatwg.org/#dom-document-importnode
  importNode(node: NodeImpl, options: boolean | ImportNodeOptions): NodeImpl {
    if (node.isDocument() || node.isShadowRoot()) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    let registry: CustomElementRegistryImpl | null = null;
    let subtree: boolean;
    if (typeof options === 'boolean') {
      subtree = options;
    } else {
      subtree = !options.selfOnly;
      registry = options.customElementRegistry ?? null;
      this.#validateRegistry(registry);
    }
    registry ??= this.lookupCustomElementRegistry();
    return node.clone(this, subtree, null, registry);
  }

  // https://dom.spec.whatwg.org/#dom-document-createtextnode
  createTextNode(data: string): TextImpl {
    return this.#nodeFactory.constructNode(TextImpl, [data, this, this.env]);
  }

  // https://dom.spec.whatwg.org/#dom-document-createcomment
  createComment(data: string): CommentImpl {
    return this.#nodeFactory.constructNode(CommentImpl, [data, this, this.env]);
  }

  /** Create a live range collapsed at this document's start. */
  // https://dom.spec.whatwg.org/#dom-document-createrange
  createRange(): RangeImpl {
    return new RangeImpl(this, this.env);
  }

  /** Legacy author event construction; the result must be initialized before dispatch. */
  // https://dom.spec.whatwg.org/#dom-document-createevent
  createEvent(name: string): EventImpl {
    const normalized = asciiLower(name);
    const constructor = normalized === 'customevent' ? CustomEventImpl
      : normalized === 'event' || normalized === 'events' || normalized === 'htmlevents' ? EventImpl : null;
    // Other entries in DOM's legacy table are not exposed by Browlet yet.
    if (constructor === null) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    const event = this.env.exec.createEvent(constructor);
    event.isTrusted = false;
    event.initialized = false;
    return event;
  }

  /** Create a traversal cursor rooted at the supplied node, even in another document. */
  // https://dom.spec.whatwg.org/#dom-document-createnodeiterator
  createNodeIterator(root: NodeImpl, whatToShow: number, filter: NodeFilterCallback | null): NodeIteratorImpl {
    return new NodeIteratorImpl(root, whatToShow, filter, this.env);
  }

  /** Create a walker whose initial position is its root, even in another document. */
  // https://dom.spec.whatwg.org/#dom-document-createtreewalker
  createTreeWalker(root: NodeImpl, whatToShow: number, filter: NodeFilterCallback | null): TreeWalkerImpl {
    return new TreeWalkerImpl(root, whatToShow, filter, this.env);
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

  // https://dom.spec.whatwg.org/#dom-document-createattributens
  createAttributeNS(namespace: string | null, qualifiedName: string): AttrImpl {
    const [namespaceURI, prefix, localName] = validateAndExtract(namespace, qualifiedName, 'attribute');
    return this.createAttributeNode(localName, '', namespaceURI, prefix);
  }

  /** Detach and adopt a non-document node, preserving the node's identity. */
  // https://dom.spec.whatwg.org/#dom-document-adoptnode
  adoptNode<T extends NodeImpl>(node: T): T {
    if (node.isDocument()) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    if (node.isShadowRoot()) throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    node.adoptInto(this);
    return node;
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

  /** Lazily bind Selectlet to this document's DOM adapter and selector exception policy. */
  getSelectorEngine(): Selectlet<NodeImpl, ElementImpl, DocumentImpl, DocumentFragmentImpl> {
    return this.#selectlet ??= createSelectlet(this, {
      env: this.env,
      errors: {
        syntax(error) {
          throw new DOMExceptionImpl(error.message, DOMExceptionNames.syntax);
        },
      },
    });
  }

  /** Convert all strings first, then assemble multiple arguments through ordinary insertion. */
  // https://dom.spec.whatwg.org/#convert-nodes-into-a-node
  convertNodesIntoNode(nodes: (NodeImpl | string)[]): NodeImpl {
    const converted = nodes.map((node) => typeof node === 'string' ? this.createTextNode(node) : node);
    if (converted.length === 1) return converted[0]!;
    const fragment = this.createDocumentFragment();
    for (const node of converted) fragment.appendChild(node);
    return fragment;
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

  /** Initialize both ancestor-origin lists during initial creation or navigation. */
  // https://html.spec.whatwg.org/multipage/dom.html#internal-ancestor-origin-objects-list-creation-steps
  // https://html.spec.whatwg.org/multipage/dom.html#ancestor-origins-list-creation-steps
  initializeAncestry(_referrerPolicy: ReferrerPolicy): void {
    // The new Document is not active yet, so getNodeNavigable() cannot select
    // its destination. An initial top-level context has no navigable yet.
    const navigable = this.browsingContext?.navigable;
    if (navigable && !navigable.isTopLevelTraversable) {
      throw new InternalError('Nested Document ancestry is not implemented');
    }
    // Store both results together. Top-level Documents have no ancestors;
    // referrer-policy masking enters with child navigables.
    this.internalAncestorOriginObjectsList = [];
    this.ancestorOriginsList = [];
  }

  /** Populate the synchronously available element tree of an about:blank document. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#populate-with-html/head/body
  populateWithHTMLHeadBody(): void {
    const html = this.createElementNode('html', HTML_NAMESPACE);
    const head = this.createElementNode('head', HTML_NAMESPACE);
    const body = this.createElementNode('body', HTML_NAMESPACE);

    this.appendChild(html);
    html.appendChild(head);
    html.appendChild(body);
  }

  /** Retarget this document's browsing context to its Window and enable execution. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#make-active
  makeActive(): void {
    const browsingContext = this.browsingContext;
    const window = this.getRelevantGlobalObject();
    if (browsingContext === null || window === null) {
      throw new InternalError('Active Document needs a browsing context and Window');
    }

    const env = window.env;
    browsingContext.windowProxy.setAssociatedWindow(env.realm.globalObject);
    env.markExecutionReady();
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

  /** Parse against this Document's base URL using UTF-8; return null on failure. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#parse-a-url
  parseHTMLURL(input: string): URLRecord | null {
    return this.env.parseURL(input, this.getBaseURL()).url;
  }

  /** Parse against this Document's base URL and encoding, including when it is detached. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-a-url
  encodingParseURL(input: string): URLRecord | null {
    return this.env.parseURL(input, this.getBaseURL(), this.encoding).url;
  }

  /** Encoding-parse and serialize a URL, preserving parse failure as null. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-and-serializing-a-url
  encodingParseAndSerializeURL(input: string): string | null {
    const url = this.encodingParseURL(input);
    return url === null ? null : serializeURL(url);
  }

  /** Read the retained first base's URL, or the fallback, without traversing the tree. */
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

  /** Change the document URL, then update consumers of its base URL. */
  // Initial construction and cloning assign URL state directly; live changes use this operation.
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#set-the-url
  setURL(url: URLRecord): void {
    this.url = url;
    this.respondToBaseURLChanges();
  }

  /** Update URL-dependent state without restarting already loaded resources. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#respond-to-base-url-changes
  respondToBaseURLChanges(): void {
    this.env.userAgent.updateURLDisplays(this);
    this.updateLinkStates();

    for (
      let descendant = this.firstChild;
      descendant !== null;
      descendant = descendant.nextShadowIncludingDescendant(this)
    ) {
      if (!HTMLScriptElementImpl.is(descendant)) continue;
      const oldResult = descendant.result;
      if (oldResult === null || oldResult === 'uninitialized') continue;
      // PROVISIONAL: speculation rules are the only prepared result type currently represented.
      // Distinguish them from classic/module scripts and import maps when those records are added.

      const newResult = this.createSpeculationRulesParseResult(descendant.getChildTextContent());
      // Use the script's relevant Window, which adoption need not change.
      descendant.getRelevantGlobalObject().updateSpeculationRules(oldResult, newResult);
    }

    this.considerSpeculativeLoads();
  }

  /** Refresh hyperlink state after URLs resolve against a different document base. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#respond-to-base-url-changes
  updateLinkStates(): void {
    // PROVISIONAL: visited-link history and the corresponding style invalidation are not implemented.
  }

  /** Create the result record for speculation rules parsed against this document's base URL. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#create-a-speculation-rules-parse-result
  createSpeculationRulesParseResult(_input: string): SpeculationRulesParseResult {
    // PROVISIONAL: initialize the record only; HTML §7.6 rule-set parsing and error capture are missing.
    return { speculationRuleSet: null, errorToRethrow: null };
  }

  /** Reconsider prefetch and prerender candidates for this document. */
  // https://html.spec.whatwg.org/multipage/speculative-loading.html#consider-speculative-loads
  considerSpeculativeLoads(): void {
    // PROVISIONAL: rule matching, candidate selection, prefetch, and prerender lifecycles are not implemented.
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
  createElementNode(
    localName: string, namespaceURI: string, prefix: string | null = null,
    isValue: string | null = null, registry: CustomElementRegistryImpl | null = this.customElementRegistry,
  ): ElementImpl {
    const elementInterface = resolveElementInterface(namespaceURI, localName);
    const element = this.#nodeFactory.constructNode<ElementImpl>(
      elementInterface.implementation,
      [{
        document: this,
        localName,
        namespaceURI,
        prefix,
        treeScopeResolver: this.#treeScopeResolver,
      }, this.env],
    );
    element.isValue = isValue;
    element.customElementRegistry = registry;
    // PROVISIONAL(custom elements): definition lookup and construction reactions remain with that subsystem.
    return element;
  }

  // https://dom.spec.whatwg.org/#dom-document-createdocumentfragment
  createDocumentFragment(): DocumentFragmentImpl {
    return this.#nodeFactory.constructNode(
      DocumentFragmentImpl,
      [this, null, this.env],
    );
  }

  /** Allocate a shadow root in this document's realm, including for an adopted host. */
  // https://dom.spec.whatwg.org/#concept-node-create
  // SPEC_CLASH(adopted-shadow-root-realm): follow DOM and Firefox; Chromium/WebKit use the host's original realm.
  createShadowRoot(host: ElementImpl, mode: ShadowRootMode): ShadowRootImpl {
    return this.#nodeFactory.constructNode(ShadowRootImpl, [host, mode, this.env]);
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

  #extractElementCreationOptions(
    options: string | ElementCreationOptionsRecord,
  ): [CustomElementRegistryImpl | null, string | null] {
    let registry = this.customElementRegistry;
    let isValue: string | null = null;
    if (typeof options !== 'string') {
      if (options.customElementRegistry !== undefined) registry = options.customElementRegistry;
      isValue = options.is ?? null;
      this.#validateRegistry(registry);
    }
    return [registry, isValue];
  }

  #validateRegistry(registry: CustomElementRegistryImpl | null): void {
    if (registry !== null && !registry.isScoped && registry !== this.customElementRegistry) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    }
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
    roAttr('implementation', reference('DOMImplementation'), xattr('SameObject')),
    roAttr('URL', idlType.USVString),
    roAttr('documentURI', idlType.USVString),
    roAttr('compatMode', idlType.DOMString),
    roAttr('characterSet', idlType.DOMString),
    roAttr('charset', idlType.DOMString),
    roAttr('inputEncoding', idlType.DOMString),
    roAttr('contentType', idlType.DOMString),
    roAttr('doctype', nullable(reference('DocumentType'))),
    roAttr('documentElement', nullable(reference('Element'))),
    op('getElementsByTagName', reference('HTMLCollection'), [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getElementsByTagNameNS', reference('HTMLCollection'), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('getElementsByClassName', reference('HTMLCollection'), [
      arg('classNames', idlType.DOMString),
    ]),
    op('createElement', reference('Element'),
      [
        arg('localName', idlType.DOMString),
        arg('options', union(idlType.DOMString, reference('ElementCreationOptions')),
          { default: emptyDictionary, optional: true },
        ),
      ],
      xattr('CEReactions', 'NewObject'),
    ),
    op('createElementNS', reference('Element'),
      [
        arg('namespace', nullable(idlType.DOMString)), arg('qualifiedName', idlType.DOMString),
        arg('options', union(idlType.DOMString, reference('ElementCreationOptions')),
          { default: emptyDictionary, optional: true },
        ),
      ],
      xattr('CEReactions', 'NewObject'),
    ),
    op('createDocumentFragment', reference('DocumentFragment'), [], xattr('NewObject')),
    op('createTextNode', reference('Text'), [arg('data', idlType.DOMString)], xattr('NewObject')),
    op('createCDATASection', reference('CDATASection'),
      [arg('data', idlType.DOMString)], xattr('NewObject'),
    ),
    op('createComment', reference('Comment'), [arg('data', idlType.DOMString)], xattr('NewObject')),
    op('createProcessingInstruction', reference('ProcessingInstruction'),
      [arg('target', idlType.DOMString), arg('data', idlType.DOMString)], xattr('NewObject'),
    ),
    op('importNode', reference('Node'),
      [
        arg('node', reference('Node')),
        arg('options', union(idlType.boolean, reference('ImportNodeOptions')), { default: false, optional: true }),
      ],
      xattr('CEReactions', 'NewObject'),
    ),
    op('adoptNode', reference('Node'), [arg('node', reference('Node'))], xattr('CEReactions')),
    op('createAttribute', reference('Attr'), [arg('localName', idlType.DOMString)], xattr('NewObject')),
    op('createAttributeNS', reference('Attr'),
      [arg('namespace', nullable(idlType.DOMString)), arg('qualifiedName', idlType.DOMString)],
      xattr('NewObject'),
    ),
    op('createEvent', reference('Event'), [arg('interface', idlType.DOMString)], xattr('NewObject')),
    op('createRange', reference('Range'), [], xattr('NewObject')),
    op('createNodeIterator', reference('NodeIterator'),
      [
        arg('root', reference('Node')),
        arg('whatToShow', idlType.unsignedLong, { default: integer(SHOW_ALL), optional: true }),
        arg('filter', nullable(reference('NodeFilter')), { default: null, optional: true }),
      ],
      xattr('NewObject'),
    ),
    op('createTreeWalker', reference('TreeWalker'),
      [
        arg('root', reference('Node')),
        arg('whatToShow', idlType.unsignedLong, { default: integer(SHOW_ALL), optional: true }),
        arg('filter', nullable(reference('NodeFilter')), { default: null, optional: true }),
      ],
      xattr('NewObject'),
    ),
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
  customElementRegistry?: CustomElementRegistryImpl | null;
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
  members: [
    dictMember('customElementRegistry', nullable(reference('CustomElementRegistry'))),
    dictMember('is', idlType.DOMString),
  ],
});

/** Converted import options; the dictionary overload copies descendants by default. */
export type ImportNodeOptions = {
  customElementRegistry?: CustomElementRegistryImpl;
  selfOnly: boolean;
};

/*
 * dictionary ImportNodeOptions {
 *   CustomElementRegistry customElementRegistry;
 *   boolean selfOnly = false;
 * };
 */
export const importNodeOptionsIDL = defineDictionary({
  name: 'ImportNodeOptions',
  members: [
    dictMember('customElementRegistry', reference('CustomElementRegistry')),
    dictMember('selfOnly', idlType.boolean, { default: false }),
  ],
});

/** XMLDocument adds a platform interface identity to Document's existing XML behavior. */
// https://dom.spec.whatwg.org/#xmldocument
export class XMLDocumentImpl extends DocumentImpl {}

/*
 * [Exposed=Window]
 * interface XMLDocument : Document {};
 */
export const xmlDocumentIDL = defineInterface({
  name: 'XMLDocument', inherits: 'Document', exposed: 'Window',
  implementation: impl(XMLDocumentImpl), members: [],
});

/*
 * Document includes ParentNode;
 */
export const documentIncludesParentNodeIDL = defineIncludes({
  interface: 'Document', mixin: parentNodeIDL.name,
});

/*
 * Document includes NonElementParentNode;
 */
export const documentIncludesNonElementParentNodeIDL = defineIncludes({
  interface: 'Document', mixin: nonElementParentNodeIDL.name,
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
