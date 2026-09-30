import {
  type AgentCluster, type AgentClusterKey, type CrossOriginIsolationMode,
  obtainSimilarOriginWindowAgent,
} from '../scripting/agents';
import { createDocument, createWindowEnvironment, getRelevantRealm, setAssociatedWindow } from '../bindings';
import { CustomElementRegistryImpl } from '../html/custom-elements/registry';
import {
  serializeSite, createOpaqueOrigin, serializeOrigin, type Origin, parseURL, serializeURL,
  type URLRecord,
} from '../../url/index';
import type { UserAgent } from '../user-agent';
import type { Navigable } from './navigable';
import type { WindowProxyHandle } from './window/window-proxy';
import type { WindowImpl } from './window/window';
import { DocumentMode, type DocumentImpl } from '../dom/nodes/document';
import type { ElementImpl } from '../dom/nodes/element';
import { PermissionsPolicy } from './policy/permissions';
import { SandboxingFlagSet } from './policy/sandbox';
import type { ReferrerPolicy } from '../../fetch/index';
import { InsecureRequestsPolicy } from './policy/upgrade-insecure-requests';
import { HTML_NAMESPACE } from '../../infra/index';
import { unsafeSharedCurrentTime } from '../performance/high-resolution-time';
import { InternalError } from '../../infra/internal-error';

/** Retains a WindowProxy and the sequence of documents presented through it. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#browsing-context
export class BrowsingContext {
  #windowProxy: WindowProxyHandle | undefined;
  /** Sandbox restrictions inherited when this context was opened as a popup. */
  popupSandboxingFlagSet = new SandboxingFlagSet();
  /** Browsing context that opened this one, if it retains an opener. */
  openerBrowsingContext: BrowsingContext | null = null;
  /** Opener's origin captured at context creation. */
  openerOriginAtCreation: Origin | null = null;
  /** Whether this context was created as a popup. */
  isPopup = false;
  /** Whether this is an auxiliary context opened by another context. */
  isAuxiliary = false;
  /** URL recorded when navigation first initialized this context. */
  initialURL: URLRecord | null = null;
  /** Virtual group identity used when evaluating opener-policy relationships. */
  virtualBrowsingContextGroupID = 0;
  /** Upgrade policy inherited from the embedding document when this context was created. */
  insecureRequestsPolicy = new InsecureRequestsPolicy();
  /** Group whose membership is maintained by append() and remove(). */
  group: BrowsingContextGroup | null = null;

  // A navigable can present a series of browsing contexts. This inverse link
  // lets Document activity follow the existing Document -> browsing context
  // relationship without maintaining a second per-Document activity index.
  #navigable: Navigable | null = null;

  constructor(windowProxy?: WindowProxyHandle) {
    this.#windowProxy = windowProxy;
  }

  /** Create a context and its initial about:blank document within an existing group. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-browsing-context
  static create(
    creator: DocumentImpl | null,
    embedder: ElementImpl | null,
    group: BrowsingContextGroup,
  ): [browsingContext: BrowsingContext, document: DocumentImpl] {
    const browsingContext = new BrowsingContext();
    if (embedder !== null) browsingContext.inheritInsecureRequestsPolicy(embedder);
    const unsafeContextCreationTime = unsafeSharedCurrentTime();
    let creatorOrigin: Origin | null = null;
    let creatorBaseURL: URLRecord | null = null;

    if (creator !== null) {
      creatorOrigin = creator.origin;
      creatorBaseURL = creator.getBaseURL();
      inheritCreatorVirtualBrowsingContextGroupID(browsingContext, creator);
    }

    const sandboxFlags = determineCreationSandboxingFlags(
      browsingContext,
      embedder,
    );
    const origin = determineAboutBlankOrigin(sandboxFlags, creatorOrigin);
    const permissionsPolicy = PermissionsPolicy.create(embedder, origin);
    const agent = obtainSimilarOriginWindowAgent(origin, group, false);
    const aboutBlankURL = parseURL('about:blank').url;
    if (aboutBlankURL === null) throw new InternalError('Could not parse about:blank');
    const topLevelCreationURL = embedder === null
      ? aboutBlankURL
      : getEmbedderTopLevelCreationURL(embedder);
    const topLevelOrigin = embedder === null
      ? origin
      : getEmbedderTopLevelOrigin(embedder);
    const env = createWindowEnvironment({
      agent, userAgent: group.userAgent,
      creationURL: aboutBlankURL,
      origin,
      parent: embedder?.nodeDocument.getRelevantGlobalObject() ?? null,
      topLevelCreationURL,
      topLevelOrigin,
    });
    const { window, realm } = env;
    browsingContext.initializeWindowProxy(realm.windowProxy);
    const document = createDocument(realm);

    document.type = 'html';
    document.contentType = 'text/html';
    document.mode = DocumentMode.Quirks;
    document.origin = origin;
    document.browsingContext = browsingContext;
    document.permissionsPolicy = permissionsPolicy;
    document.setActiveSandboxingFlagSet(sandboxFlags);
    document.initializeLoadTimingInfo(
      unsafeContextCreationTime.coarsen(env.crossOriginIsolatedCapability).milliseconds,
    );
    document.isInitialAboutBlank = true;
    document.aboutBaseURL = creatorBaseURL;
    document.allowDeclarativeShadowRoots = true;
    document.customElementRegistry = new CustomElementRegistryImpl();

    const iframeReferrerPolicy = determineIframeElementReferrerPolicy(embedder);
    document.internalAncestorOriginObjectsList =
      createInternalAncestorOriginObjectsList(document, iframeReferrerPolicy, embedder);
    document.ancestorOriginsList = createAncestorOriginsList(document);

    if (creator !== null) {
      inheritCreatorDocumentState(document, creator);
    }

    if (
      document.URL !== 'about:blank' ||
      serializeURL(env.creationURL) !== 'about:blank'
    ) {
      throw new InternalError('Initial Document and environment must use about:blank');
    }

    window.setAssociatedDocument(document);
    document.initializeInsecureRequestsPolicy();
    document.initializeCSP();
    document.readyForPostLoadTasks = true;
    populateWithHTMLHeadBody(document);
    makeActive(document);
    document.completelyFinishLoading();

    return [browsingContext, document];
  }

  /** Create a top-level context and its initial document in a new group. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-top-level-browsing-context
  static createTopLevel(
    userAgent: UserAgent,
  ): [browsingContext: BrowsingContext, document: DocumentImpl] {
    const [group, document] = BrowsingContextGroup.create(userAgent);
    const [browsingContext] = group.browsingContextSet;
    if (!browsingContext) {
      throw new InternalError('A new browsing context group must contain its context');
    }
    return [browsingContext, document];
  }

  /** Create an opener-associated browsing context and its initial document. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-auxiliary-browsing-context
  // TODO: Implement opener and group inheritance as part of auxiliary browsing-context support.
  static createAuxiliary(
    _opener: BrowsingContext,
  ): [browsingContext: BrowsingContext, document: DocumentImpl] {
    throw new InternalError('Auxiliary browsing-context creation is not implemented');
  }

  get windowProxy(): WindowProxyHandle {
    if (!this.#windowProxy) throw new InternalError('Browsing context has no WindowProxy yet');
    return this.#windowProxy;
  }

  get navigable(): Navigable | null {
    return this.#navigable;
  }

  /** Current Window; throws until the WindowProxy has been connected. */
  get activeWindow(): WindowImpl {
    return this.windowProxy.associatedWindow.implementation;
  }

  /** Document associated with the current Window. */
  get activeDocument(): DocumentImpl {
    return this.activeWindow.getAssociatedDocument();
  }

  initializeWindowProxy(proxy: WindowProxyHandle): void {
    if (this.#windowProxy) throw new InternalError('Browsing context already has a WindowProxy');
    this.#windowProxy = proxy;
  }

  /** Copy the embedding document's upgrade policy when creating this nested context. */
  // https://w3c.github.io/webappsec-upgrade-insecure-requests/#nesting
  inheritInsecureRequestsPolicy(embedder: ElementImpl): void {
    // Adoption changes the node document without changing the element's realm.
    const policy = embedder.nodeDocument.env.insecureRequestsPolicy;
    if (policy.upgrade) this.insecureRequestsPolicy = policy.clone();
  }

  setNavigable(navigable: Navigable): void {
    const existing = this.#navigable;
    if (existing !== null && existing !== navigable) {
      throw new InternalError('A browsing context cannot belong to two navigables');
    }
    this.#navigable = navigable;
  }
}

