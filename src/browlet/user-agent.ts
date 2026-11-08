import { InternalError, internalType, WeakOrderedSet, type InternalPromise, type TimerHost, type Public } from '../infra/index';
import { NodePromise, randomUUID } from '../js-engine/index';
import { unsafeSharedCurrentTime } from '../timing/index';
import type { SelectletUserAgent } from '../selectlet/index';
import {
  areSameOrigin, type Origin, type TupleOrigin, obtainURLOrigin, parseURL, serializeOrigin,
  type BlobURLEntry as URLBlobURLEntry, type URLRecord, type URLUserAgent,
} from '../url/index';
import {
  PermissionStore, type PermissionDescriptor, type PermissionState, type PermissionUserAgent, type PermissionEnvironment,
  type PermissionChoiceRequest, type PermissionSelection,
} from '../permissions/index';
import { CookieStore } from '../http/index';
import {
  StoragePersistence, StorageShed, PersistentStoragePermission, type StorageEnvironmentBase, type StorageUserAgent,
} from '../storage/index';
import type { MIMEType, MIMETypeEssence } from '../mime/index';
import type { BlobImpl } from '../file/index';
import {
  ConnectionPool, HTTPCacheStore, CORSPreflightCache, fetch, FetchRequest,
  isFilteredResponse, isOkStatus, parseReferrerPolicyFromHeader,
  type FetchEnvironment, type FetchController, type FetchResponse, type FetchUserAgent, type HTTPTransport,
  type Destination, type RequestInternalPriority, type ServiceWorkerTimingInfo,
} from '../fetch/index';
import { PercentageLiteral, createSystemColorPalette, type StyleletUserAgent } from '../stylelet/index';

import type { CORSSettingsState } from './dom/nodes/html/attributes/index';
import {
  type Agent, AgentCluster, DedicatedWorkerAgent, EventLoop, ServiceWorkerAgent,
  SharedWorkerAgent, WindowAgent, WorkletAgent, ScriptingPolicy,
} from './scripting/index';
import { type ReportingEndpoint, ReportImpl } from './reporting/index';
import { SystemClipboard, clipboardWritePermission } from './interaction/clipboard/index';
import { CSPList } from './browsing/policy/csp/index';
import { PolicyContainer, HSTSStore, EmbedderPolicy, type SandboxingFlagSet } from './browsing/policy/index';
import type { IntersectionObserverMargin } from './dom/intersection-observer/index';
import type { DocumentImpl, ElementImpl } from './dom/nodes/index';
import type { PerformanceNavigationTimingImpl, PerformanceTimingConfidenceValue } from './performance/index';
import { ProtocolHandlerRegistry, type NavigatorImpl, type WorkerNavigatorImpl } from './navigator/index';
import type { BroadcastChannelImpl } from './communication/index';
import type { StorageImpl } from './storage/index';
import type { SourceSnapshotParams } from './browsing/navigation/state/index';
import type { WindowImpl } from './browsing/window/index';
import type { BrowletEnvironment, BrowletEnvironmentBase, WindowEnvironment } from './environment/index';
import { WebDriver, type PageEvaluation } from './automation/index';
import { HTTPAuthenticationStore, type ResourceReader } from './loader/index';
import {
  BrowsingContextGroup, Navigable, TopLevelTraversable, type NavigableContainer, type PostResource,
  type Traversable, type UnloadCancellationResult, type UserNavigationInvolvement,
} from './browsing/navigation/index';
import { ActivePointers, KeyboardInputProcessor, MouseInputProcessor, PointerLock } from './interaction/index';
import { NodeHTTPTransport, createContentDecoder, supportedContentCodings } from './integration/host/network/index';
import { queueNodeTask, nodeTimerHost } from './integration/host/index';
import type { PermissionStatusImpl } from './integration/permissions/index';
import { BlobURLEntry, BlobURLStore } from './integration/file/index';
import { WorkerThread } from './integration/workers/index';
import { browletDOM } from './integration/index';
import { createSandboxEnvironment, createWindowEnvironment } from './integration/web-idl/index';

