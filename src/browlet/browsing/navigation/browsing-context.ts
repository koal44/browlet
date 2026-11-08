import { InternalError } from '../../../infra/index';
import { unsafeSharedCurrentTime } from '../../../timing/index';
import {
  aboutBlankURL, serializeSite, copyURL, createOpaqueOrigin, serializeOrigin, serializeURL,
  areSameOrigin, isOrigin, obtainSite, obtainURLOrigin, type Origin, type URLRecord,
} from '../../../url/index';

import {
  AgentCluster, WindowAgent, type AgentClusterKey, type CrossOriginIsolationMode,
} from '../../scripting/index';
import { OpenerPolicy, PermissionsPolicy, SandboxingFlagSet, InsecureRequestsPolicy } from '../policy/index';
import { DocumentMode, type DocumentImpl, type ElementImpl } from '../../dom/nodes/index';
import { HTMLIFrameElementImpl } from '../../dom/nodes/html/embedded/index';
import { CustomElementRegistryImpl } from '../../dom/nodes/html/custom-elements/index';
import type { WindowProxyHandle, WindowImpl } from '../window/index';
import type { UserAgent } from '../../user-agent';

import type { Navigable } from './navigable';
import type { TopLevelTraversable } from './top-level-traversable';
import type { NavigationParams, OpenerPolicyEnforcementResult } from './params';

