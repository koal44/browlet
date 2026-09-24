import {
  type AgentCluster, type AgentClusterKey, type CrossOriginIsolationMode,
  obtainSimilarOriginWindowAgent,
} from '../scripting/agents';
import {
  createDocument, getRelevantRealm, retargetWindowProxy,
} from '../bindings';
import { CustomElementRegistryImpl } from '../html/custom-elements/registry';
import { createWindowEnvironment } from '../bindings';
import {
  serializeSite, createOpaqueOrigin, serializeOrigin, type Origin, parseURL, serializeURL,
  type URLRecord,
} from '../../url/index';
import type { UserAgent } from '../user-agent';
import type { Navigable } from './navigable';
import {
  getWindowProxyWindow,
  type WindowProxy,
} from './window/window-proxy';
import type { WindowImpl } from './window/window';
import { DocumentMode, type DocumentImpl } from '../dom/nodes/document';
import type { ElementImpl } from '../dom/nodes/element';
import type { PermissionsPolicy } from './policy/permissions';
import type { SandboxingFlagSet } from './policy/sandbox';
import type { ReferrerPolicy } from '../../fetch/index';
import { InsecureRequestsPolicy } from './policy/upgrade-insecure-requests';
import { HTML_NAMESPACE } from '../../infra/index';
import { unsafeSharedCurrentTime } from '../performance/high-resolution-time';
import { InternalError } from '../../infra/internal-error';

/*
 * A browsing context is a programmatic representation of a series of
 * documents. HTML section 7.3.2 supplies its remaining state and lifecycle.
 */
export class BrowsingContext {
  #windowProxy: WindowProxy | undefined;
  popupSandboxingFlagSet: SandboxingFlagSet = new Set();
  openerBrowsingContext: BrowsingContext | null = null;
  openerOriginAtCreation: Origin | null = null;
  isPopup = false;
  isAuxiliary = false;
  initialURL: URLRecord | null = null;
  virtualBrowsingContextGroupID = 0;
  /** Upgrade policy inherited from the embedding document when this context was created. */
  insecureRequestsPolicy = new InsecureRequestsPolicy();
  #group: BrowsingContextGroup | null = null;

  /*
   * A navigable can present a series of browsing contexts. This inverse link
   * lets Document activity follow the existing Document -> browsing context
   * relationship without maintaining a second per-Document activity index.
   */
  #navigable: Navigable | null = null;

  constructor(windowProxy?: WindowProxy) {
    this.#windowProxy = windowProxy;
  }

  get windowProxy(): WindowProxy {
    if (!this.#windowProxy) throw new InternalError('Browsing context has no WindowProxy yet');
    return this.#windowProxy;
  }

  get group(): BrowsingContextGroup | null {
    return this.#group;
  }

  get navigable(): Navigable | null {
    return this.#navigable;
  }

  /** Current Window; throws until the WindowProxy has been connected. */
  get activeWindow(): WindowImpl {
    const window = getWindowProxyWindow(this.windowProxy);
    if (window === null) throw new InternalError('Browsing context has no active Window');
    return window;
  }

  /** Document associated with the current Window. */
  get activeDocument(): DocumentImpl {
    return this.activeWindow.getAssociatedDocument();
  }

  initializeWindowProxy(proxy: WindowProxy): void {
    if (this.#windowProxy) throw new InternalError('Browsing context already has a WindowProxy');
    this.#windowProxy = proxy;
  }

  /** Copy the embedding document's upgrade policy when creating this nested context. */
  // https://w3c.github.io/webappsec-upgrade-insecure-requests/#nesting
  inheritInsecureRequestsPolicy(embedder: ElementImpl): void {
    // Adoption changes the node document without changing the element's realm.
    const policy = embedder.getNodeDocument()!.env.insecureRequestsPolicy;
    if (policy.upgrade) this.insecureRequestsPolicy = policy.clone();
  }

  setGroup(group: BrowsingContextGroup | null): void {
    this.#group = group;
  }

  setNavigable(navigable: Navigable): void {
    const existing = this.#navigable;
    if (existing !== null && existing !== navigable) {
      throw new InternalError('A browsing context cannot belong to two navigables');
    }
    this.#navigable = navigable;
  }
}

export function createNewBrowsingContextAndDocument(
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
  const permissionsPolicy = createPermissionsPolicy(embedder, origin);
  const agent = obtainSimilarOriginWindowAgent(origin, group, false);
  const aboutBlankURL = requireURLRecord('about:blank');
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
    parent: embedder?.getNodeDocument()?.getRelevantGlobalObject() ?? null,
    topLevelCreationURL,
    topLevelOrigin,
  });
  const { window, realm } = env;
  browsingContext.initializeWindowProxy(
    realm.globalThis as WindowProxy,
  );
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

export function createNewBrowsingContextGroupAndDocument(
  userAgent: UserAgent,
): [group: BrowsingContextGroup, document: DocumentImpl] {
  const group = userAgent.createBrowsingContextGroup();
  const [browsingContext, document] =
    createNewBrowsingContextAndDocument(
      null, null, group
    );
  group.append(browsingContext);
  return [group, document];
}

export function createNewTopLevelBrowsingContextAndDocument(
  userAgent: UserAgent,
): [browsingContext: BrowsingContext, document: DocumentImpl] {
  const [group, document] = createNewBrowsingContextGroupAndDocument(userAgent);
  const [browsingContext] = group.browsingContextSet;
  if (!browsingContext) {
    throw new InternalError('A new browsing context group must contain its context');
  }
  return [browsingContext, document];
}

/*
 * A browsing context group owns its top-level browsing contexts and the
 * allocation state for their agent clusters.
 */
export class BrowsingContextGroup {
  browsingContextSet = new Set<BrowsingContext>();
  agentClusterMap = new AgentClusterMap();
  historicalAgentClusterKeyMap = new HistoricalAgentClusterKeyMap();
  crossOriginIsolationMode: CrossOriginIsolationMode = 'none';