/** Groups related top-level browsing contexts and their agent-cluster allocation state. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#browsing-context-group
export class BrowsingContextGroup {
  /** Top-level contexts currently belonging to this group. */
  browsingContextSet = new Set<BrowsingContext>();
  /** Agent clusters selected by site or origin keys. */
  agentClusterMap = new AgentClusterMap();
  /** First cluster-key decision retained for each origin. */
  historicalAgentClusterKeyMap = new HistoricalAgentClusterKeyMap();
  /** Isolation mode shared by clusters created in this group. */
  crossOriginIsolationMode: CrossOriginIsolationMode = 'none';

  constructor(public userAgent: UserAgent) {}

  /** Create a group with its initial browsing context and about:blank document. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-browsing-context-group
  static create(
    userAgent: UserAgent,
  ): [group: BrowsingContextGroup, document: DocumentImpl] {
    const group = userAgent.createBrowsingContextGroup();
    const [browsingContext, document] = BrowsingContext.create(null, null, group);
    group.append(browsingContext);
    return [group, document];
  }

  append(browsingContext: BrowsingContext): void {
    if (
      browsingContext.group !== null &&
      browsingContext.group !== this
    ) {
      throw new InternalError('A browsing context cannot belong to two groups');
    }

    this.browsingContextSet.add(browsingContext);
    browsingContext.group = this;
  }

  remove(browsingContext: BrowsingContext): void {
    if (browsingContext.group !== this) {
      throw new InternalError('The browsing context is not in this group');
    }

    browsingContext.group = null;
    this.browsingContextSet.delete(browsingContext);

    if (this.browsingContextSet.size === 0) {
      this.userAgent.removeBrowsingContextGroup(this);
    }
  }
}

/** Indexes clusters by origin or site value rather than record identity. */
class AgentClusterMap {
  // HTML defines this as a weak map. JavaScript WeakMap cannot combine weak
  // keys with value equality, so this retains clusters for the lifetime of the
  // browsing context group until Browlet implements cluster collection.
  #values = new Map<string | symbol, AgentCluster>();