/** Retains a WindowProxy and the sequence of documents presented through it. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#browsing-context
export class BrowsingContext {
  /** Next identity allocated for report-only opener-policy group switches. */
  static #nextVirtualGroupID = 0;

  /** Document made active in this context; null until initial activation. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#active-document
  activeDocument: DocumentImpl | null = null;
  /** Sandbox restrictions inherited when this context was opened as a popup. */
  popupSandboxingFlagSet = new SandboxingFlagSet();
  /** Browsing context that opened this one, if it retains an opener. */
  openerBrowsingContext: BrowsingContext | null = null;
  /** Opener's origin captured at context creation. */
  openerOriginAtCreation: Origin | null = null;
  /** Creator allowed to navigate an auxiliary context despite its sandboxed-navigation restriction. */
  // https://html.spec.whatwg.org/multipage/browsers.html#one-permitted-sandboxed-navigator
  // Target selection records the creator independently of the mutable opener; sandbox permission consumes it.
  onePermittedSandboxedNavigator: BrowsingContext | null = null;
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

  /** Stable WindowProxy, connected during context construction. */
  #windowProxy: WindowProxyHandle | undefined;

  /** Navigable presenting this context's document sequence. */
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
    embedder: HTMLIFrameElementImpl | null,
    group: BrowsingContextGroup,
  ): [browsingContext: BrowsingContext, document: DocumentImpl] {
    const browsingContext = new BrowsingContext();
    if (embedder !== null) browsingContext.inheritInsecureRequestsPolicy(embedder);
    const unsafeContextCreationTime = unsafeSharedCurrentTime();
    const creatorOrigin = creator?.origin ?? null;
    const creatorBaseURL = creator?.getBaseURL() ?? null;
    const creatorCookieURL = creator?.cookieURL ?? null;
    const parentDocument = embedder?.nodeDocument ?? null;
    const creatorTop = creator?.browsingContext?.topLevelBrowsingContext ?? null;

    if (creator !== null) {
      if (creatorTop === null) throw new InternalError('A creator needs a fully active top-level browsing context');
      browsingContext.virtualBrowsingContextGroupID = creatorTop.virtualBrowsingContextGroupID;
    }

    const sandboxFlags = browsingContext.determineCreationSandboxingFlags(embedder);
    const origin = BrowsingContext.determineOrigin(aboutBlankURL, sandboxFlags, creatorOrigin);
    const permissionsPolicy = PermissionsPolicy.create(embedder, origin);
    const agent = group.obtainSimilarOriginWindowAgent(origin, false);
    const creationURL = copyURL(aboutBlankURL);
    const topLevelCreationURL = embedder !== null ? embedder.env.topLevelCreationURL
      : creator !== null ? creator.env.topLevelCreationURL : creationURL;
    const topLevelOrigin = embedder !== null ? embedder.env.topLevelOrigin : origin;
    if (topLevelCreationURL === null || topLevelOrigin === null) {
      throw new InternalError('Browsing-context creation requires initialized Window environment settings');
    }
    const env = group.userAgent.createWindowEnvironment({
      agent, userAgent: group.userAgent,
      creationURL,
      origin,
      parent: parentDocument?.getRelevantGlobalObject() ?? null,
      topLevelCreationURL,
      topLevelOrigin,
    });
    const { window, realm } = env;
    browsingContext.initializeWindowProxy(realm.windowProxy);
    const document = env.createDocument();

    document.type = 'html';
    document.contentType = 'text/html';
    document.mode = DocumentMode.Quirks;
    document.origin = origin;
    document.browsingContext = browsingContext;
    document.permissionsPolicyState = permissionsPolicy;
    document.setActiveSandboxingFlagSet(sandboxFlags);
    document.initializeLoadTimingInfo(
      unsafeContextCreationTime.coarsen(env.crossOriginIsolatedCapability).milliseconds,
    );
    // SPEC_CLASH(initial-blank-navigation-timing): Follow HTML/WebKit and leave the timing entry unset.
    // This creation path does not run §7.5.1; Chromium/Firefox expose an entry here.
    // https://github.com/w3c/navigation-timing/issues/155
    document.isInitialAboutBlank = true;
    document.aboutBaseURL = creatorBaseURL;
    // SPEC_CLASH(document-cookie-averse): initial blank documents inherit the creator's cookie lookup URL.
    // https://github.com/whatwg/html/issues/332
    document.cookieURL = copyURL(creatorCookieURL ?? creationURL);
    document.allowDeclarativeShadowRoots = true;
    document.customElementRegistry = new CustomElementRegistryImpl();

    document.initializeAncestry(HTMLIFrameElementImpl.determineReferrerPolicy(embedder), parentDocument);

    if (creator !== null) {
      // SPEC_CLASH(initial-blank-referrer): Follow HTML/Chromium's full URL, including fragments and despite no-referrer.
      // Firefox's initial Documents and WebKit popups expose ""; WebKit iframes strip fragments.
      document.referrer = serializeURL(creator.url);
      document.policyContainer = creator.policyContainer.clone();
      const creatorTopOrigin = creator.env.topLevelOrigin;
      if (creatorTopOrigin !== null && areSameOrigin(creator.origin, creatorTopOrigin)) {
        const topDocument = creatorTop!.activeDocument;
        if (topDocument === null) throw new InternalError('Opener-policy inheritance requires an active top-level Document');
        document.openerPolicy = topDocument.openerPolicy;
      }
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
  static createAuxiliary(
    opener: BrowsingContext,
  ): [browsingContext: BrowsingContext, document: DocumentImpl] {
    const openerTop = opener.topLevelTraversable.activeBrowsingContext;
    const group = openerTop?.group;
    const creator = opener.activeDocument;
    if (openerTop === null || group === undefined || group === null || creator === null) {
      throw new InternalError('Auxiliary creation requires an active opener and top-level browsing-context group');
    }
    const [browsingContext, document] = BrowsingContext.create(creator, null, group);
    browsingContext.isAuxiliary = true;
    group.append(browsingContext);
    browsingContext.openerBrowsingContext = opener;
    browsingContext.virtualBrowsingContextGroupID = openerTop.virtualBrowsingContextGroupID;
    browsingContext.openerOriginAtCreation = creator.origin;
    return [browsingContext, document];
  }

  /** Reuse or replace the destination's browsing context for a navigation response. */
  // https://html.spec.whatwg.org/multipage/browsers.html#obtain-browsing-context-navigation
  // The destination remains explicit; NavigationParams does not retain its Navigable.
  static obtainForNavigation(navigable: Navigable, params: NavigationParams): BrowsingContext {
    const browsingContext = navigable.activeBrowsingContext;
    if (browsingContext === null) throw new InternalError('Navigation requires an active browsing context');
    if (navigable.parent !== null) return browsingContext;
    const result = params.coopEnforcementResult!;
    // Optional cross-site and singleton-group swaps are not used.
    if (!result.needsBrowsingContextGroupSwitch) {
      if (result.wouldNeedBrowsingContextGroupSwitchDueToReportOnly) browsingContext.resetVirtualBrowsingContextGroupID();
      return browsingContext;
    }
    const [newBrowsingContext] = BrowsingContext.createTopLevel(browsingContext.activeWindow.env.userAgent);
    if (params.openerPolicy.value === 'same-origin-plus-COEP') {
      // Logical isolation keys agents without granting capabilities that require physical isolation.
      newBrowsingContext.group!.crossOriginIsolationMode = 'logical';
    }
    if (params.finalSandboxingFlagSet.size > 0) {
      if (params.openerPolicy.value !== 'unsafe-none') {
        throw new InternalError('A sandboxed group switch requires an unsafe-none opener policy');
      }
      newBrowsingContext.popupSandboxingFlagSet = new SandboxingFlagSet(params.finalSandboxingFlagSet);
    }
    // Document creation needs the destination before history activation makes it the active context.
    newBrowsingContext.setNavigable(navigable);
    params.reservedEnv!.targetBrowsingContext = newBrowsingContext;
    return newBrowsingContext;
  }

  /** Select a new Document's origin, retaining the source identity for inherited URLs. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#determining-the-origin
  // SPEC_CLASH(origin-null-url-input): Follow the explicit null-URL step despite the URL-only signature.
  static determineOrigin(url: URLRecord | null, sandboxFlags: SandboxingFlagSet, sourceOrigin: Origin | null): Origin {
    if (sandboxFlags.has('sandboxed-origin') || url === null) return createOpaqueOrigin();
    if (url.scheme === 'about' && url.host === null && url.username === '' && url.password === '') {
      if (url.path === 'srcdoc' && url.query === null) {
        if (sourceOrigin === null) throw new InternalError('Srcdoc origin determination requires a source origin');
        return sourceOrigin;
      }
      if (url.path === 'blank' && sourceOrigin !== null) return sourceOrigin;
    }
    return obtainURLOrigin(url);
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
  // https://html.spec.whatwg.org/multipage/document-sequences.html#active-window
  get activeWindow(): WindowImpl {
    return this.windowProxy.windowImplementation;
  }

  /** Whether the active Document is presented by a traversable navigable. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#top-level-browsing-context
  get isTopLevel(): boolean {
    return this.activeDocument?.getNodeNavigable()?.isTraversable() ?? false;
  }

  /** Top-level traversable presenting the active Document; requires a live node navigable. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#bc-traversable
  get topLevelTraversable(): TopLevelTraversable {
    const navigable = this.activeDocument?.getNodeNavigable();
    if (!navigable) throw new InternalError('Browsing context needs an active Document with a node navigable');
    return navigable.topLevelTraversable;
  }

  /** Top-level browsing context, or null when this context has no fully active Document. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#bc-tlbc
  get topLevelBrowsingContext(): BrowsingContext | null {
    const document = this.activeDocument;
    if (document === null || !document.isFullyActive()) return null;
    return this.topLevelTraversable.activeBrowsingContext;
  }

  /** Whether this context is a strict ancestor of the fully active descendant. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#ancestor-browsing-context
  isAncestorOf(descendant: BrowsingContext): boolean {
    // SPEC_CLASH(browsing-context-ancestor-direction): Follow the steps; HTML's opening sentence reverses ancestor and descendant.
    const document = descendant.activeDocument;
    if (document === null || !document.isFullyActive()) return false;
    return document.getAncestorNavigables().some((ancestor) => ancestor.activeBrowsingContext === this);
  }

  /** Compare active origins and live ancestry, following the target's auxiliary opener chain. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#familiar-with
  isFamiliarWith(other: BrowsingContext): boolean {
    return this.#checkFamiliarity(other, Infinity);
  }

  /** Check named-target familiarity using only the target and its immediate auxiliary opener. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#find-a-navigable-by-target-name
  isFamiliarForNamedLookup(other: BrowsingContext): boolean {
    // SPEC_CLASH(familiarity-opener-depth): Match browsers' one-opener lookup boundary, not HTML's recursive familiarity.
    // Gecko documents this limit in https://github.com/whatwg/html/issues/313#issuecomment-453648260.
    // Window.close() needs its own audit before adopting this lookup-specific restriction.
    return this.#checkFamiliarity(other, 1);
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
  determineCreationSandboxingFlags(embedder: HTMLIFrameElementImpl | null): SandboxingFlagSet {
    if (embedder === null) return new SandboxingFlagSet(this.popupSandboxingFlagSet);
    return new SandboxingFlagSet([...embedder.sandboxingFlagSet, ...embedder.nodeDocument.activeSandboxingFlagSet]);
  }

  /** Assign a fresh identity when a report-only policy would split this group. */
  resetVirtualBrowsingContextGroupID(): void {
    this.virtualBrowsingContextGroupID = ++BrowsingContext.#nextVirtualGroupID;
  }

  /** Carry enforced and report-only isolation decisions across response redirects. */
  // https://html.spec.whatwg.org/multipage/browsers.html#coop-enforce
  enforceResponseOpenerPolicy(
    responseURL: URLRecord, responseOrigin: Origin, responseCOOP: OpenerPolicy,
    current: OpenerPolicyEnforcementResult, referrer: URLRecord | null | undefined,
  ): OpenerPolicyEnforcementResult {
    const result: OpenerPolicyEnforcementResult = {
      needsBrowsingContextGroupSwitch: current.needsBrowsingContextGroupSwitch,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: current.wouldNeedBrowsingContextGroupSwitchDueToReportOnly,
      url: responseURL,
      origin: responseOrigin,
      openerPolicy: responseCOOP,
      currentContextIsNavigationSource: true,
    };
    const document = this.activeDocument;
    if (document === null) throw new InternalError('COOP enforcement requires an active Document');
    const isInitialAboutBlank = document.isInitialAboutBlank;
    if (isInitialAboutBlank && this.initialURL === null) this.initialURL = responseURL;
    const group = this.group;
    if (group === null) throw new InternalError('COOP enforcement requires a browsing context group');
    const reportSwitch = (disposition: 'enforce' | 'reporting'): void => {
      if (group.browsingContextSet.size <= 1) return;
      responseCOOP.queueNavigationToReport(
        disposition, responseURL, current.url, current.origin, responseOrigin, referrer,
      );
      current.openerPolicy.queueNavigationFromReport(
        disposition, current.url, responseURL, current.origin, responseOrigin, current.currentContextIsNavigationSource,
      );
    };
    if (OpenerPolicy.requiresGroupSwitch(
      isInitialAboutBlank, responseOrigin, current.origin, responseCOOP.value, current.openerPolicy.value,
    )) {
      result.needsBrowsingContextGroupSwitch = true;
      reportSwitch('enforce');
    }
    if (OpenerPolicy.reportOnlyRequiresGroupSwitch(
      isInitialAboutBlank, responseOrigin, current.origin, responseCOOP, current.openerPolicy,
    )) {
      result.wouldNeedBrowsingContextGroupSwitchDueToReportOnly = true;
      reportSwitch('reporting');
    }
    return result;
  }

  /** Apply the requested window position and size features. */
  // https://drafts.csswg.org/cssom-view-1/#set-up-browsing-context-features
  setUpFeatures(_tokenizedFeatures: ReadonlyMap<string, string>): void {
    // TODO(CSSOM View): Parse positioning/sizing and integrate the user agent's screen/window geometry.
    throw new InternalError('Browsing-context feature setup is not implemented');
  }

  /** Associate the navigation owner, rejecting a different existing owner. */
  setNavigable(navigable: Navigable): void {
    const existing = this.#navigable;
    if (existing !== null && existing !== navigable) {
      throw new InternalError('A browsing context cannot belong to two navigables');
    }
    this.#navigable = navigable;
  }

  /** Apply the shared origin and ancestry conditions within the caller's opener limit. */
  #checkFamiliarity(other: BrowsingContext, openerLimit: number): boolean {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Familiarity requires an active source Document');
    const top = this.topLevelBrowsingContext;
    const visited = new Set<BrowsingContext>();
    // SPEC_GAP(familiarity-opener-termination): Null or cyclic openers end the walk; all tested browsers reject an unrelated cycle.
    for (let target: BrowsingContext | null = other; target !== null && !visited.has(target);
      target = target.isAuxiliary ? target.openerBrowsingContext : null) {
      visited.add(target);
      const targetDocument = target.activeDocument;
      if (targetDocument === null) throw new InternalError('Familiarity requires an active target Document');
      // SPEC_CLASH(familiarity-distant-target): Keep HTML's direct origin match; WebKit's lookup also limits the opener relationship.
      // SPEC_CLASH(familiarity-document-domain): Follow HTML's strict origin check; Chromium's lookup allows domain relaxation.
      if (areSameOrigin(document.origin, targetDocument.origin)) return true;
      if (target === top) return true;
      if (targetDocument.isFullyActive()) {
        for (const ancestor of targetDocument.getAncestorNavigables()) {
          if (areSameOrigin(document.origin, ancestor.activeDocument!.origin)) return true;
        }
      }
      if (openerLimit === 0) break;
      openerLimit--;
    }
    return false;
  }
}