  constructor(public userAgent: UserAgent) {}

  append(browsingContext: BrowsingContext): void {
    if (
      browsingContext.group !== null &&
      browsingContext.group !== this
    ) {
      throw new InternalError('A browsing context cannot belong to two groups');
    }

    this.browsingContextSet.add(browsingContext);
    browsingContext.setGroup(this);
  }

  remove(browsingContext: BrowsingContext): void {
    if (browsingContext.group !== this) {
      throw new InternalError('The browsing context is not in this group');
    }

    browsingContext.setGroup(null);
    this.browsingContextSet.delete(browsingContext);

    if (this.browsingContextSet.size === 0) {
      this.userAgent.removeBrowsingContextGroup(this);
    }
  }
}

class AgentClusterMap {
  /*
   * HTML defines this as a weak map. JavaScript WeakMap cannot combine weak
   * keys with value equality, so this retains clusters for the lifetime of the
   * browsing context group until Browlet implements cluster collection.
   */
  #values = new Map<string | symbol, AgentCluster>();

  get(key: AgentClusterKey): AgentCluster | undefined {
    return this.#values.get(obtainAgentClusterMapKey(key));
  }

  set(key: AgentClusterKey, value: AgentCluster): void {
    this.#values.set(obtainAgentClusterMapKey(key), value);
  }

  values(): MapIterator<AgentCluster> {
    return this.#values.values();
  }
}

class HistoricalAgentClusterKeyMap {
  #values = new Map<string | symbol, AgentClusterKey>();

  get(origin: Origin): AgentClusterKey | undefined {
    return this.#values.get(obtainOriginMapKey(origin));
  }

  has(origin: Origin): boolean {
    return this.#values.has(obtainOriginMapKey(origin));
  }

  set(origin: Origin, key: AgentClusterKey): void {
    this.#values.set(obtainOriginMapKey(origin), key);
  }
}

function obtainAgentClusterMapKey(key: AgentClusterKey): string | symbol {
  if (Array.isArray(key)) return `site:${serializeSite(key)}`;
  if (key.kind === 'opaque') return key.identity;
  return `origin:${serializeOrigin(key)}`;
}

function obtainOriginMapKey(origin: Origin): string | symbol {
  return origin.kind === 'opaque'
    ? origin.identity
    : serializeOrigin(origin);
}

function determineCreationSandboxingFlags(
  browsingContext: BrowsingContext,
  embedder: ElementImpl | null,
): SandboxingFlagSet {
  if (embedder !== null) {
    throw new InternalError('Embedded browsing-context sandboxing is not implemented');
  }
  return new Set(browsingContext.popupSandboxingFlagSet);
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

function createPermissionsPolicy(
  embedder: ElementImpl | null,
  _origin: Origin,
): PermissionsPolicy {
  if (embedder !== null) {
    throw new InternalError('Embedded permissions-policy creation is not implemented');
  }
  return {};
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

function populateWithHTMLHeadBody(document: DocumentImpl): void {
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

  retargetWindowProxy(browsingContext.windowProxy, window);
  const env = realm.env;
  env.markExecutionReady();
}

function requireURLRecord(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new InternalError(`Could not parse ${input}`);
  return url;
}
