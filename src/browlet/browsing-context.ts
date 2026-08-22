import type {
  AgentCluster, AgentClusterKey, CrossOriginIsolationMode,
} from './agents';
import { obtainSimilarOriginWindowAgent } from './agents';
import { BrowletBindings } from './bindings/browlet';
import { CustomElementRegistryImpl } from './custom-element-registry';
import { setupWindowEnvironmentSettingsObject } from './environment';
import { serializeSite } from './origin';
import { createRealm, getRelevantRealm } from './realm';
import type { UserAgent } from './user-agent';
import {
  createWindowProxy, getWindowProxyWindow, setWindowProxyWindow,
} from './window-proxy';
import { WindowImpl } from './window';
import { Domlet } from '../domlet/domlet';
import {
  DocumentImpl, DocumentMode, type DocumentLoadTimingInfo,
  type DomletDocument, type PermissionsPolicy, type SandboxingFlagSet,
} from '../domlet/nodes/document';
import { HTML_NAMESPACE } from '../shared/namespaces';
import {
  createOpaqueOrigin, serializeOrigin, type Origin,
} from '../url/origin';
import { parseURL, serializeURL, type URLRecord } from '../url/url';

/*
 * A browsing context is a programmatic representation of a series of
 * documents. HTML section 7.3.2 supplies its remaining state and lifecycle.
 */
export class BrowsingContext {
  readonly windowProxy = createWindowProxy();
  readonly popupSandboxingFlagSet: SandboxingFlagSet = new Set();
  openerBrowsingContext: BrowsingContext | null = null;
  openerOriginAtCreation: Origin | null = null;
  isPopup = false;
  isAuxiliary = false;
  initialURL: URLRecord | null = null;
  virtualBrowsingContextGroupID = 0;
  #group: BrowsingContextGroup | null = null;
  get group(): BrowsingContextGroup | null {
    return this.#group;
  }

  get activeWindow(): WindowImpl | null {
    return getWindowProxyWindow(this.windowProxy);
  }

  get activeDocument(): DomletDocument | null {
    return this.activeWindow?.document ?? null;
  }

  // -- Friends ----------------------------------------------------------

  static setGroup(
    browsingContext: BrowsingContext,
    group: BrowsingContextGroup | null,
  ): void {
    browsingContext.#group = group;
  }
}

export function createNewBrowsingContextAndDocument(
  creator: DomletDocument | null,
  embedder: Element | null,
  group: BrowsingContextGroup,
): [browsingContext: BrowsingContext, document: DomletDocument] {
  const browsingContext = new BrowsingContext();
  const unsafeContextCreationTime = unsafeSharedCurrentTime();
  let creatorOrigin: Origin | null = null;
  let creatorBaseURL: URLRecord | null = null;

  if (creator !== null) {
    creatorOrigin = DocumentImpl.getOrigin(creator);
    creatorBaseURL = requireURLRecord(creator.baseURI);
    inheritCreatorVirtualBrowsingContextGroupID(browsingContext, creator);
  }

  const sandboxFlags = determineCreationSandboxingFlags(
    browsingContext,
    embedder,
  );
  const origin = determineAboutBlankOrigin(sandboxFlags, creatorOrigin);
  const permissionsPolicy = createPermissionsPolicy(embedder, origin);
  const agent = obtainSimilarOriginWindowAgent(origin, group, false);
  const window = new WindowImpl(new URL('about:blank'));
  const aboutBlankURL = requireURLRecord('about:blank');
  const realmExecutionContext = createRealm(agent, {
    createGlobalObject: () => window,
    createGlobalThisValue: () => browsingContext.windowProxy,
  });
  const topLevelCreationURL = embedder === null
    ? aboutBlankURL
    : getEmbedderTopLevelCreationURL(embedder);
  const topLevelOrigin = embedder === null
    ? origin
    : getEmbedderTopLevelOrigin(embedder);
  const settings = setupWindowEnvironmentSettingsObject(
    aboutBlankURL,
    realmExecutionContext,
    null,
    topLevelCreationURL,
    topLevelOrigin,
  );
  const loadTimingInfo = createDocumentLoadTimingInfo(coarsenTime(
    unsafeContextCreationTime,
    settings.crossOriginIsolatedCapability,
  ));
  const bindings = new BrowletBindings(realmExecutionContext.realm);
  const domlet = new Domlet(bindings.dom);
  const document = domlet.createDocument();

  DocumentImpl.setType(document, 'html');
  DocumentImpl.setContentType(document, 'text/html');
  DocumentImpl.setMode(document, DocumentMode.Quirks);
  DocumentImpl.setOrigin(document, origin);
  DocumentImpl.setBrowsingContext(document, browsingContext);
  DocumentImpl.setPermissionsPolicy(document, permissionsPolicy);
  DocumentImpl.setActiveSandboxingFlagSet(document, sandboxFlags);
  DocumentImpl.setLoadTimingInfo(document, loadTimingInfo);
  DocumentImpl.setIsInitialAboutBlank(document, true);
  DocumentImpl.setAboutBaseURL(document, creatorBaseURL);
  DocumentImpl.setAllowsDeclarativeShadowRoots(document, true);
  DocumentImpl.setCustomElementRegistry(
    document,
    new CustomElementRegistryImpl(),
  );

  const iframeReferrerPolicy = determineIframeElementReferrerPolicy(embedder);
  DocumentImpl.setInternalAncestorOriginObjectsList(
    document,
    createInternalAncestorOriginObjectsList(
      document,
      iframeReferrerPolicy,
      embedder,
    ),
  );
  DocumentImpl.setAncestorOriginsList(
    document,
    createAncestorOriginsList(document),
  );

  if (creator !== null) {
    inheritCreatorDocumentState(document, creator);
  }

  if (
    DocumentImpl.getURL(document) !== 'about:blank' ||
    serializeURL(settings.creationURL) !== 'about:blank'
  ) {
    throw new Error('Initial Document and environment must use about:blank');
  }

  WindowImpl.setAssociatedDocument(window, document);
  bindings.dom.associateEventTarget(window);
  bindings.install(window);
  DocumentImpl.markReadyForPostLoadTasks(document);
  populateWithHTMLHeadBody(document);
  makeActive(document);
  completelyFinishLoading(document);

  return [browsingContext, document];
}

