import { InternalError } from '../../../infra/internal-error';
import {
  aboutBlankURL, serializeSite, copyURL, createOpaqueOrigin, serializeOrigin, type Origin, serializeURL,
  type URLRecord,
} from '../../../url/index';

import { unsafeSharedCurrentTime } from '../../timing/index';
import {
  type AgentCluster, type AgentClusterKey, type CrossOriginIsolationMode, obtainSimilarOriginWindowAgent,
} from '../../scripting/index';
import { PermissionsPolicy, SandboxingFlagSet, InsecureRequestsPolicy } from '../policy/index';
import { DocumentMode, type DocumentImpl, type ElementImpl } from '../../dom/nodes/index';
import { CustomElementRegistryImpl } from '../../dom/nodes/html/custom-elements/index';
import type { WindowProxyHandle, WindowImpl } from '../window/index';
import type { UserAgent } from '../../user-agent';

import type { Navigable } from './navigable';

/** Retains a WindowProxy and the sequence of documents presented through it. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#browsing-context
export class BrowsingContext {
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

  #windowProxy: WindowProxyHandle | undefined;

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
    const creatorOrigin = creator?.origin ?? null;
    const creatorBaseURL = creator?.getBaseURL() ?? null;
    const creatorCookieURL = creator?.cookieURL ?? null;
    const parentDocument = embedder?.nodeDocument ?? null;

    if (creator !== null) {
      // https://html.spec.whatwg.org/multipage/document-sequences.html#creator-browsing-context
      // TODO: inherit the creator's top-level virtual browsing context group ID. The
      // creator's Document state must also be inherited below before enabling this path.
      throw new InternalError('Creator browsing-context inheritance is not implemented');
    }

    const sandboxFlags = browsingContext.determineCreationSandboxingFlags(embedder);
    // https://html.spec.whatwg.org/multipage/document-sequences.html#about-blank-origin
    const origin = sandboxFlags.has('sandboxed-origin') || creatorOrigin === null
      ? createOpaqueOrigin()
      : creatorOrigin;
    const permissionsPolicy = PermissionsPolicy.create(embedder, origin);
    const agent = obtainSimilarOriginWindowAgent(origin, group, false);
    const creationURL = copyURL(aboutBlankURL);
    if (embedder !== null) {
      // TODO: inherit top-level creation URL and origin from embedder.env and
      // select the iframe referrer policy for ancestry initialization below.
      throw new InternalError('Embedder environment inheritance is not implemented');
    }
    const env = group.userAgent.createWindowEnvironment({
      agent, userAgent: group.userAgent,
      creationURL,
      origin,
      parent: null,
      topLevelCreationURL: creationURL,
      topLevelOrigin: origin,
    });
    const { window, realm } = env;
    browsingContext.initializeWindowProxy(realm.windowProxy);
    const document = env.exec.createDocument();

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
    // SPEC_CLASH(document-cookie-averse): initial blank documents inherit the creator's cookie lookup URL.
    // https://github.com/whatwg/html/issues/332
    document.cookieURL = copyURL(creatorCookieURL ?? creationURL);
    document.allowDeclarativeShadowRoots = true;
    document.customElementRegistry = new CustomElementRegistryImpl();

    // https://html.spec.whatwg.org/multipage/browsers.html#determining-the-iframe-element-referrer-policy
    // There is no embedding iframe for the supported top-level creation path.
    document.initializeAncestry('', parentDocument);

    // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-browsing-context
    // TODO: for a non-null creator, set the referrer from its URL, clone its policy
    // container, and inherit its top-level opener policy when origins match.

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
    document.populateWithHTMLHeadBody();
    document.makeActive();
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

  /** Navigation owner; once assigned, the association cannot switch owners. */
  get navigable(): Navigable | null {
    return this.#navigable;
  }

  /** Current Window; throws until the WindowProxy has been connected. */
  get activeWindow(): WindowImpl {
    return this.windowProxy.windowImplementation;
  }

  /** Document associated with the current Window. */
  get activeDocument(): DocumentImpl {
    return this.activeWindow.getAssociatedDocument();
  }

  /** Attach the stable proxy exactly once during context construction. */
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

  /** Select the sandbox flags applied when this context's initial Document is created. */
  // https://html.spec.whatwg.org/multipage/browsers.html#determining-the-creation-sandboxing-flags
  determineCreationSandboxingFlags(embedder: ElementImpl | null): SandboxingFlagSet {
    if (embedder !== null) {
      // TODO: combine the iframe's flags with its node document's active flags.
      throw new InternalError('Embedded browsing-context sandboxing is not implemented');
    }
    return new SandboxingFlagSet(this.popupSandboxingFlagSet);
  }

  /** Associate the navigation owner, rejecting a different existing owner. */
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

  static #getKey(key: AgentClusterKey): string | symbol {
    if (Array.isArray(key)) return `site:${serializeSite(key)}`;
    if (key.kind === 'opaque') return key.identity;
    return `origin:${serializeOrigin(key)}`;
  }

  get(key: AgentClusterKey): AgentCluster | undefined {
    return this.#values.get(AgentClusterMap.#getKey(key));
  }

  set(key: AgentClusterKey, value: AgentCluster): void {
    this.#values.set(AgentClusterMap.#getKey(key), value);
  }

  values(): MapIterator<AgentCluster> {
    return this.#values.values();
  }
}

/** Remembers each origin's initial cluster key using origin value equality. */
class HistoricalAgentClusterKeyMap {
  #values = new Map<string | symbol, AgentClusterKey>();

  static #getKey(origin: Origin): string | symbol {
    return origin.kind === 'opaque'
      ? origin.identity
      : serializeOrigin(origin);
  }

  get(origin: Origin): AgentClusterKey | undefined {
    return this.#values.get(HistoricalAgentClusterKeyMap.#getKey(origin));
  }

  has(origin: Origin): boolean {
    return this.#values.has(HistoricalAgentClusterKeyMap.#getKey(origin));
  }

  set(origin: Origin, key: AgentClusterKey): void {
    this.#values.set(HistoricalAgentClusterKeyMap.#getKey(origin), key);
  }
}