  get(key: AgentClusterKey): AgentCluster | undefined {
    return this.#values.get(AgentClusterMap.#getKey(key));
  }

  set(key: AgentClusterKey, value: AgentCluster): void {
    this.#values.set(AgentClusterMap.#getKey(key), value);
  }

  values(): MapIterator<AgentCluster> {
    return this.#values.values();
  }

  static #getKey(key: AgentClusterKey): string | symbol {
    if (Array.isArray(key)) return `site:${serializeSite(key)}`;
    if (key.kind === 'opaque') return key.identity;
    return `origin:${serializeOrigin(key)}`;
  }
}

/** Remembers each origin's initial cluster key using origin value equality. */
class HistoricalAgentClusterKeyMap {
  #values = new Map<string | symbol, AgentClusterKey>();

  get(origin: Origin): AgentClusterKey | undefined {
    return this.#values.get(HistoricalAgentClusterKeyMap.#getKey(origin));
  }

  has(origin: Origin): boolean {
    return this.#values.has(HistoricalAgentClusterKeyMap.#getKey(origin));
  }

  set(origin: Origin, key: AgentClusterKey): void {
    this.#values.set(HistoricalAgentClusterKeyMap.#getKey(origin), key);
  }

  static #getKey(origin: Origin): string | symbol {
    return origin.kind === 'opaque'
      ? origin.identity
      : serializeOrigin(origin);
  }
}

function determineCreationSandboxingFlags(
  browsingContext: BrowsingContext,
  embedder: ElementImpl | null,
): SandboxingFlagSet {
  if (embedder !== null) {
    throw new InternalError('Embedded browsing-context sandboxing is not implemented');
  }
  return new SandboxingFlagSet(browsingContext.popupSandboxingFlagSet);
}

function inheritCreatorVirtualBrowsingContextGroupID(
  _browsingContext: BrowsingContext,
  _creator: DocumentImpl,
): void {
  // HTML obtains this from creator's top-level browsing context. Nested and
  // auxiliary browsing-context relationships enter with child navigables.
  throw new InternalError('Creator browsing-context inheritance is not implemented');
}

function determineAboutBlankOrigin(
  sandboxFlags: SandboxingFlagSet,
  creatorOrigin: Origin | null,
): Origin {
  if (sandboxFlags.has('sandboxed-origin') || creatorOrigin === null) {
    return createOpaqueOrigin();
  }
  return creatorOrigin;
}

function getEmbedderTopLevelCreationURL(_embedder: ElementImpl): URLRecord {
  throw new InternalError('Embedder environment inheritance is not implemented');
}

function getEmbedderTopLevelOrigin(_embedder: ElementImpl): Origin {
  throw new InternalError('Embedder environment inheritance is not implemented');
}

function determineIframeElementReferrerPolicy(
  embedder: ElementImpl | null,
): ReferrerPolicy {
  if (embedder !== null) {
    throw new InternalError('iframe referrer-policy lookup is not implemented');
  }
  return '';
}

function createInternalAncestorOriginObjectsList(
  _document: DocumentImpl,
  _referrerPolicy: ReferrerPolicy,
  embedder: ElementImpl | null,
): Origin[] {
  if (embedder !== null) {
    throw new InternalError('Nested Document ancestry is not implemented');
  }
  return [];
}

function createAncestorOriginsList(
  document: DocumentImpl,
): string[] {
  const origins = document.internalAncestorOriginObjectsList;
  if (origins === null) {
    throw new InternalError('Document has no internal ancestor origin objects list');
  }
  return origins.map(serializeOrigin);
}

function inheritCreatorDocumentState(
  _document: DocumentImpl,
  _creator: DocumentImpl,
): void {
  throw new InternalError('Creator Document inheritance is not implemented');
}

/** Populate the synchronously available element tree of an about:blank document. */
export function populateWithHTMLHeadBody(document: DocumentImpl): void {
  const html = document.createElementNode('html', HTML_NAMESPACE);
  const head = document.createElementNode('head', HTML_NAMESPACE);
  const body = document.createElementNode('body', HTML_NAMESPACE);

  document.appendChild(html);
  html.appendChild(head);
  html.appendChild(body);
}

function makeActive(
  document: DocumentImpl,
): void {
  const realm = getRelevantRealm(document);
  const window = realm.windowImplementation;
  const browsingContext = document.browsingContext;
  if (browsingContext === null) {
    throw new InternalError('Document has no browsing context');
  }

  setAssociatedWindow(browsingContext.windowProxy, window);
  const env = realm.env;
  env.markExecutionReady();
}