export function createNewBrowsingContextGroupAndDocument(
  userAgent: UserAgent,
): [group: BrowsingContextGroup, document: DomletDocument] {
  const group = userAgent.createBrowsingContextGroup();
  const [browsingContext, document] = createNewBrowsingContextAndDocument(
    null,
    null,
    group,
  );
  group.append(browsingContext);
  return [group, document];
}

export function createNewTopLevelBrowsingContextAndDocument(
  userAgent: UserAgent,
): [browsingContext: BrowsingContext, document: DomletDocument] {
  const [group, document] = createNewBrowsingContextGroupAndDocument(userAgent);
  const [browsingContext] = group.browsingContextSet;
  if (!browsingContext) {
    throw new Error('A new browsing context group must contain its context');
  }
  return [browsingContext, document];
}

/*
 * A browsing context group owns its top-level browsing contexts and the
 * allocation state for their agent clusters.
 */
export class BrowsingContextGroup {
  readonly browsingContextSet = new Set<BrowsingContext>();
  readonly agentClusterMap = new AgentClusterMap();
  readonly historicalAgentClusterKeyMap = new HistoricalAgentClusterKeyMap();
  crossOriginIsolationMode: CrossOriginIsolationMode = 'none';
  readonly #userAgent: UserAgent | null;

  constructor(userAgent: UserAgent | null = null) {
    this.#userAgent = userAgent;
  }

  append(browsingContext: BrowsingContext): void {
    if (
      browsingContext.group !== null &&
      browsingContext.group !== this
    ) {
      throw new Error('A browsing context cannot belong to two groups');
    }

    this.browsingContextSet.add(browsingContext);
    BrowsingContext.setGroup(browsingContext, this);
  }

  remove(browsingContext: BrowsingContext): void {
    if (browsingContext.group !== this) {
      throw new Error('The browsing context is not in this group');
    }

    BrowsingContext.setGroup(browsingContext, null);
    this.browsingContextSet.delete(browsingContext);

    if (this.browsingContextSet.size === 0) {
      this.#userAgent?.removeBrowsingContextGroup(this);
    }
  }
}

class AgentClusterMap {
  /*
   * HTML defines this as a weak map. JavaScript WeakMap cannot combine weak
   * keys with value equality, so this retains clusters for the lifetime of the
   * browsing context group until Browlet implements cluster collection.
   */
  readonly #values = new Map<string | symbol, AgentCluster>();

  get(key: AgentClusterKey): AgentCluster | undefined {
    return this.#values.get(obtainAgentClusterMapKey(key));
  }

  set(key: AgentClusterKey, value: AgentCluster): void {
    this.#values.set(obtainAgentClusterMapKey(key), value);
  }
}