/** Owns browsing contexts and shared browser services that outlive individual documents. */
class BrowletUserAgent implements
  FetchUserAgent, StorageUserAgent, PermissionUserAgent, URLUserAgent, StyleletUserAgent, SelectletUserAgent {
  /** WebDriver BiDi command implementation; separate from Browlet's convenience API. */
  webDriver: WebDriver = new WebDriver(this);
  /** Local clients notified of document replacement; not WebDriver session state. */
  pageEvaluations = new WeakMap<Navigable, Set<PageEvaluation>>();
  /** Implementation access shared by selector and style engines. */
  dom = browletDOM;
  /** Configurable CSS system colors, independent of the machine running Browlet. */
  systemColors = createSystemColorPalette();
  /** Related-context groups currently retained by this browser. */
  browsingContextGroupSet = new Set<BrowsingContextGroup>();
  /** Top-level windows or tabs owned by this browser. */
  topLevelTraversableSet = new Set<TopLevelTraversable>();
  /** Reject new-window requests without transient activation, independently of sandbox restrictions. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#popup-blocker
  popupBlockerEnabled = true;
  /** Destination policy after popup and sandbox checks; existing named targets are unaffected. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#the-rules-for-choosing-a-navigable
  newNavigablePolicy: 'new' | 'current' | 'none' = 'new';
  /** Configured document handling by MIME essence; XML/JSON entries count as explicitly supported types. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#loading-a-document
  documentTypeHandlers = new Map<MIMETypeEssence, 'inline' | 'external'>();
  /** Whether a PDF viewer is available; configure before creating Windows. Browlet currently has no viewer. */
  // https://html.spec.whatwg.org/multipage/system-state.html#pdf-viewer-supported
  // TODO: A PDF host must supply inline viewing; live support changes also need an explicit Window-list refresh policy.
  pdfViewerSupported = false;
  /** Discover live broadcast channels in creation order without retaining their globals. */
  broadcastChannels = new WeakOrderedSet<BroadcastChannelImpl>();
  /** Browser binding factory used by browsing algorithms to create Window environments. */
  createWindowEnvironment = createWindowEnvironment;
  /** Start dedicated execution through the browser's configured isolate backend. */
  runWorker = WorkerThread.run;
  /** Browser-owned continuations, including Fetch and protocol commands, outlive individual environments. */
  HostPromise = NodePromise;
  /** Background steps remain distinct from task delivery to a global. */
  runInParallel = queueNodeTask;
  /** Host wake-ups shared by this browser's globals; each global owns its timer state. */
  timerHost: TimerHost = nodeTimerHost;
  /** Shared input lifetimes and button state, independent of author-created events. */
  activePointers = new ActivePointers();

  /** Default identification header value, shared by this user agent's environments. */
  // https://fetch.spec.whatwg.org/#default-user-agent-value
  defaultUserAgentValue = 'Mozilla/5.0 (compatible; Browlet)';
  /** Common compatibility platform permitted by HTML; no physical OS or architecture is disclosed. */
  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-platform
  navigatorPlatform = 'Win32';
  /** Language preference header; explicit configuration may still suppress it with null. */
  defaultAcceptLanguage: string | null = 'en-US';
  /** Wire connections outlive individual documents and are closed by their browser owner. */
  connectionPool = new ConnectionPool();
  /** HTTP wire operations using the browser's shared connection pool. */
  httpTransport: HTTPTransport = new NodeHTTPTransport(this);
  /** Credentials and authentication challenges shared by this user agent's HTTP requests. */
  httpAuthentication: HTTPAuthenticationStore = new HTTPAuthenticationStore(this);
  /** Native HTTP codecs, instantiated separately for each response. */
  supportedContentCodings = new Set(supportedContentCodings);
  /** Construct the decoder chain for one response's content codings. */
  createContentDecoder = createContentDecoder;
  /** Partitioned response storage shared across this browser's Fetches. */
  httpCache = new HTTPCacheStore();
  /** CORS permissions are owned independently of ordinary HTTP cache entries. */
  corsPreflightCache = new CORSPreflightCache();
  /** Stored cookies shared by this browser's documents and requests. */
  cookieStore = new CookieStore();
  /** Controls both sending and accepting cookies without clearing the store. */
  cookiesEnabled = true;
  /** Remembered HTTPS requirements shared by this user agent's browsing contexts. */
  hstsStore = new HSTSStore();
  /** Blob URL registrations shared by this user agent's environments. */
  blobURLStore: Public<BlobURLStore> = new BlobURLStore(this);

  /** Remembered feature decisions shared by this user agent's environments. */
  // https://w3c.github.io/permissions/#permission-store
  permissionStore = new PermissionStore([
    clipboardWritePermission,
    new PersistentStoragePermission((origin) => { this.storagePersistence.revokeProtection(origin); }),
  ], (name) => { this.notifyPermissionStateChanged(name); });
  /** Discover queried permission results without keeping unobserved objects or their globals alive. */
  permissionStatuses = new WeakOrderedSet<PermissionStatusImpl>();

  /** Local storage owned by this user agent across its environments. */
  // https://storage.spec.whatwg.org/#user-agent-storage-shed
  storageShed = new StorageShed();
  /** Discover storage-event recipients without retaining Storage objects or their globals. */
  storageObjects = new WeakOrderedSet<StorageImpl>();
  /** Origin-wide persistence decisions, independent of individual documents and stored data. */
  storagePersistence = new StoragePersistence(this);
  /** Allows storage APIs to obtain keys; Blob URL access checks remain available. */
  storageEnabled = true;
  /** Fixed per-shelf byte budget; independent of usage and available device space. */
  // https://storage.spec.whatwg.org/#storage-quota
  storageQuotaBytes = 64 * 2 ** 20;

  /** Allows outbound report queues and delivery; local ReportingObservers remain enabled. */
  reportDeliveryEnabled = true;
  /** Browser preference shared with worker isolates, independently of their document/response policies. */
  scriptingPolicy = new ScriptingPolicy();
  /** Scroll-container expansion used when a document creates its lazy-loading observer. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-root-margin
  // Implementation-defined: use WebKit's image-observer "100%" fallback until measurements justify tuning.
  lazyLoadScrollMargin: IntersectionObserverMargin = [
    new PercentageLiteral(100), new PercentageLiteral(100), new PercentageLiteral(100), new PercentageLiteral(100),
  ];
  /** Render-blocking cutoff in milliseconds from the relevant global's time origin. */
  // https://html.spec.whatwg.org/multipage/dom.html#render-blocked
  renderBlockingTimeout = 5000;
  /** Milliseconds an ownerless shared worker may survive between page loads. */
  // https://html.spec.whatwg.org/multipage/workers.html#between-loads-shared-worker-timeout
  betweenLoadsSharedWorkerTimeout = 5000;
  /** Policy ceiling in milliseconds for a Service Worker running without clients. */
  // TODO(Service Workers): Enforce this policy in the service-worker lifetime controller.
  // Shared workers use the same value so their extension never exceeds that ceiling.
  serviceWorkerWithoutClientsTimeout = 5 * 60 * 1000;
  /** Maximum age of queued reports in milliseconds; Reporting suggests about two days. */
  maxReportAge = 2 * 24 * 60 * 60 * 1000;
  /** Reporting endpoints are retired after exceeding this consecutive-failure count. */
  maxReportingEndpointFailures = 5;
  /** Whether network-dependent work should treat the browser as offline. */
  // PROVISIONAL: assumes connectivity until explicitly changed; host detection is not wired.
  // Use setOffline() for live changes so affected globals receive their transition events.
  assumeNoInternetConnectivity = false;
  /** Schemes whose tuple origins come from an authenticated protocol implementation. */
  // https://w3c.github.io/webappsec-secure-contexts/#packaged-applications
  authenticatedSchemes = new Set<string>();
  /** Development origins explicitly configured as potentially trustworthy. */
  // https://w3c.github.io/webappsec-secure-contexts/#development-environments
  trustworthyOrigins: TupleOrigin[] = [];

  /** Internal execution is allocated on demand and can outlive individual pages. */
  #sandbox: BrowletEnvironment | null = null;
  /** Allocate the native/automation mouse owner only when input is used. */
  #mouseInput: MouseInputProcessor | null = null;
  /** Allocate shared keyboard modifier state and queued input delivery on first use. */
  #keyboardInput: KeyboardInputProcessor | null = null;
  /** Pointer Lock state is shared across Documents and allocated on first use. */
  #pointerLock: PointerLock | null = null;
  /** System clipboard notification identity belongs to this UserAgent and is allocated only when used. */
  #systemClipboard: SystemClipboard | null = null;
  /** Protocol-handler decisions are allocated only when registration is used. */
  #protocolHandlers: ProtocolHandlerRegistry | null = null;
  /** Suppress another print operation while print events or the print host are running. */
  #printing = false;
  /** Ordered valid BCP 47 tags; the default is a deliberate plausible-language policy. */
  #preferredLanguages: readonly [string, ...string[]] = Object.freeze(['en-US']);

  get sandbox(): BrowletEnvironment {
    return this.#sandbox ??= createSandboxEnvironment(this);
  }

  /** User preference for scripting; Browlet itself always has JavaScript support. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-environment-script
  // TODO(HTML §8.1.4.5): Honor the recommendation to immediately interrupt a
  // running script when scripting is disabled. This setter only gates later
  // entries; it does not abort active execution. Script abort and whole-worker
  // termination are distinct: the spec does not define a reusable-worker or
  // Promise-recovery contract here. See workers/ROADMAP.md before wiring this.
  get scriptingEnabled(): boolean { return this.scriptingPolicy.enabled; }
  set scriptingEnabled(enabled: boolean) { this.scriptingPolicy.enabled = enabled; }

  get mouseInput(): MouseInputProcessor {
    return this.#mouseInput ??= new MouseInputProcessor(this);
  }

  get keyboardInput(): KeyboardInputProcessor {
    return this.#keyboardInput ??= new KeyboardInputProcessor(this);
  }

  get pointerLock(): PointerLock {
    return this.#pointerLock ??= new PointerLock(this);
  }

  get systemClipboard(): SystemClipboard {
    return this.#systemClipboard ??= new SystemClipboard();
  }

  get protocolHandlers(): ProtocolHandlerRegistry {
    return this.#protocolHandlers ??= new ProtocolHandlerRegistry(this);
  }

  /** Preferences for new globals; existing navigators publish changes through their queued tasks. */
  get preferredLanguages(): readonly [string, ...string[]] { return this.#preferredLanguages; }

  /** Shared-worker extension equals the user agent's Service Worker no-client lifetime policy. */
  // https://html.spec.whatwg.org/multipage/workers.html#extended-lifetime-shared-worker-timeout
  get extendedLifetimeSharedWorkerTimeout(): number {
    return this.serviceWorkerWithoutClientsTimeout;
  }

  /** Node host consent hook; a browser without a configured prompt declines new requests. */
  // TODO(Permissions host integration): cancel still-open prompts when their requesting global is destroyed.
  onPermissionPrompt: PermissionPrompt = () => false;

  /** Node host chooser; absent UI denies selection. Pending UI cancellation is the same dependency as prompting. */
  onPermissionChoice: PermissionChooser = () => 'denied';

  /** Release an existing lock after DOM unlinking without allocating an unused controller. */
  // https://w3c.github.io/pointerlock/#requirements
  // SPEC_CLASH(pointer-lock-state-preserving-move): DOM moveBefore bypasses removal, preserving lock; the Chromium/Firefox probe releases it.
  releaseDisconnectedPointerLock(): void {
    const lock = this.#pointerLock;
    if (lock === null) return;
    const target = lock.target;
    if (target !== null && !target.isConnected) lock.exitPointerLock(target);
  }

  /** Obtain an unrandomized assessment of this navigation's transient conditions, or null if unavailable. */
  // https://w3c.github.io/navigation-timing/#performancenavigationtiming-underlying-confidence-value
  getUnderlyingNavigationTimingConfidence(_entry: PerformanceNavigationTimingImpl): PerformanceTimingConfidenceValue | null {
    // TODO(Navigation Timing host measurements): Capture startup completion, temporary CPU/memory
    // pressure, or other transient observations for this entry's navigation interval. Static device
    // characteristics are forbidden. There is no host instrumentation for this yet; do not infer
    // high confidence from its absence or substitute the current conditions when the getter runs.
    return null;
  }

  /**
   * Accept ordered, valid BCP 47 tags and all affected Window/worker navigators.
   * The caller owns tag validation and complete recipient discovery/transport.
   * Navigator visibility changes in each global's task; future Fetches use the
   * new default header immediately, unless a request or emulation overrides it.
   */
  // https://html.spec.whatwg.org/multipage/system-state.html#language-preferences
  // TODO(Host preferences/worker transport): supply the full recipient list when
  // OS preferences change, including workers outside browsing-context groups.
  setPreferredLanguages(tags: readonly [string, ...string[]], navigators: Iterable<NavigatorImpl | WorkerNavigatorImpl>): void {
    const languages = Object.freeze<[string, ...string[]]>([...tags]);
    for (const navigator of navigators) {
      const emulatedLanguage = this.webDriverBiDiEmulatedLanguage(navigator.env);
      navigator.queueLanguageChange(emulatedLanguage === null ? languages : [emulatedLanguage]);
    }
    this.#preferredLanguages = languages;
    this.defaultAcceptLanguage = languages.join(',');
  }

  /**
   * Update the browser's offline assumption and notify the supplied Window/worker
   * navigators. The caller supplies all recipients; each environment's emulation
   * can independently keep its effective state offline.
   */
  // https://html.spec.whatwg.org/multipage/system-state.html#navigator.online
  // TODO(Host connectivity/worker transport): supply actual host observations and
  // the complete recipient list, including workers outside browsing-context groups.
  setOffline(offline: boolean, navigators: Iterable<NavigatorImpl | WorkerNavigatorImpl>): void {
    const previousStates = new Map<NavigatorImpl | WorkerNavigatorImpl, boolean>();
    for (const navigator of navigators) previousStates.set(navigator, navigator.onLine);
    this.assumeNoInternetConnectivity = offline;
    for (const [navigator, wasOnline] of previousStates) navigator.queueOnlineStateChange(wasOnline);
  }

  /** Receive an already-normalized registration request from the Navigator's parallel steps. */
  // https://html.spec.whatwg.org/multipage/system-state.html#protocol-handler-registration
  registerProtocolHandler(scheme: string, url: URLRecord, document: DocumentImpl): void {
    this.protocolHandlers.register(scheme, url, document).observe(() => undefined, (error) => { throw error; });
  }

  /** Remove an already-normalized handler through the browser's registration owner. */
  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-unregisterprotocolhandler
  unregisterProtocolHandler(scheme: string, url: URLRecord, _document: DocumentImpl): void {
    this.#protocolHandlers?.unregister(scheme, url);
  }

  /** Obtain a consent decision without storing it or selecting a default handler. */
  // https://html.spec.whatwg.org/multipage/system-state.html#security-and-privacy
  requestProtocolHandlerConsent(_scheme: string, _url: URLRecord, _document: DocumentImpl): InternalPromise<boolean> {
    // TODO(Protocol handler host): Apply admission/admin policy and cross-site/many-handler
    // spam controls; present untrusted metadata safely, including nulls, escape characters,
    // and long strings without obscuring rejection controls. Resolve consent without
    // automatically choosing a default; exact-pair deduplication alone is not this UI policy.
    throw new InternalError('Protocol handler consent is not implemented');
  }

  /** Require a verified automation context before honoring a Document's automatic decision. */
  verifyProtocolHandlerAutomation(_document: DocumentImpl): void {
    // TODO(WebDriver): Verify the controlling active session and its automation context.
    // A Document mode alone, or a locally constructed WebDriverSession, is not that proof.
    throw new InternalError('Protocol handler automation verification is not implemented');
  }

  /** Recheck live results after a decision or feature-specific constraint changes. */
  // TODO(Permissions Policy/feature APIs): call this when enablement or other permission inputs change.
  notifyPermissionStateChanged(name: string): void {
    for (const status of this.permissionStatuses.values()) {
      if (status.name === name) status.queueUpdate();
    }
  }

  /** Apply an automation decision to the supplied candidate environments for this browser. */
  // TODO(WebDriver): Obtain the complete environment list from the selected user context.
  // The caller must currently supply that list; browsing-context traversal alone omits other globals.
  setPermission(
    descriptor: PermissionDescriptor, state: PermissionState, key: unknown, envs: Iterable<PermissionEnvironment>,
  ): InternalPromise<void> {
    return this.permissionStore.setPermission(descriptor, state, key, envs, this);
  }

  /** Adapt the Node host's consent result to browser-owned continuations without recording it. */
  promptForPermission(descriptor: PermissionDescriptor, env: PermissionEnvironment): InternalPromise<boolean> {
    const P = this.HostPromise;
    return P.try(() => {
      if (env.topLevelOrigin === null) throw new InternalError('Permission prompt requires a top-level origin');
      const answer = this.onPermissionPrompt({
        descriptor, origin: serializeOrigin(env.origin), topLevelOrigin: serializeOrigin(env.topLevelOrigin),
      });
      return P.fromValue(answer, NativePromise, internalType<boolean>()).then((allowed) => {
        if (typeof allowed !== 'boolean') throw new InternalError('Permission prompt must return a boolean');
        return allowed;
      });
    }, internalType<boolean>());
  }

  /** Adapt host selection to browser continuations; the chooser algorithm validates the returned options. */
  choosePermissionOptions<T>(request: PermissionChoiceRequest<T>, env: PermissionEnvironment): InternalPromise<PermissionSelection<T>> {
    const P = this.HostPromise;
    return P.try(() => {
      if (env.topLevelOrigin === null) throw new InternalError('Permission chooser requires a top-level origin');
      const answer = this.onPermissionChoice({
        ...request, origin: serializeOrigin(env.origin), topLevelOrigin: serializeOrigin(env.topLevelOrigin),
      });
      return P.fromValue(answer, NativePromise, internalType<PermissionSelection<T>>());
    }, internalType<PermissionSelection<T>>());
  }

  /** Create an Agent with its own microtask queue and running browser event loop. */
  createWindowAgent(): WindowAgent {
    return new WindowAgent(this.#createEventLoop());
  }

  /** Allocate a dedicated worker in its creator's cluster, or a shared worker in a new cluster. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#obtain-a-dedicated/shared-worker-agent
  obtainDedicatedOrSharedWorkerAgent(outsideEnv: BrowletEnvironment, isShared: boolean): Agent {
    return this.#obtainWorkerOrWorkletAgent(outsideEnv, isShared, true);
  }

  /** Allocate one worklet agent in its creator's cluster. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#obtain-a-worklet-agent
  obtainWorkletAgent(outsideEnv: BrowletEnvironment): Agent {
    return this.#obtainWorkerOrWorkletAgent(outsideEnv, false, false);
  }

  /** Allocate a service worker in a new cluster without an outside environment. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#obtain-a-service-worker-agent
  obtainServiceWorkerAgent(): Agent {
    return this.#obtainWorkerOrWorkletAgent(null, true, false);
  }

  /** Register a group before its initial browsing context and Document are created. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-browsing-context-group
  createBrowsingContextGroup(): BrowsingContextGroup {
    const group = new BrowsingContextGroup(this);
    this.browsingContextGroupSet.add(group);
    return group;
  }

  /** Create a new tab/window and request its initial navigation from its own about:blank Document. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#create-a-fresh-top-level-traversable
  createFreshTopLevelTraversable(
    initialNavigationURL: URLRecord, initialNavigationPostResource: PostResource | null = null,
  ): TopLevelTraversable {
    const traversable = TopLevelTraversable.create(this, null, '');
    const document = traversable.activeDocument;
    if (document === null) throw new InternalError('A fresh traversable needs an active Document');
    // TODO(HTML §7.4): navigate() still stops at its explicit navigation-coordination dependency.
    traversable.navigate(initialNavigationURL, document, { documentResource: initialNavigationPostResource });
    return traversable;
  }

  /** Create an element's child through the navigation layer. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-nested-browsing-context
  createChildNavigable(element: ElementImpl): void {
    Navigable.createChild(element);
  }

  /** Destroy a container's child through the navigation layer. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-child-navigable
  destroyChildNavigable(container: NavigableContainer): void {
    Navigable.destroyChild(container);
  }

  /** Request top-level destruction without applying script-closing authorization. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-top-level-traversable
  destroyTopLevelTraversable(traversable: TopLevelTraversable): void {
    traversable.destroy();
  }

  appendTopLevelTraversable(traversable: TopLevelTraversable): void {
    this.topLevelTraversableSet.add(traversable);
  }

  /** Whether any navigable has an active Document that has not completely loaded. */
  // https://html.spec.whatwg.org/multipage/workers.html#permissible-worker
  hasLoadingNavigable(): boolean {
    // Reuse registered Windows, including children beneath inactive ancestors.
    // A replaced Document is excluded by its node-navigable lookup; fully-active
    // status and origin are deliberately not conditions in HTML's worker check.
    for (const group of this.browsingContextGroupSet) {
      for (const cluster of group.agentClusterMap.values()) {
        for (const agent of cluster.agents) {
          if (!(agent instanceof WindowAgent)) continue;
          for (const window of agent.windowObjects) {
            if (window.navigable !== null && window.document.completelyLoadedTime === null) return true;
          }
        }
      }
    }
    return false;
  }

  /** Remove a tab/window presentation when a UI host is attached. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-top-level-traversable
  removeTopLevelTraversableFromUI(_traversable: TopLevelTraversable): void {
    // PROVISIONAL: Browlet has no tab/window UI host; connect its removal notification when one exists.
  }

  /** Unregister a traversable and clear its session storage after document teardown has been requested. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-top-level-traversable
  // https://storage.spec.whatwg.org/#storage-pressure
  removeTopLevelTraversable(traversable: TopLevelTraversable): void {
    if (!this.topLevelTraversableSet.delete(traversable)) return;
    for (const [key, shelf] of traversable.storageShed) {
      for (const name of shelf.bucketMap.keys()) traversable.storageShed.removeBucket(key, name);
    }
  }

  /** Release an empty group after its last top-level context has been removed. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#bcg-remove
  removeBrowsingContextGroup(group: BrowsingContextGroup): void {
    if (group.browsingContextSet.size !== 0) {
      throw new InternalError('A nonempty browsing context group cannot be removed');
    }

    this.browsingContextGroupSet.delete(group);
  }

  /** Remove top-level contexts after all their Documents are destroyed and their WindowProxy is collectible. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#a-browsing-context-is-discarded
  collectBrowsingContexts(): void {
    // TODO(HTML §7.3.2.3): track all referring Documents and WindowProxy collection eligibility.
    // Group membership currently retains the context and its proxy; an empty active slot is insufficient.
    throw new InternalError('Browsing-context collection requires Document lifetime tracking and WindowProxy collection eligibility');
  }

  /** Refresh browser UI displaying URLs or derived data affected by this document's base URL. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#respond-to-base-url-changes
  updateURLDisplays(_document: DocumentImpl): void {
    // PROVISIONAL: no browser UI is attached; retain this notification for a future UI host.
  }

  /** Whether initial fragment scrolling still serves the user's intent for this Document. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#try-to-scroll-to-the-fragment
  isUserInterestedInFragmentScrolling(_document: DocumentImpl): boolean {
    // TODO(HTML §7.4.6.2 / CSSOM View): Connect input and viewport scrolling state to the user-agent decision.
    // Browsers stop competing with explicit scrolling; synthetic scroll events alone do not establish user intent.
    throw new InternalError('Fragment scrolling user-interest policy is not implemented');
  }

  /** Apply browser download policy after the source and destination sandboxes allow it. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigation-as-a-download
  // https://w3c.github.io/webappsec-mixed-content/#html
  isNavigationDownloadAllowed(_response: FetchResponse, _sourceSnapshotParams: SourceSnapshotParams): boolean {
    // SPEC_GAP(mixed-download-source-url): Mixed Content's old HTML hook reads a source Document absent from these inputs.
    // TODO(Mixed Content §5.2): Select the source URL and capture time before connecting FetchResponse.isMixedDownload().
    // TODO(HTML §7.4.5): Compose optional hostile-download policy; HTML otherwise allows the download.
    throw new InternalError('Navigation download admission policy is not implemented');
  }

  /** Handle a permitted response as a download without creating a Document. */
  // https://html.spec.whatwg.org/multipage/links.html#handle-as-a-download
  handleAsDownload(_response: FetchResponse, _navigable: Navigable, _navigationId: string | null): void {
    // TODO(HTML §4.6.5): Get a safe suggested filename, ask BiDi download-will-begin, and honor its decision/folder.
    // Save the response through a host port in parallel, then report BiDi download-end for completion or cancellation.
    throw new InternalError('Download handling is not implemented');
  }

  /** Decide whether handling this URL leaves its destination navigable unchanged. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#attempt-to-create-a-non-fetch-scheme-document
  shouldHandleURLExternally(_url: URLRecord): boolean {
    // TODO(HTML §7.4.2.3.4/§8.10.1.4): Compose handler selection with the host's protocol support and
    // registered web handlers. Unsupported schemes may need an inline error or handler-selection page.
    // Registration must not choose defaults automatically. Apply administrator restrictions on
    // handler destinations before disclosing input URLs; selected web handlers need invocation's
    // destination/navigation integration rather than an OS handoff merely because they are registered.
    throw new InternalError('External URL handler selection is not implemented');
  }

  /** Choose inline error/native content or external handling when no built-in document loader matches. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-non-Document
  shouldDisplayUnsupportedResourceInline(_type: MIMEType): boolean {
    // TODO(HTML §7.4.5): Compose the host's unsupported-content policy, including external applications/downloads.
    throw new InternalError('Unsupported navigation resource handling is not implemented');
  }

  /** Apply the destination sandbox before requesting an external handoff of a URL or response. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#hand-off-to-external-software
  handoffToExternalSoftware(
    resource: URLRecord | FetchResponse, navigable: Navigable, sandboxFlags: SandboxingFlagSet,
    hasTransientActivation: boolean, initiatorOrigin: Origin, resourceReader?: ResourceReader,
  ): void {
    // SPEC_CLASH(external-protocol-sandbox-teams): Follow HTML's general gate; WebKit bypasses it for
    // msteams: from teams.live.com/teams.microsoft.com when site-specific quirks are enabled.
    if (
      !navigable.isTopLevelTraversable && sandboxFlags.has('sandboxed-custom-protocols-navigation') &&
      (sandboxFlags.has('sandboxed-top-level-navigation-with-user-activation') || !hasTransientActivation)
    ) return;
    this.requestExternalSoftwareHandoff(resource, navigable, hasTransientActivation, initiatorOrigin, resourceReader);
  }

  /** Ask the host to confirm and perform an allowed external handoff. */
  requestExternalSoftwareHandoff(
    _resource: URLRecord | FetchResponse, _navigable: Navigable, _hasTransientActivation: boolean, _initiatorOrigin: Origin,
    _resourceReader?: ResourceReader,
  ): void {
    // TODO(HTML §7.4.2.3.4): Compose a host port for handler selection, confirmation, and safe resource delivery.
    // Without transient activation, prior user confirmation is required; activation alone need not bypass prompting.
    // Retain the initiating origin for that decision, including the last fetch origin after redirects.
    // A supplied reader owns sniffed bytes and the remaining body; do not reread its locked response stream.
    throw new InternalError('External software confirmation and handoff are not implemented');
  }

  /** Coordinate navigation/closing checks with browser-owned completion across the Documents' event loops. */
  checkIfUnloadingIsCanceled(
    navigables: Navigable[], traversable?: Traversable, targetStep?: number,
    userInvolvementForNavigateEvent?: UserNavigationInvolvement,
  ): InternalPromise<UnloadCancellationResult> {
    return Navigable.checkIfUnloadingIsCanceled(navigables, traversable, targetStep, userInvolvementForNavigateEvent, this);
  }

  /** Whether an otherwise eligible unload prompt is unlikely to be annoying, deceptive, or pointless. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#steps-to-fire-beforeunload
  shouldShowBeforeUnloadPrompt(_document: DocumentImpl): boolean {
    // TODO(HTML §7.4.2.4): Supply the user-agent anti-abuse policy after sandbox, activation, and cancellation checks.
    throw new InternalError('Beforeunload prompt admission policy is not implemented');
  }

  /** Synchronously ask the user to confirm unloading, from inside the owning event loop's pause. */
  requestUnloadConfirmation(_document: DocumentImpl): boolean {
    // TODO(HTML §7.4.2.4): Compose a UI host port with a user-agent-controlled message; ignore the event's returnValue text.
    // The host wait must not run author code or depend on queued callbacks on this thread.
    throw new InternalError('Beforeunload confirmation UI is not implemented');
  }

  /** Display an alert and synchronously wait for acknowledgement inside its event loop's pause. */
  showAlert(_window: WindowImpl, _message: string): void {
    // TODO(HTML simple dialogs): Compose a UI host port that treats LF as a line break.
    // The wait must not run author code or depend on queued callbacks on this thread.
    throw new InternalError('Alert display and acknowledgement UI are not implemented');
  }

  /** Display a confirmation and synchronously await its response inside the event loop's pause. */
  showConfirm(_window: WindowImpl, _message: string): boolean {
    // TODO(HTML simple dialogs): Compose a UI host port that treats LF as a line break.
    // The wait must not run author code or depend on queued callbacks on this thread.
    throw new InternalError('Confirmation display and response UI are not implemented');
  }

  /** Display a text prompt and synchronously return the response, or null for dismissal. */
  showPrompt(_window: WindowImpl, _message: string, _defaultValue: string): string | null {
    // TODO(HTML simple dialogs): Compose a UI host port, using the supplied default text.
    // Treat message LF as a line break; wait inside the pause without running author code.
    throw new InternalError('Text prompt display and response UI are not implemented');
  }

  /** Run printing from a script or UI task, retaining the invoking Document's event-loop pause. */
  // https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing-steps
  runPrintingSteps(document: DocumentImpl): void {
    // HTML permits ignoring a print request. Suppress reentrant requests across this UserAgent.
    if (this.#printing || !this.#isActivePrintTarget(document) || document.unloadCounter > 0) return;
    if (document.activeSandboxingFlagSet.has('sandboxed-modals')) return;

    this.#printing = true;
    try {
      this.#firePrintEvent(document, 'beforeprint');
      // SPEC_GAP(print-document-lifetime): Recheck activity and unloading after author callbacks before entering the host.
      if (!this.#isActivePrintTarget(document) || document.unloadCounter > 0) return;
      const env = document.env;
      env.responsibleEventLoop.pauseUntil(() => {
        this.obtainPhysicalForm(document);
      }, env);
      this.#firePrintEvent(document, 'afterprint');
    } finally {
      this.#printing = false;
    }
  }

  /** Offer printing or a physical-form representation using document state at this invocation. */
  // https://html.spec.whatwg.org/multipage/rendering.html#obtain-a-physical-form
  obtainPhysicalForm(_document: DocumentImpl): void {
    // TODO(HTML printing/CSS/host): Capture the relevant documents now, apply print media and paged layout,
    // and offer preview, PDF, or printer output. A delayed output must retain that captured state.
    // Run synchronously inside the invoking event loop's pause; do not execute author code or wait on its tasks.
    throw new InternalError('Physical-form capture, print layout, and print UI are not implemented');
  }

  /** Generate a fresh canonical UUID for browser-owned registrations. */
  generateUUID(): string {
    return randomUUID();
  }

  /** Parse a browser URL and retain its Blob registration before revocation can remove it. */
  parseURL(input: string, base: URLRecord | null = null, encoding = 'UTF-8'): URLRecord | null {
    return parseURL(input, base, encoding, this).url;
  }

  /**
   * Create an element resource request using its interpreted CORS setting.
   * The calling HTML algorithm supplies the client and other resource-specific fields afterward.
   */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#create-a-potential-cors-request
  createPotentialCORSRequest(
    url: URLRecord, destination: Destination, corsAttributeState: CORSSettingsState,
    sameOriginFallback = false,
  ): FetchRequest {
    const request = new FetchRequest(url, this.sandbox);
    request.destination = destination;
    request.mode = corsAttributeState === 'no-cors'
      ? sameOriginFallback ? 'same-origin' : 'no-cors'
      : 'cors';
    request.credentialsMode = corsAttributeState === 'anonymous' ? 'same-origin' : 'include';
    request.useURLCredentials = true;
    return request;
  }

  /** Acquire a captured Blob entry without resolving its URL again after revocation. */
  obtainBlobObject(
    entry: URLBlobURLEntry | null,
    env: StorageEnvironmentBase | 'top-level-navigation' | 'top-level-self-fetch',
  ): BlobImpl | null {
    if (!(entry instanceof BlobURLEntry)) return null;
    return entry.obtainObject(env);
  }

  /** Create a fresh HTML policy container, including for clientless Fetch requests. */
  createPolicyContainer(): PolicyContainer {
    return new PolicyContainer();
  }

  /** Obtain response policies, or clone a Blob URL creator's retained policies. */
  // https://html.spec.whatwg.org/multipage/browsers.html#creating-a-policy-container-from-a-fetch-response
  createPolicyContainerFromResponse(response: FetchResponse, env: BrowletEnvironmentBase | null): PolicyContainer {
    const url = response.url;
    if (url === null) throw new InternalError('Policy-container creation requires a response URL');
    if (url.scheme === 'blob') {
      const entry = url.blobURLEntry;
      if (!(entry instanceof BlobURLEntry)) throw new InternalError('Blob policy inheritance requires a resolved Blob URL entry');
      return entry.env.policyContainer.clone();
    }
    const result = this.createPolicyContainer();
    result.cspList = CSPList.parse(response);
    // SPEC_CLASH(policy-container-null-environment): HTML assigns a string to the embedder-policy record; keep the default record.
    if (env !== null) result.embedderPolicy = EmbedderPolicy.obtain(response, env);
    result.referrerPolicy = parseReferrerPolicyFromHeader(response);
    result.parseIntegrityPolicyHeaders(response);
    return result;
  }

  /** Shared Fetch timestamps use the same clock as HTML and High Resolution Time. */
  unsafeSharedCurrentTime(): number {
    return unsafeSharedCurrentTime().milliseconds;
  }

  /** Supply a browser-policy response, or null to continue normal Fetch dispatch. */
  // https://fetch.spec.whatwg.org/#potentially-override-response-for-a-request
  potentiallyOverrideResponse(_request: FetchRequest, _env: FetchEnvironment): FetchResponse | null {
    // Fetch's default implementation lets the request proceed unchanged.
    return null;
  }

  /** Offer a request to a matching Service Worker, retaining completion on the browser's host queue. */
  // https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm
  handleFetch(
    _request: FetchRequest, _controller: FetchController, _useHighResPerformanceTimers: boolean,
    _prepareRequest: () => InternalPromise<FetchRequest>,
  ): InternalPromise<FetchResponse | ServiceWorkerTimingInfo | null> {
    // PROVISIONAL(Service Workers): no registrations or active workers exist yet.
    // Return without preparing an unused request/body branch.
    return this.HostPromise.try(() => null, internalType<FetchResponse | ServiceWorkerTimingInfo | null>());
  }

  /** Select internal network scheduling state for a request. */
  determineFetchPriority(_request: FetchRequest): RequestInternalPriority {
    // PROVISIONAL(Fetch 9): no transport scheduler exists. Select and update
    // priority using the request's hint, initiator, destination, and render-blocking state there.
    return { update() {} };
  }

  /** Whether this browser supports a resource type, for media dispatch, sniffing, and Resource Timing. */
  supportsMIMEType(_type: MIMEType): boolean {
    // TODO: Compose installed decoder/viewer capabilities; no media support is claimed yet. MIME Sniffing still
    // minimizes JavaScript, JSON, SVG, and XML independently; other types remain unexposed.
    return false;
  }

  /** Group and queue copied reports using the generating global's endpoint configuration. */
  // https://w3c.github.io/reporting/#send-reports
  // Accept the endpoint list directly so delivery does not retain the generating environment.
  sendReports(reports: ReportImpl[], configuration: ReportingEndpoint[]): void {
    if (!this.reportDeliveryEnabled) return;
    const cutoff = Date.now() - this.maxReportAge;
    const endpointMap = new Map<ReportingEndpoint, ReportImpl[]>();
    for (const report of reports) {
      if (report.timestamp < cutoff) continue;
      const endpoint = configuration.find((candidate) => candidate.name === report.destination);
      if (endpoint === undefined || endpoint.failures > this.maxReportingEndpointFailures) continue;
      const group = endpointMap.get(endpoint);
      const copy = report.cloneForDelivery();
      if (group === undefined) endpointMap.set(endpoint, [copy]);
      else group.push(copy);
    }

    for (const [endpoint, group] of endpointMap) {
      const originGroups: [ReportImpl, ...ReportImpl[]][] = [];
      for (const report of group) {
        const originGroup = originGroups.find((candidate) => areSameOrigin(candidate[0].origin, report.origin));
        if (originGroup === undefined) originGroups.push([report]);
        else originGroup.push(report);
      }
      for (const originGroup of originGroups) {
        this.#queueReportDelivery(endpoint, originGroup[0].origin, originGroup, configuration);
      }
    }
  }

  /** Run browser-owned reporting work on a later host turn, yielding to runnable page tasks. */
  queueReportingTask(steps: () => void): void {
    queueNodeTask(() => {
      for (const group of this.browsingContextGroupSet) {
        for (const cluster of group.agentClusterMap.values()) {
          for (const agent of cluster.agents) {
            const { eventLoop } = agent;
            if (eventLoop.hasRunnableTasks()) {
              this.queueReportingTask(steps);
              return;
            }
          }
        }
      }
      steps();
    });
  }

  /** Attempt delivery and return its outcome without changing endpoint bookkeeping. */
  // https://w3c.github.io/reporting/#try-delivery
  // The internal Promise represents the draft's "wait for a response" step.
  // Its continuations belong to the browser, not the report's retiring Window.
  attemptReportDelivery(
    endpoint: ReportingEndpoint, origin: Origin, reports: ReportImpl[],
  ): InternalPromise<ReportDeliveryResult> {
    const request = new FetchRequest(endpoint.url, this.sandbox);
    request.method = 'POST';
    request.origin = origin;
    request.headerList.append('Content-Type', 'application/reports+json');
    request.traversableForUserPrompts = null;
    request.allowServiceWorkerInterception = false;
    request.destination = 'report';
    request.mode = 'cors';
    request.unsafeRequest = true;
    request.credentialsMode = 'same-origin';
    request.priority = 'low';
    // Bytes need no stream or execution owner from the retiring Window.
    request.body = ReportImpl.serialize(reports);
    for (const report of reports) report.attempts++;
    const result = this.HostPromise.withResolvers(internalType<ReportDeliveryResult>());
    // This clientless request has no Window to receive response callbacks.
    // The sandbox owns stream execution; the request retains the report's
    // original origin and remains clientless.
    fetch(request, {
      processResponse: (response) => {
        if (isOkStatus(response.status)) result.resolve('success');
        else if (response.status === 410) result.resolve('remove-endpoint');
        else result.resolve('failure');
        // Reporting uses only the status; no consumer will drain this body.
        const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
        internalResponse.discardBody?.();
      },
      useParallelQueue: true,
    }, this.sandbox);
    return result.promise;
  }

  /**
   * Maximum simultaneous contacts supported by any individual digitizer, not their sum
   * or the number of active pointers. A known non-touch device reports zero; when the
   * exact capacity is unavailable, report the minimum guaranteed by the input host.
   */
  // https://w3c.github.io/pointerevents/#dom-navigator-maxtouchpoints
  getMaxTouchPoints(): number {
    // TODO(Pointer Events §6): The native-input host must query digitizer capacities.
    // Node supplies no such query; an absent host must not silently mean zero capacity.
    throw new InternalError('Touch-device capacity query is not implemented');
  }

  /** Whether automation permits scripting for the given environment. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-scripting-is-enabled
  webDriverBiDiScriptingIsEnabled(_env: BrowletEnvironment): boolean {
    // PROVISIONAL: no BiDi sessions; select top-level traversable/user-context overrides when implemented.
    return true;
  }

  /** Whether automation emulates an offline network for the given environment. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-network-is-offline
  webDriverBiDiNetworkIsOffline(_env: BrowletEnvironment): boolean {
    // PROVISIONAL: no BiDi sessions; select scoped network conditions when implemented.
    // TODO(BiDi network updates): capture each affected Navigator's onLine value
    // before changing emulation, then call queueOnlineStateChange(previousValue).
    return false;
  }

  /** Identification override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-user-agent
  webDriverBiDiEmulatedUserAgent(_env: BrowletEnvironment): string | null {
    // PROVISIONAL: no BiDi sessions; select scoped emulation when implemented.
    return null;
  }

  /** Language override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-language
  webDriverBiDiEmulatedLanguage(_env: BrowletEnvironment): string | null {
    // PROVISIONAL: no BiDi sessions; select scoped language emulation when implemented.
    // TODO(BiDi language updates): call each affected Navigator's queueLanguageChange()
    // with its new effective tags and emulationUpdated=true before changing the
    // selector's result. Removing an override restores preferredLanguages.
    return null;
  }

  /** Touch-capacity override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-max-touch-points
  webDriverBiDiEmulatedMaxTouchPoints(_env: BrowletEnvironment): number | null {
    // TODO(WebDriver BiDi §7.4.2.14): Once active sessions exist, select top-level
    // traversable, user-context, then session-default touch overrides in that order.
    return null;
  }

  /** Retain an outgoing body if automation requests its contents. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-clone-network-request-body
  webDriverBiDiCloneNetworkRequestBody(_request: FetchRequest): void {
    // PROVISIONAL: no BiDi sessions request network body collection.
  }

  /** WebDriver BiDi's HTTP request notification. */
  // PROVISIONAL: no active BiDi network sessions are implemented yet.
  webDriverBiDiBeforeRequestSent(_request: FetchRequest): void {}

  /** WebDriver BiDi's optional incoming-body retention. */
  // PROVISIONAL: no active BiDi network sessions are implemented yet.
  webDriverBiDiCloneNetworkResponseBody(_request: FetchRequest, _response: FetchResponse): void {}

  /** Notify automation of a network fetch error. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-fetch-error
  webDriverBiDiFetchError(_request: FetchRequest): void {
    // PROVISIONAL: no BiDi sessions receive network events.
  }

  /** Notify automation that Fetch has received a response. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-response-started
  webDriverBiDiResponseStarted(_request: FetchRequest, _response: FetchResponse): void {
    // PROVISIONAL: no BiDi sessions receive network events.
  }

  /** Notify automation that Fetch has completed a response. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-response-completed
  webDriverBiDiResponseCompleted(_request: FetchRequest, _response: FetchResponse): void {
    // PROVISIONAL: no BiDi sessions receive network events.
  }

  /** Notify automation of a prompt and select its configured handling, or leave confirmation to the host. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-user-prompt-opened
  webDriverBiDiUserPromptOpened(
    _window: WindowImpl, _type: string, _message: string, _defaultValue: string | null = null,
  ): 'accept' | 'dismiss' | 'none' {
    // TODO(WebDriver BiDi): Select the session/user-context prompt handler and emit subscribed userPromptOpened events.
    // PROVISIONAL: no active BiDi sessions; the ordinary host must obtain the user's response.
    return 'none';
  }

  /** Notify automation that a prompt was accepted or dismissed. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-user-prompt-closed
  webDriverBiDiUserPromptClosed(
    _window: WindowImpl, _type: string, _accepted: boolean, _userText: string | null = null,
  ): void {
    // TODO(WebDriver BiDi): Emit subscribed userPromptClosed events, including prompt type and optional user input.
    // PROVISIONAL: no active BiDi sessions receive prompt notifications.
  }

  /** Notify automation after a new navigable has been initialized and registered. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigable-created
  // SPEC_CLASH(bidi-navigable-created-inputs): HTML omits BiDi's required has-planned-navigation input; resolve before delivery.
  webDriverBiDiNavigableCreated(_navigable: Navigable, _openerNavigable: Navigable | null = null): void {
    // TODO(WebDriver BiDi): Retain original opener, apply cache overrides, and emit subscribed contextCreated events.
    // PROVISIONAL: live BiDi sessions, context registration, and notification delivery are not implemented.
  }

  /** Notify automation after a navigable's destruction has been requested. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigable-destroyed
  webDriverBiDiNavigableDestroyed(_navigable: Navigable): void {
    // TODO(WebDriver BiDi): Serialize navigable info, emit contextDestroyed to parent-related subscriptions, and prune subscriptions.
    // PROVISIONAL: live BiDi sessions, context registration, and notification delivery are not implemented.
  }

  /** Notify automation that an identified navigation has started. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigation-started
  webDriverBiDiNavigationStarted(
    _navigable: Navigable, _status: { id: string; status: 'pending'; url: URLRecord; },
  ): void {
    // TODO(WebDriver BiDi): Resume navigation-started waiters and serialize navigation info for subscribed navigationStarted events.
    // PROVISIONAL: live sessions and navigation event delivery are not implemented.
  }

  /** Notify automation after a new Document's history state has been initialized. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigation-committed
  webDriverBiDiNavigationCommitted(
    _navigable: Navigable, _status: { id: string | null; status: 'committed'; url: URLRecord; },
  ): void {
    // TODO(WebDriver BiDi): Resume committed waiters and emit navigationCommitted to subscribed sessions.
    // PROVISIONAL: sessions/protocol attribution are absent. HTML supplies "committed" although BiDi's status list
    // omits it; history population can also supply a null ID. Preserve HTML's inputs until the BiDi audit.
  }

  /** Notify automation that a navigation failed before committing. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigation-failed
  webDriverBiDiNavigationFailed(
    _navigable: Navigable, _status: { id: string | null; status: 'canceled'; url: URLRecord; },
  ): void {
    // TODO(WebDriver BiDi): Resume navigation-failed waiters and emit navigationFailed to subscribed sessions.
    // PROVISIONAL: live sessions and navigation event delivery are not implemented.
  }

  /** Notify automation after a fragment navigation's joint-history work completes. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-fragment-navigated
  webDriverBiDiFragmentNavigated(
    _navigable: Navigable, _status: { id: string; status: 'complete'; url: URLRecord; },
  ): void {
    // TODO(WebDriver BiDi): Resume fragment-navigated waiters and emit fragmentNavigated to subscribed sessions.
    // PROVISIONAL: live sessions and navigation event delivery are not implemented.
  }

  /** Notify automation after a synchronous URL/history update has been finalized. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-history-updated
  webDriverBiDiHistoryUpdated(_navigable: Navigable): void {
    // TODO(WebDriver BiDi): Emit historyUpdated with the navigable's context and URL to subscribed sessions.
    // PROVISIONAL: live sessions and history event delivery are not implemented.
  }

  /** Notify automation that an identified navigation was canceled. */
  // PROVISIONAL: no WebDriver BiDi sessions exist to receive this notification.
  webDriverBiDiNavigationAborted(
    _navigable: Navigable | null,
    _status: { id: string; status: 'canceled'; url: URLRecord; },
  ): void {
    // Connect the BiDi navigation-aborted algorithm when sessions are implemented.
  }

  /**
   * Classify a new Window using the incoming Document's origin.
   * For a child navigable, supply the Window environment of the Document containing
   * its navigable container (such as an iframe). Omit it for a top-level Window;
   * an opener does not count as an embedding Window.
   */
  // SPEC_CLASH(secure-context-top-level-url): HTML checks the top-level creation URL; retain origin-and-ancestry checks.
  // The embedding Window's fixed decision includes its whole security chain. Reservations
  // capture this result; Window setup must preserve an existing reservation's decision.
  // See ./browsing/policy/ROADMAP.md#trustworthiness.
  // https://html.spec.whatwg.org/multipage/webappapis.html#secure-context
  // https://w3c.github.io/webappsec-secure-contexts/#ancestors
  computeWindowSecureContext(incomingOrigin: Origin, embeddingWindowEnv?: WindowEnvironment): boolean {
    return this.isOriginPotentiallyTrustworthy(incomingOrigin) && embeddingWindowEnv?.isSecureContext !== false;
  }

  // Secure Contexts: Is origin potentially trustworthy?
  // https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
  isOriginPotentiallyTrustworthy(origin: Origin): boolean {
    // Preserve an explicit trust decision when the origin has lost its tuple,
    // as with Browlet's file origins. Other opaque origins start untrusted.
    if (origin.kind === 'opaque') return origin.potentiallyTrustworthy;
    if (origin.scheme === 'https' || origin.scheme === 'wss') return true;

    const host = origin.host;
    if (host.kind === 'ipv4' && host.value >>> 24 === 127) return true;
    if (host.kind === 'ipv6' && host.pieces.every((piece, i) => piece === (i === 7 ? 1 : 0))) return true;

    // The Node transport confines these names to loopback without DNS.
    // https://w3c.github.io/webappsec-secure-contexts/#localhost
    if (host.kind === 'domain' && (
      host.value === 'localhost' || host.value === 'localhost.' ||
      host.value.endsWith('.localhost') || host.value.endsWith('.localhost.')
    )) return true;

    if (origin.scheme === 'file' || this.authenticatedSchemes.has(origin.scheme)) return true;
    return this.trustworthyOrigins.some((trustedOrigin) => areSameOrigin(origin, trustedOrigin));
  }

  // Secure Contexts: Is url potentially trustworthy?
  // https://w3c.github.io/webappsec-secure-contexts/#is-url-trustworthy
  isURLPotentiallyTrustworthy(url: URLRecord): boolean {
    if (url.scheme === 'about' && (url.path === 'blank' || url.path === 'srcdoc')) return true;
    if (url.scheme === 'data') return true;
    return this.isOriginPotentiallyTrustworthy(obtainURLOrigin(url));
  }

  /** Notify the current print subtree, preserving each phase's target snapshot across author callbacks. */
  #firePrintEvent(document: DocumentImpl, type: 'beforeprint' | 'afterprint'): void {
    // SPEC_CLASH(print-event-descendants): HTML names children only; follow Blink's recursive, synchronous phases.
    // SPEC_GAP(print-event-snapshots): Snapshot each phase separately and skip removed/replaced Documents before delivery.
    const documents = [document, ...document.getDescendantNavigables().map((navigable) => navigable.activeDocument!)];
    for (const target of documents) {
      if (!this.#isActivePrintTarget(document)) return;
      if (!this.#isActivePrintTarget(target, document)) continue;
      target.getRelevantGlobalObject()!.fireEvent(type);
    }
  }

  /** Check live embedding ancestry while removed-frame destruction remains an unfinished lifecycle step. */
  #isActivePrintTarget(target: DocumentImpl, root = target): boolean {
    if (!target.isFullyActive()) return false;
    let document = target;
    let includesRoot = false;
    for (;;) {
      if (document === root) includesRoot = true;
      const container = document.getNodeNavigable()!.container;
      if (container === null) return includesRoot;
      if (!container.isConnected) return false;
      document = container.nodeDocument;
    }
  }

  /** Allocate the agent and its cluster; its caller must still create and start the global. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#obtaining-a-worker/worklet-agent
  // outsideEnv is HTML's outside settings: the creator's environment, not the new global's.
  #obtainWorkerOrWorkletAgent(
    outsideEnv: BrowletEnvironment | null,
    isTopLevel: boolean,
    canBlock: boolean,
  ): Agent {
    let cluster: AgentCluster;
    if (isTopLevel) {
      cluster = new AgentCluster();
      cluster.isOriginKeyed = true;
    } else {
      const ownerCluster = outsideEnv?.realm.agent.agentCluster ?? null;
      if (ownerCluster === null) {
        throw new InternalError('A non-top-level worker or worklet requires its owner\'s agent cluster');
      }
      cluster = ownerCluster;
    }

    const AgentConstructor = canBlock
      ? (isTopLevel ? SharedWorkerAgent : DedicatedWorkerAgent)
      : (isTopLevel ? ServiceWorkerAgent : WorkletAgent);
    // PROVISIONAL: this allocates records and a host-driven loop on the current thread.
    // Worker/worklet processing must supply independent execution and termination.
    const agent = new AgentConstructor(this.#createEventLoop());
    cluster.add(agent);
    return agent;
  }

  /** Allocate an agent's loop using this host's task-turn scheduler. */
  #createEventLoop(): EventLoop {
    return new EventLoop({ requestTurn: queueNodeTask });
  }

  /** Retain copied reports and their original endpoint configuration until delivery finishes. */
  #queueReportDelivery(
    endpoint: ReportingEndpoint, origin: Origin, reports: ReportImpl[],
    configuration: ReportingEndpoint[],
  ): void {
    this.queueReportingTask(() => {
      if (!this.reportDeliveryEnabled) return;
      if (endpoint.failures > this.maxReportingEndpointFailures) {
        const index = configuration.indexOf(endpoint);
        if (index !== -1) configuration.splice(index, 1);
      }
      if (!configuration.includes(endpoint)) return;
      const cutoff = Date.now() - this.maxReportAge;
      const currentReports = reports.filter((report) => report.timestamp >= cutoff);
      if (currentReports.length === 0) return;
      this.attemptReportDelivery(endpoint, origin, currentReports).observe((result) => {
        if (result === 'success') {
          endpoint.failures = 0;
        } else if (result === 'remove-endpoint') {
          const index = configuration.indexOf(endpoint);
          if (index !== -1) configuration.splice(index, 1);
        } else {
          endpoint.failures++;
        }
        // The draft leaves retries unresolved. Finishing this callback releases
        // the attempt; later reports may still use a surviving endpoint.
      }, (error) => { throw error; });
    });
  }
}

/** Construct the browser owner and its stores in this isolate. */
export const UserAgent = BrowletUserAgent;

/** Complete browser services, independent of the local or worker implementation's private state. */
export type UserAgent = Public<BrowletUserAgent>;

/** Outcome of one delivery attempt; the caller applies endpoint bookkeeping. */
export type ReportDeliveryResult = 'success' | 'remove-endpoint' | 'failure';

// eslint-disable-next-line no-restricted-globals -- Permission consent is supplied by the Node host.
const NativePromise = Promise;

/** Answer a new permission request; true grants it, false denies it. */
export type PermissionPrompt = (request: {
  /** Converted descriptor; the host must not mutate it. */
  descriptor: PermissionDescriptor;
  /** Serialized requesting origin. */
  origin: string;
  /** Serialized top-level origin, which may differ for embedded requests. */
  topLevelOrigin: string;
}) => boolean | Promise<boolean>;

/** Present a feature's options; return original values, an empty selection, or denied. */
export type PermissionChooser = <T>(request: PermissionChoiceRequest<T> & {
  /** Serialized requesting origin. */
  origin: string;
  /** Serialized top-level origin. */
  topLevelOrigin: string;
}) => PermissionSelection<T> | Promise<PermissionSelection<T>>;
