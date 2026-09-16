import type { TreeScope } from '../../../stylelet/engine/tree-scope';
import type {
  PromiseValue, PromiseValueCapability, RuntimeContext,
} from '../../../js-engine/index';
import {
  defaultRuntimeCaps as defaultStyleletRuntimeCaps, Stylelet,
  type RuntimeCaps as StyleletRuntimeCaps,
} from '../../../stylelet/stylelet';
import type { HTMLCollectionImpl } from './collections';
import { createStyleletRuntime, type TreeScopeResolver } from '../../style/integration';
import type { CSSStyleSheetImpl } from '../../../stylelet/cssom/css-stylesheet';
import type { StyleSheetListImpl } from '../../../stylelet/cssom/stylesheet-list';
import type { EventTargetImpl } from '../events/event-target';
import type { EventImpl } from '../events/event';
import { asDocument } from '../../stubs';
import { isValidAttributeLocalName } from '../infra/name-validation';
import type { BrowsingContext } from '../../browsing/browsing-context';
import type { Navigable } from '../../browsing/navigable';
import type { WindowImpl } from '../../browsing/window/window';
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
import { createOpaqueOrigin, type Origin } from '../../../url/origin';
import { parseURL, serializeURL, type URLRecord } from '../../../url/url';
import { AttrImpl } from './attribute';
import { CommentImpl } from './comment';
import { DocumentFragmentImpl } from './document-fragment';
import { DocumentTypeImpl } from './document-type';
import {
  isHTMLElement, isHTMLHeadElement, type ElementImpl,
} from './element';
import {
  HTML_NAMESPACE, type MATHML_NAMESPACE, type SVG_NAMESPACE,
} from '../../../infra/index';
import {
  isDocument, isDocumentType, isElement, NodeImpl, type NodeVirtuals, NodeType,
} from './node';
import {
  DocumentOrShadowRootMixin, documentOrShadowRootIDL,
} from './document-or-shadow-root';
import { ParentNodeMixin, parentNodeIDL } from './parent-node';
import { TextImpl } from './text';
import {
  findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';
import { resolveElementInterface } from '../../element-interfaces';

export function createDocument(
  options: DocumentConstructionOptions = {},
): DocumentImpl {
  const nodeFactory = options.nodeFactory ?? directDOMNodeFactory;
  return nodeFactory.constructNode(DocumentImpl, [nodeFactory, options.styleletRuntime]);
}

export type DocumentConstructionOptions = {
  readonly nodeFactory?: DOMNodeFactory;
  readonly styleletRuntime?: StyleletRuntimeCaps;
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
  #aboutBaseURL: URLRecord | null = null;
  readonly #activeSandboxingFlagSet = createSandboxingFlagSet();
  #allowDeclarativeShadowRoots = false;
  #ancestorOriginsList: readonly string[] | null = null;
  #browsingContext: BrowsingContext | null = null;
  #relevantGlobalObject: WindowImpl | null = null;
  #completelyLoadedTime: number | null = null;
  #contentType = 'application/xml';
  #currentDocumentReadiness: DocumentReadyState = 'complete';
  #customElementRegistry: CustomElementRegistryImpl | null = null;
  #duringLoadingNavigationID: string | null = null;
  #encoding = 'UTF-8';
  readonly #fullyActiveObservers = new Set<FullyActiveStateObserver>();
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
  #openerPolicy = createOpenerPolicy();
  #origin: Origin = createOpaqueOrigin();
  #permissionsPolicy = createPermissionsPolicy();
  #policyContainer = createPolicyContainer();
  #type: DocumentType = 'xml';
  #url = parseDocumentURL('about:blank');
  #wasCreatedViaCrossOriginRedirects = false;
  #readyForPostLoadTasks = false;
  #referrer = '';
  #stylelet: Stylelet | undefined;
  readonly styleletRuntime: StyleletRuntimeCaps;
  readonly #documentOrShadowRootMixin: DocumentOrShadowRootMixin;
  readonly #parentNodeMixin: ParentNodeMixin;
  readonly #treeScopeResolver: TreeScopeResolver;

  // HTML: a Document's script-blocking style sheet set is an ordered set.
  readonly #scriptBlockingStyleSheets = new Set<ElementImpl>();
  #scriptBlockingStyleSheetsReady: PromiseValueCapability<void> | null = null;
  readonly #nodeFactory: DOMNodeFactory;
  #writer: DocumentWriter | undefined;

  static readonly #eventTargetVirtuals = NodeImpl.createEventTargetVirtuals({
    getParent: (target, event) => NodeImpl.is(target) && isDocument(target)
      ? target.getEventParent(event)
      : null,
  });

  static readonly #nodeVirtuals: NodeVirtuals = {
    getBaseURI: (node) => isDocument(node)
      ? node.URL
      : 'about:blank',
  };

  constructor(
    nodeFactory: DOMNodeFactory = directDOMNodeFactory,
    styleletRuntime: StyleletRuntimeCaps = defaultStyleletRuntimeCaps,
  ) {
    super(
      NodeType.Document,
      null,
      {
        eventTargetVirtuals: DocumentImpl.#eventTargetVirtuals,
        virtuals: DocumentImpl.#nodeVirtuals,
      },
    );
    this.setNodeDocument(this);
    this.#nodeFactory = nodeFactory;
    this.styleletRuntime = styleletRuntime;
    this.#treeScopeResolver = new DocumentTreeScopeResolver(this);
    this.#documentOrShadowRootMixin = new DocumentOrShadowRootMixin({
      getCustomElementRegistry: () => this.#customElementRegistry,
      getStyleScope: () => this.getCSSEngine().documentScope,
    });
    this.#parentNodeMixin = new ParentNodeMixin(this);
  }

  get URL(): string {
    return serializeURL(this.#url);
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

  get type(): DocumentType {
    return this.#type;
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

  get customElementRegistry(): CustomElementRegistryImpl | null {
    return this.#documentOrShadowRootMixin.customElementRegistry;
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

  get head(): (ElementImpl & HTMLHeadElement) | null {
    const html = this.documentElement;
    if (!html || !isHTMLElement(html) || html.localName !== 'html') {
      return null;
    }

    for (let child = html.firstChild; child; child = child.nextSibling) {
      if (isElement(child) && isHTMLHeadElement(child)) return child;
    }

    return null;
  }

  get body(): (ElementImpl & HTMLElement) | null {
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
    if (this.#type === 'html') localName = asciiLower(localName);
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
    if (this.#type === 'html') localName = asciiLower(localName);
    return this.createAttributeNode(localName, '', null, null);
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

  // -- Internal ---------------------------------------------------------

  setURL(url: URLRecord): void {
    this.#url = url;
  }

  setContentType(contentType: string): void {
    this.#contentType = contentType;
  }

  getBrowsingContext(): BrowsingContext | null {
    return this.#browsingContext;
  }

  setBrowsingContext(browsingContext: BrowsingContext | null): void {
    this.#browsingContext = browsingContext;
  }

  /*
   * Return the navigable whose active Document is this one. Inactive
   * Documents intentionally have no node navigable, even while session
   * history retains them for possible later reactivation.
   */
  getNodeNavigable(): Navigable | null {
    const navigable = this.#browsingContext?.navigable;
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

  getMode(): DocumentMode {
    return this.#mode;
  }

  setMode(mode: DocumentMode): void {
    this.#mode = mode;
  }

  setType(type: DocumentType): void {
    this.#type = type;
  }

  getOrigin(): Origin {
    return this.#origin;
  }

  setOrigin(origin: Origin): void {
    this.#origin = origin;
  }

  getModuleMap(): ModuleMap {
    return this.#moduleMap;
  }

  getPolicyContainer(): PolicyContainer {
    return this.#policyContainer;
  }

  setPolicyContainer(policyContainer: PolicyContainer): void {
    this.#policyContainer = policyContainer;
  }

  getPermissionsPolicy(): PermissionsPolicy {
    return this.#permissionsPolicy;
  }

  setPermissionsPolicy(permissionsPolicy: PermissionsPolicy): void {
    this.#permissionsPolicy = permissionsPolicy;
  }

  getActiveSandboxingFlagSet(): SandboxingFlagSet {
    return this.#activeSandboxingFlagSet;
  }

  setActiveSandboxingFlagSet(sandboxingFlagSet: ReadonlySet<SandboxingFlag>): void {
    this.#activeSandboxingFlagSet.clear();
    for (const flag of sandboxingFlagSet) {
      this.#activeSandboxingFlagSet.add(flag);
    }
  }

  getOpenerPolicy(): OpenerPolicy {
    return this.#openerPolicy;
  }

  setOpenerPolicy(openerPolicy: OpenerPolicy): void {
    this.#openerPolicy = openerPolicy;
  }

  getLoadTimingInfo(): DocumentLoadTimingInfo {
    return this.#loadTimingInfo;
  }

  setLoadTimingInfo(loadTimingInfo: DocumentLoadTimingInfo): void {
    this.#loadTimingInfo = loadTimingInfo;
  }

  isInitialAboutBlank(): boolean {
    return this.#isInitialAboutBlank;
  }

  setIsInitialAboutBlank(isInitialAboutBlank: boolean): void {
    this.#isInitialAboutBlank = isInitialAboutBlank;
  }

  getAboutBaseURL(): URLRecord | null {
    return this.#aboutBaseURL;
  }

  setAboutBaseURL(aboutBaseURL: URLRecord | null): void {
    this.#aboutBaseURL = aboutBaseURL;
  }

  allowsDeclarativeShadowRoots(): boolean {
    return this.#allowDeclarativeShadowRoots;
  }

  setAllowsDeclarativeShadowRoots(allow: boolean): void {
    this.#allowDeclarativeShadowRoots = allow;
  }

  setCustomElementRegistry(registry: CustomElementRegistryImpl): void {
    this.#customElementRegistry = registry;
  }

  getInternalAncestorOriginObjectsList(): readonly Origin[] | null {
    return this.#internalAncestorOriginObjectsList;
  }

  setInternalAncestorOriginObjectsList(origins: readonly Origin[]): void {
    this.#internalAncestorOriginObjectsList = origins;
  }

  getAncestorOriginsList(): readonly string[] | null {
    return this.#ancestorOriginsList;
  }

  setAncestorOriginsList(origins: readonly string[]): void {
    this.#ancestorOriginsList = origins;
  }

  isReadyForPostLoadTasks(): boolean {
    return this.#readyForPostLoadTasks;
  }

  markReadyForPostLoadTasks(): void {
    this.#readyForPostLoadTasks = true;
  }

  setCurrentDocumentReadiness(readiness: DocumentReadyState): void {
    this.#currentDocumentReadiness = readiness;
  }

  setReferrer(referrer: string): void {
    this.#referrer = referrer;
  }

  wasCreatedViaCrossOriginRedirects(): boolean {
    return this.#wasCreatedViaCrossOriginRedirects;
  }

  setWasCreatedViaCrossOriginRedirects(value: boolean): void {
    this.#wasCreatedViaCrossOriginRedirects = value;
  }

  getDuringLoadingNavigationID(): string | null {
    return this.#duringLoadingNavigationID;
  }

  setDuringLoadingNavigationID(id: string | null): void {
    this.#duringLoadingNavigationID = id;
  }

  getCompletelyLoadedTime(): number | null {
    return this.#completelyLoadedTime;
  }

  setCompletelyLoadedTime(time: number): void {
    this.#completelyLoadedTime = time;
  }

  override getEventParent(event: EventImpl): EventTargetImpl | null {
    if (event.type === 'load' || this.#browsingContext === null) {
      return null;
    }

    if (this.#relevantGlobalObject === null) {
      throw new Error(
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
      throw new Error('A Document cannot change its relevant global object');
    }
    this.#relevantGlobalObject = window;
  }

  getRelevantGlobalObject(): WindowImpl | null {
    return this.#relevantGlobalObject;
  }

  getCSSEngine(): Stylelet {
    return this.#stylelet ??= new Stylelet(asDocument(this), {
      runtime: this.styleletRuntime,
    });
  }

  getTreeScopeResolver(): TreeScopeResolver {
    return this.#treeScopeResolver;
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

  waitForScriptBlockingStyleSheets(runtime: RuntimeContext): PromiseValue<void> {
    return runtime.promises.try(() => {
      if (this.#scriptBlockingStyleSheets.size === 0) return;
      const ready = this.#scriptBlockingStyleSheetsReady ??=
        runtime.promises.withResolvers<void>();
      return ready.promise.then(() =>
        this.waitForScriptBlockingStyleSheets(runtime),
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
          argumentsList: readonly unknown[],
        ): T {
          return ctx.construct(implClass, ...argumentsList);
        },
      })),
      atArg(1, (ctx) => createStyleletRuntime(ctx.getRuntime())),
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
  readonly #document: DocumentImpl;

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
    argumentsList: readonly unknown[],
  ): T;
};

export const directDOMNodeFactory: DOMNodeFactory = {
  constructNode<T extends object>(
    implementation: abstract new (...argumentsList: never[]) => T,
    argumentsList: readonly unknown[],
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

export type ModuleMapKey = readonly [URLRecord, string];

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
  if (url === null) throw new Error(`Could not parse document URL ${input}`);
  return url;
}