/** Groups related top-level browsing contexts and their agent-cluster allocation state. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#browsing-context-group
export class BrowsingContextGroup {
  /** Top-level contexts currently belonging to this group. */
  browsingContextSet = new Set<BrowsingContext>();
  /** Weakly held agent clusters selected by site or origin keys. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#agent-cluster-map
  agentClusterMap = new AgentClusterMap();
  /** First cluster-key decision retained for each origin, even after cluster collection. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#historical-agent-cluster-key-map
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

  /** Reuse or allocate the Window agent selected by this group's origin/site policy. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#obtain-a-similar-origin-window-agent
  obtainSimilarOriginWindowAgent(origin: Origin, requestsOAC: boolean): WindowAgent {
    const site = obtainSite(origin);
    let key: AgentClusterKey = site;

    if (this.crossOriginIsolationMode !== 'none') {
      key = origin;
    } else if (this.historicalAgentClusterKeyMap.has(origin)) {
      key = this.historicalAgentClusterKeyMap.get(origin)!;
    } else {
      if (requestsOAC) {
        key = origin;
      }

      this.historicalAgentClusterKeyMap.set(origin, key);
    }

    let agentCluster = this.agentClusterMap.get(key);

    if (agentCluster === undefined) {
      agentCluster = new AgentCluster(this.crossOriginIsolationMode);

      if (isOrigin(key)) {
        if (!areSameOrigin(key, origin)) {
          throw new InternalError('An origin agent cluster key must be the given origin');
        }

        agentCluster.isOriginKeyed = true;
      }

      agentCluster.add(this.userAgent.createWindowAgent());
      this.agentClusterMap.set(key, agentCluster);
    }

    const [windowAgent, ...additionalWindowAgents] = [...agentCluster.agents]
      .filter((agent) => agent instanceof WindowAgent);

    if (windowAgent === undefined || additionalWindowAgents.length > 0) {
      throw new InternalError('An agent cluster must contain one Window agent');
    }

    return windowAgent;
  }

  /** Register a top-level context and establish its reciprocal group association. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#bcg-append
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

  /** Unregister a context, releasing an empty group from its user agent. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#bcg-remove
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
  /** Value-comparable keys do not keep otherwise unreachable clusters alive. */
  #values = new Map<string, WeakRef<AgentCluster>>();

  static #getKey(key: AgentClusterKey): string {
    if (Array.isArray(key)) return `site:${serializeSite(key)}`;
    if (key.kind === 'opaque') return `opaque:${key.identity}`;
    return `origin:${serializeOrigin(key)}`;
  }

  get(key: AgentClusterKey): AgentCluster | undefined {
    const mapKey = AgentClusterMap.#getKey(key);
    const value = this.#values.get(mapKey)?.deref();
    if (value === undefined) this.#values.delete(mapKey);
    return value;
  }

  set(key: AgentClusterKey, value: AgentCluster): void {
    const mapKey = AgentClusterMap.#getKey(key);
    // A collected entry no longer occupies its old position in the ordered map.
    if (this.#values.get(mapKey)?.deref() === undefined) this.#values.delete(mapKey);
    this.#values.set(mapKey, new WeakRef(value));
  }

  *values(): IterableIterator<AgentCluster> {
    for (const [key, reference] of this.#values) {
      const value = reference.deref();
      if (value === undefined) this.#values.delete(key);
      else yield value;
    }
  }
}

/** Remembers each origin's initial cluster key using origin value equality. */
class HistoricalAgentClusterKeyMap {
  /** Origin decisions remain available for the entire group's lifetime. */
  #values = new Map<string, AgentClusterKey>();

  static #getKey(origin: Origin): string {
    return origin.kind === 'opaque'
      ? `opaque:${origin.identity}`
      : `origin:${serializeOrigin(origin)}`;
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