class HistoricalAgentClusterKeyMap {
  readonly #values = new Map<string | symbol, AgentClusterKey>();

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
  embedder: Element | null,
): SandboxingFlagSet {
  if (embedder !== null) {
    throw new Error('Embedded browsing-context sandboxing is not implemented');
  }
  return new Set(browsingContext.popupSandboxingFlagSet);
}

function inheritCreatorVirtualBrowsingContextGroupID(
  _browsingContext: BrowsingContext,
  _creator: DomletDocument,
): void {
  // HTML obtains this from creator's top-level browsing context. Nested and
  // auxiliary browsing-context relationships enter with child navigables.
  throw new Error('Creator browsing-context inheritance is not implemented');
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
  embedder: Element | null,
  _origin: Origin,
): PermissionsPolicy {
  if (embedder !== null) {
    throw new Error('Embedded permissions-policy creation is not implemented');
  }
  return {};
}

function getEmbedderTopLevelCreationURL(_embedder: Element): URLRecord {
  throw new Error('Embedder environment inheritance is not implemented');
}

function getEmbedderTopLevelOrigin(_embedder: Element): Origin {
  throw new Error('Embedder environment inheritance is not implemented');
}

function determineIframeElementReferrerPolicy(
  embedder: Element | null,
): string {
  if (embedder !== null) {
    throw new Error('iframe referrer-policy lookup is not implemented');
  }
  return '';
}

function createInternalAncestorOriginObjectsList(
  _document: DomletDocument,
  _referrerPolicy: string,
  embedder: Element | null,
): readonly Origin[] {
  if (embedder !== null) {
    throw new Error('Nested Document ancestry is not implemented');
  }
  return [];
}

function createAncestorOriginsList(
  document: DomletDocument,
): readonly string[] {
  const origins = DocumentImpl.getInternalAncestorOriginObjectsList(document);
  if (origins === null) {
    throw new Error('Document has no internal ancestor origin objects list');
  }
  return origins.map(serializeOrigin);
}

function inheritCreatorDocumentState(
  _document: DomletDocument,
  _creator: DomletDocument,
): void {
  throw new Error('Creator Document inheritance is not implemented');
}

function populateWithHTMLHeadBody(document: DomletDocument): void {
  const html = DocumentImpl.createElementNode(
    document,
    'html',
    HTML_NAMESPACE,
  );
  const head = DocumentImpl.createElementNode(
    document,
    'head',
    HTML_NAMESPACE,
  );
  const body = DocumentImpl.createElementNode(
    document,
    'body',
    HTML_NAMESPACE,
  );

  document.appendChild(html);
  html.appendChild(head);
  html.appendChild(body);
}

function makeActive(
  document: DomletDocument,
): void {
  const realm = getRelevantRealm(document);
  const window = realm.globalObject;
  if (!(window instanceof WindowImpl)) {
    throw new Error('Document relevant global object is not a Window');
  }
  const browsingContext = DocumentImpl.getBrowsingContext(document);
  if (!(browsingContext instanceof BrowsingContext)) {
    throw new Error('Document has no Browlet browsing context');
  }

  setWindowProxyWindow(browsingContext.windowProxy, window);
  const settings = realm.hostDefined;
  if (settings === null) throw new Error('Window has no environment settings');
  settings.markExecutionReady();
}

function completelyFinishLoading(document: DomletDocument): void {
  if (DocumentImpl.getBrowsingContext(document) === null) {
    throw new Error('A completely loaded Document needs a browsing context');
  }
  DocumentImpl.setCompletelyLoadedTime(document, Date.now());

  // A newly-created top-level Document has no container, so the remaining
  // iframe/container load-event steps have no effect.
}

function createDocumentLoadTimingInfo(
  navigationStartTime: DOMHighResTimeStamp,
): DocumentLoadTimingInfo {
  return {
    navigationStartTime,
    domInteractiveTime: 0,
    domContentLoadedEventStartTime: 0,
    domContentLoadedEventEndTime: 0,
    domCompleteTime: 0,
    loadEventStartTime: 0,
    loadEventEndTime: 0,
  };
}

function unsafeSharedCurrentTime(): DOMHighResTimeStamp {
  return performance.now();
}

function coarsenTime(
  timestamp: DOMHighResTimeStamp,
  _crossOriginIsolatedCapability: boolean,
): DOMHighResTimeStamp {
  // TODO(High Resolution Time): Apply implementation-defined resolution and
  // jitter when Browlet owns a monotonic clock for its agent clusters.
  return timestamp;
}

function requireURLRecord(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new Error(`Could not parse ${input}`);
  return url;
}
