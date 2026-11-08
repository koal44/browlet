import { InternalError, assertNever, type Public } from '../../../infra/index';
import { hasErrorData, JSMessageChannel, JSMessagePort, NodePromise, randomUUID, type JSMessagePortHandle, type JSTransferable } from '../../../js-engine/index';
import { unsafeSharedCurrentTime } from '../../../timing/index';
import { copyOrigin, copyURL, parseURL, serializeURL, type BlobURLEntry as URLBlobURLEntry, type Origin, type URLRecord } from '../../../url/index';
import { BlobData, BlobImpl, type BlobSnapshotState, type SerializedBlobData } from '../../../file/index';
import { fetch, FetchGroup, FetchRequest } from '../../../fetch/index';

import { ScriptingPolicy, type ScriptSourceCallback } from '../../scripting/index';
import { ContentSecurityPolicy, type ContentSecurityPolicySnapshot } from '../../browsing/policy/csp/index';
import { PolicyContainer } from '../../browsing/policy/index';
import type { BrowletEnvironment, WorkerEnvironmentBase } from '../../environment/index';
import { nodeTimerHost, queueNodeTask } from '../host/index';
import type { BlobURLEntry, BlobURLStore } from '../file/index';
import type { UserAgent } from '../../user-agent';

import { WorkerBroadcastChannels, WorkerBroadcastChannelConnection, type WorkerBroadcastRequest } from './broadcast-channel';
import { WorkerScriptFetchEnvironment, captureScriptResponse, restoreScriptResponse } from './script-fetch';
import type { WorkerImportedScriptFetch, ScriptResponseSnapshot } from './protocol';

/**
 * Worker-local access to the existing browser owner, without duplicating its stores.
 * Calls block this worker only; the owner must remain free to service its host queue.
 */
export class WorkerUserAgent implements UserAgent {
  /** Host continuations and wake-ups belong to the isolate executing them. */
  HostPromise = NodePromise;
  runInParallel = queueNodeTask;
  timerHost = nodeTimerHost;
  /** The browser's shared preference remains readable even while its host thread is busy. */
  scriptingPolicy: ScriptingPolicy;
  /** Discovery delegates to the browser; local native receivers only queue HTML delivery. */
  broadcastChannels = new WorkerBroadcastChannels(
    (request, transferList) => { this.#request(request, transferList); },
    (id) => {
      if (Atomics.load(this.#state, 0) !== closed) this.#port.send({ type: 'broadcast-release', id });
    },
  );
  /** All public Blob store operations, forwarded or explicitly unavailable in this isolate. */
  blobURLStore: Public<BlobURLStore> = {
    resolve: (url: URLRecord) => this.#resolve(url),
    revoke: (url: string) => { this.revokeObjectURL(url); },
    add: (object: BlobImpl) => this.#registerBlob(object),
    /** Standalone generation is not needed by the acknowledged registration operation. */
    generateURL: (): never => unconnected('Blob URL generation'),
    /** Internal removals require their owning browser's registration service. */
    remove: (): never => unconnected('Blob URL removal'),
    /** The browser-side connection owns environment cleanup when this isolate exits. */
    removeForEnvironment: (): never => unconnected('Blob URL environment cleanup'),
  };
  /** Dedicated private endpoint; no author events or asynchronous listener consume replies. */
  #port: JSMessagePort<WorkerUserAgentMessage>;
  /** Shared request state; closing either endpoint wakes a blocked requester. */
  #state: Int32Array<SharedArrayBuffer>;
  /** Drop an owner's capture once its last local URL record becomes unreachable. */
  #captures: FinalizationRegistry<number>;
  /** Only records captured by this connection can select one of its owner-side registrations. */
  #entryIds = new WeakMap<URLBlobURLEntry, number>();

  /** Adopt the endpoint transferred from the browser owner, together with its wake-up cell. */
  constructor(init: WorkerUserAgentInit) {
    this.#port = new JSMessagePort(init.port);
    this.#state = init.state;
    this.scriptingPolicy = new ScriptingPolicy(init.scriptingPolicy);
    this.#captures = new FinalizationRegistry((id) => {
      if (Atomics.load(this.#state, 0) === closed) return;
      this.#port.send({ type: 'release', id });
    });
  }

  /** Read live browser configuration rather than copying a startup preference. */
  get defaultUserAgentValue(): string { return this.#settings().defaultUserAgentValue; }
  get navigatorPlatform(): string { return this.#settings().navigatorPlatform; }
  get preferredLanguages(): readonly [string, ...string[]] { return this.#settings().preferredLanguages; }
  get defaultAcceptLanguage(): string | null { return this.#settings().defaultAcceptLanguage; }
  get assumeNoInternetConnectivity(): boolean { return this.#settings().assumeNoInternetConnectivity; }
  get cookiesEnabled(): boolean { return this.#settings().cookiesEnabled; }
  get reportDeliveryEnabled(): boolean { return this.#settings().reportDeliveryEnabled; }
  get storageEnabled(): boolean { return this.#settings().storageEnabled; }
  get storageQuotaBytes(): number { return this.#settings().storageQuotaBytes; }
  get maxReportAge(): number { return this.#settings().maxReportAge; }
  get maxReportingEndpointFailures(): number { return this.#settings().maxReportingEndpointFailures; }
  get betweenLoadsSharedWorkerTimeout(): number { return this.#settings().betweenLoadsSharedWorkerTimeout; }
  get extendedLifetimeSharedWorkerTimeout(): number { return this.#settings().extendedLifetimeSharedWorkerTimeout; }

  // These owners cannot be replaced with independent worker-local stores.
  // TODO(HTML workers): Route Fetch, permissions, storage and reports
  // through their owning browser services before exposing their worker APIs.
  /** Worker globals do not own a Document tree or expose the Window DOM interfaces. */
  get dom(): never { return unconnected('Document DOM'); }
  /** Network operations need the browser's Fetch transport. */
  get httpTransport(): never { return unconnected('Fetch'); }
  get supportedContentCodings(): never { return unconnected('Fetch'); }
  get createContentDecoder(): never { return unconnected('Fetch'); }
  get potentiallyOverrideResponse(): never { return unconnected('Fetch'); }
  get handleFetch(): never { return unconnected('Fetch'); }
  get determineFetchPriority(): never { return unconnected('Fetch'); }
  get supportsMIMEType(): never { return unconnected('Fetch'); }
  get connectionPool(): never { return unconnected('Fetch'); }
  get httpAuthentication(): never { return unconnected('Fetch'); }
  get httpCache(): never { return unconnected('Fetch'); }
  get corsPreflightCache(): never { return unconnected('Fetch'); }
  get cookieStore(): never { return unconnected('cookies'); }
  get hstsStore(): never { return unconnected('Fetch'); }
  /** Powerful-feature decisions require the browser's permission store. */
  get permissionStore(): never { return unconnected('permissions'); }
  get permissionStatuses(): never { return unconnected('permissions'); }
  get promptForPermission(): never { return unconnected('permissions'); }
  get choosePermissionOptions(): never { return unconnected('permissions'); }
  /** Shared storage must retain the original browser's partition and lifetime. */
  get storageShed(): never { return unconnected('storage'); }
  get storageObjects(): never { return unconnected('storage'); }
  /** Report delivery and clientless Fetch require a browser-side execution owner. */
  get sandbox(): never { return unconnected('clientless Fetch'); }
  get sendReports(): never { return unconnected('reporting'); }
  get createPolicyContainerFromResponse(): never { return unconnected('response policy inheritance'); }
  get createPotentialCORSRequest(): never { return unconnected('clientless Fetch'); }
  get obtainBlobObject(): never { return unconnected('Blob backing'); }
  get webDriverBiDiCloneNetworkRequestBody(): never { return unconnected('WebDriver network'); }
  get webDriverBiDiBeforeRequestSent(): never { return unconnected('WebDriver network'); }
  get webDriverBiDiCloneNetworkResponseBody(): never { return unconnected('WebDriver network'); }
  get webDriverBiDiFetchError(): never { return unconnected('WebDriver network'); }
  get webDriverBiDiResponseStarted(): never { return unconnected('WebDriver network'); }
  get webDriverBiDiResponseCompleted(): never { return unconnected('WebDriver network'); }

  /** Preference changes and Window facilities remain with the original browser owner. */
  get protocolHandlers(): never { return unconnected('protocolHandlers'); }

  /** WebDriver BiDi command implementation; separate from Browlet's convenience API. Not connected in workers. */
  get webDriver(): never { return unconnected('webDriver'); }
  /** Local clients notified of document replacement; not WebDriver session state. Not connected in workers. */
  get pageEvaluations(): never { return unconnected('pageEvaluations'); }
  /** Configurable CSS system colors, independent of the machine running Browlet. Not connected in workers. */
  get systemColors(): never { return unconnected('systemColors'); }
  /** Related-context groups currently retained by this browser. Not connected in workers. */
  get browsingContextGroupSet(): never { return unconnected('browsingContextGroupSet'); }
  /** Top-level windows or tabs owned by this browser. Not connected in workers. */
  get topLevelTraversableSet(): never { return unconnected('topLevelTraversableSet'); }
  /** Reject new-window requests without transient activation, independently of sandbox restrictions. Not connected in workers. */
  get popupBlockerEnabled(): never { return unconnected('popupBlockerEnabled'); }
  /** Destination policy after popup and sandbox checks; existing named targets are unaffected. Not connected in workers. */
  get newNavigablePolicy(): never { return unconnected('newNavigablePolicy'); }
  /** Configured document handling by MIME essence; XML/JSON entries count as explicitly supported types. Not connected in workers. */
  get documentTypeHandlers(): never { return unconnected('documentTypeHandlers'); }
  /** Whether a PDF viewer is available; Browlet currently has no viewer. Not connected in workers. */
  get pdfViewerSupported(): never { return unconnected('pdfViewerSupported'); }
  /** Browser binding factory used by browsing algorithms to create Window environments. Not connected in workers. */
  get createWindowEnvironment(): never { return unconnected('createWindowEnvironment'); }
  /** Shared input lifetimes and button state, independent of author-created events. Not connected in workers. */
  get activePointers(): never { return unconnected('activePointers'); }
  /** Origin-wide persistence decisions, independent of individual documents and stored data. Not connected in workers. */
  get storagePersistence(): never { return unconnected('storagePersistence'); }
  /** Scroll-container expansion used when a document creates its lazy-loading observer. Not connected in workers. */
  get lazyLoadScrollMargin(): never { return unconnected('lazyLoadScrollMargin'); }
  /** Render-blocking cutoff in milliseconds from the relevant global's time origin. Not connected in workers. */
  get renderBlockingTimeout(): never { return unconnected('renderBlockingTimeout'); }
  /** Policy ceiling in milliseconds for a Service Worker running without clients. Not connected in workers. */
  get serviceWorkerWithoutClientsTimeout(): never { return unconnected('serviceWorkerWithoutClientsTimeout'); }
  /** Schemes whose tuple origins come from an authenticated protocol implementation. Not connected in workers. */
  get authenticatedSchemes(): never { return unconnected('authenticatedSchemes'); }
  /** Development origins explicitly configured as potentially trustworthy. Not connected in workers. */
  get trustworthyOrigins(): never { return unconnected('trustworthyOrigins'); }
  /** Read or update the browser preference through the already-shared scripting-policy cell. */
  get scriptingEnabled(): boolean { return this.scriptingPolicy.enabled; }
  set scriptingEnabled(value: boolean) { this.scriptingPolicy.enabled = value; }
  /** Unavailable on the worker connection; fail explicitly if this browser facility is requested. */
  get mouseInput(): never { return unconnected('mouseInput'); }
  /** Unavailable on the worker connection; fail explicitly if this browser facility is requested. */
  get keyboardInput(): never { return unconnected('keyboardInput'); }
  /** Unavailable on the worker connection; fail explicitly if this browser facility is requested. */
  get pointerLock(): never { return unconnected('pointerLock'); }
  /** Unavailable on the worker connection; fail explicitly if this browser facility is requested. */
  get systemClipboard(): never { return unconnected('systemClipboard'); }
  /** Node host consent hook; a browser without a configured prompt declines new requests. Not connected in workers. */
  get onPermissionPrompt(): never { return unconnected('onPermissionPrompt'); }
  /** Node host chooser; absent UI denies selection. Pending UI cancellation is the same dependency as prompting. Not connected in workers. */
  get onPermissionChoice(): never { return unconnected('onPermissionChoice'); }

  /** Browser automation must select the actual worker client, not its creator. */
  get webDriverBiDiNetworkIsOffline(): never { return unconnected('WebDriver network'); }
  get webDriverBiDiEmulatedUserAgent(): never { return unconnected('WebDriver network'); }
  get webDriverBiDiEmulatedLanguage(): never { return unconnected('WebDriver network'); }

  /** Window UI and global preference updates are not worker-owned operations. */
  setPreferredLanguages(): never { return unconnected('setPreferredLanguages'); }
  setOffline(): never { return unconnected('setOffline'); }
  registerProtocolHandler(): never { return unconnected('registerProtocolHandler'); }
  unregisterProtocolHandler(): never { return unconnected('unregisterProtocolHandler'); }
  requestProtocolHandlerConsent(): never { return unconnected('requestProtocolHandlerConsent'); }
  verifyProtocolHandlerAutomation(): never { return unconnected('verifyProtocolHandlerAutomation'); }
  showAlert(): never { return unconnected('showAlert'); }
  showConfirm(): never { return unconnected('showConfirm'); }
  showPrompt(): never { return unconnected('showPrompt'); }
  runPrintingSteps(): never { return unconnected('runPrintingSteps'); }
  obtainPhysicalForm(): never { return unconnected('obtainPhysicalForm'); }

  /** Release an existing lock after DOM unlinking without allocating an unused controller. Not connected in workers. */
  releaseDisconnectedPointerLock(): never { return unconnected('releaseDisconnectedPointerLock'); }
  /** Obtain an unrandomized assessment of this navigation's transient conditions, or null if unavailable. Not connected in workers. */
  getUnderlyingNavigationTimingConfidence(): never { return unconnected('getUnderlyingNavigationTimingConfidence'); }
  /** Recheck live results after a decision or feature-specific constraint changes. Not connected in workers. */
  notifyPermissionStateChanged(): never { return unconnected('notifyPermissionStateChanged'); }
  /** Apply an automation decision to the supplied candidate environments for this browser. Not connected in workers. */
  setPermission(): never { return unconnected('setPermission'); }
  /** Create an Agent with its own microtask queue and running browser event loop. Not connected in workers. */
  createWindowAgent(): never { return unconnected('createWindowAgent'); }
  /** Allocate a dedicated worker in its creator's cluster, or a shared worker in a new cluster. Not connected in workers. */
  obtainDedicatedOrSharedWorkerAgent(): never { return unconnected('obtainDedicatedOrSharedWorkerAgent'); }
  /** Nested creation needs ownership propagation and a surviving direct browser-service connection. */
  runWorker(): never {
    throw new InternalError('Nested worker startup requires ownership and direct browser-service forwarding');
  }
  /** Allocate one worklet agent in its creator's cluster. Not connected in workers. */
  obtainWorkletAgent(): never { return unconnected('obtainWorkletAgent'); }
  /** Allocate a service worker in a new cluster without an outside environment. Not connected in workers. */
  obtainServiceWorkerAgent(): never { return unconnected('obtainServiceWorkerAgent'); }
  /** Register a group before its initial browsing context and Document are created. Not connected in workers. */
  createBrowsingContextGroup(): never { return unconnected('createBrowsingContextGroup'); }
  /** Create a new tab/window and request its initial navigation from its own about:blank Document. Not connected in workers. */
  createFreshTopLevelTraversable(): never { return unconnected('createFreshTopLevelTraversable'); }
  /** Create an element's child through the navigation layer. Not connected in workers. */
  createChildNavigable(): never { return unconnected('createChildNavigable'); }
  /** Destroy a container's child through the navigation layer. Not connected in workers. */
  destroyChildNavigable(): never { return unconnected('destroyChildNavigable'); }
  /** Request top-level destruction without applying script-closing authorization. Not connected in workers. */
  destroyTopLevelTraversable(): never { return unconnected('destroyTopLevelTraversable'); }
  /** Unavailable on the worker connection; fail explicitly if this browser operation is requested. */
  appendTopLevelTraversable(): never { return unconnected('appendTopLevelTraversable'); }
  /** Remove a tab/window presentation when a UI host is attached. Not connected in workers. */
  removeTopLevelTraversableFromUI(): never { return unconnected('removeTopLevelTraversableFromUI'); }
  /** Unregister a traversable and clear its session storage after document teardown has been requested. Not connected in workers. */
  removeTopLevelTraversable(): never { return unconnected('removeTopLevelTraversable'); }
  /** Release an empty group after its last top-level context has been removed. Not connected in workers. */
  removeBrowsingContextGroup(): never { return unconnected('removeBrowsingContextGroup'); }
  /** Remove top-level contexts after all their Documents are destroyed and their WindowProxy is collectible. Not connected in workers. */
  collectBrowsingContexts(): never { return unconnected('collectBrowsingContexts'); }
  /** Refresh browser UI displaying URLs or derived data affected by this document's base URL. Not connected in workers. */
  updateURLDisplays(): never { return unconnected('updateURLDisplays'); }
  /** Whether initial fragment scrolling still serves the user's intent for this Document. Not connected in workers. */
  isUserInterestedInFragmentScrolling(): never { return unconnected('isUserInterestedInFragmentScrolling'); }
  /** Apply browser download policy after the source and destination sandboxes allow it. Not connected in workers. */
  isNavigationDownloadAllowed(): never { return unconnected('isNavigationDownloadAllowed'); }
  /** Handle a permitted response as a download without creating a Document. Not connected in workers. */
  handleAsDownload(): never { return unconnected('handleAsDownload'); }
  /** Decide whether handling this URL leaves its destination navigable unchanged. Not connected in workers. */
  shouldHandleURLExternally(): never { return unconnected('shouldHandleURLExternally'); }
  /** Choose inline error/native content or external handling when no built-in document loader matches. Not connected in workers. */
  shouldDisplayUnsupportedResourceInline(): never { return unconnected('shouldDisplayUnsupportedResourceInline'); }
  /** Apply the destination sandbox before requesting an external handoff of a URL or response. Not connected in workers. */
  handoffToExternalSoftware(): never { return unconnected('handoffToExternalSoftware'); }
  /** Ask the host to confirm and perform an allowed external handoff. Not connected in workers. */
  requestExternalSoftwareHandoff(): never { return unconnected('requestExternalSoftwareHandoff'); }
  /** Coordinate navigation/closing checks with browser-owned completion across the Documents' event loops. Not connected in workers. */
  checkIfUnloadingIsCanceled(): never { return unconnected('checkIfUnloadingIsCanceled'); }
  /** Whether an otherwise eligible unload prompt is unlikely to be annoying, deceptive, or pointless. Not connected in workers. */
  shouldShowBeforeUnloadPrompt(): never { return unconnected('shouldShowBeforeUnloadPrompt'); }
  /** Synchronously ask the user to confirm unloading, from inside the owning event loop's pause. Not connected in workers. */
  requestUnloadConfirmation(): never { return unconnected('requestUnloadConfirmation'); }
  /** Run browser-owned reporting work on a later host turn, yielding to runnable page tasks. Not connected in workers. */
  queueReportingTask(): never { return unconnected('queueReportingTask'); }
  /** Attempt delivery and return its outcome without changing endpoint bookkeeping. Not connected in workers. */
  attemptReportDelivery(): never { return unconnected('attemptReportDelivery'); }
  /** Maximum simultaneous contacts supported by any individual digitizer, not their sum Not connected in workers. */
  getMaxTouchPoints(): never { return unconnected('getMaxTouchPoints'); }
  /** Touch-capacity override selected for the given environment, or null when absent. Not connected in workers. */
  webDriverBiDiEmulatedMaxTouchPoints(): never { return unconnected('webDriverBiDiEmulatedMaxTouchPoints'); }
  /** Notify automation of a prompt and select its configured handling, or leave confirmation to the host. Not connected in workers. */
  webDriverBiDiUserPromptOpened(): never { return unconnected('webDriverBiDiUserPromptOpened'); }
  /** Notify automation that a prompt was accepted or dismissed. Not connected in workers. */
  webDriverBiDiUserPromptClosed(): never { return unconnected('webDriverBiDiUserPromptClosed'); }
  /** Notify automation after a new navigable has been initialized and registered. Not connected in workers. */
  webDriverBiDiNavigableCreated(): never { return unconnected('webDriverBiDiNavigableCreated'); }
  /** Notify automation after a navigable's destruction has been requested. Not connected in workers. */
  webDriverBiDiNavigableDestroyed(): never { return unconnected('webDriverBiDiNavigableDestroyed'); }
  /** Notify automation that an identified navigation has started. Not connected in workers. */
  webDriverBiDiNavigationStarted(): never { return unconnected('webDriverBiDiNavigationStarted'); }
  /** Notify automation after a new Document's history state has been initialized. Not connected in workers. */
  webDriverBiDiNavigationCommitted(): never { return unconnected('webDriverBiDiNavigationCommitted'); }
  /** Notify automation that a navigation failed before committing. Not connected in workers. */
  webDriverBiDiNavigationFailed(): never { return unconnected('webDriverBiDiNavigationFailed'); }
  /** Notify automation after a fragment navigation's joint-history work completes. Not connected in workers. */
  webDriverBiDiFragmentNavigated(): never { return unconnected('webDriverBiDiFragmentNavigated'); }
  /** Notify automation after a synchronous URL/history update has been finalized. Not connected in workers. */
  webDriverBiDiHistoryUpdated(): never { return unconnected('webDriverBiDiHistoryUpdated'); }
  /** Notify automation that an identified navigation was canceled. Not connected in workers. */
  webDriverBiDiNavigationAborted(): never { return unconnected('webDriverBiDiNavigationAborted'); }
  /** Classify a new Window using the incoming Document's origin. Not connected in workers. */
  computeWindowSecureContext(): never { return unconnected('computeWindowSecureContext'); }

  /** Host UUIDs remain unique without a browser-owned counter. */
  generateUUID(): string { return randomUUID(); }

  /** All isolates use the host's shared monotonic coordinate system. */
  unsafeSharedCurrentTime(): number { return unsafeSharedCurrentTime().milliseconds; }

  /** Fresh policy containers have no remote identity or store to copy. */
  createPolicyContainer(): PolicyContainer { return new PolicyContainer(); }

  /** Browlet currently has no worker BiDi override; preserve the existing explicit default. */
  // SPEC_GAP(worker-bidi-scripting): BiDi selects a navigable through a Document;
  // define worker scope before transporting overrides, without borrowing its creator.
  webDriverBiDiScriptingIsEnabled(): boolean { return true; }

  /** Query the owning browser's current navigable activity for worker lifetime decisions. */
  hasLoadingNavigable(): boolean { return this.#settings().hasLoadingNavigable; }

  /** Use the original browser's live configured trust policy. */
  isOriginPotentiallyTrustworthy(origin: Origin): boolean {
    const response = this.#request({ type: 'trust-origin', origin });
    if (response.type !== 'boolean') throw new InternalError('Unexpected origin trust reply');
    return response.value;
  }

  /** Apply URL-specific exemptions at the owner as well as its origin trust policy. */
  isURLPotentiallyTrustworthy(url: URLRecord): boolean {
    const snapshot = copyURL(url);
    // Trust needs the captured origin, including opaque identity. Do not send
    // the local entry's methods/getters or re-resolve a revoked registration.
    if (snapshot.blobURLEntry !== null) {
      snapshot.blobURLEntry = { env: { origin: snapshot.blobURLEntry.env.origin } };
    }
    const response = this.#request({ type: 'trust-url', url: snapshot });
    if (response.type !== 'boolean') throw new InternalError('Unexpected URL trust reply');
    return response.value;
  }

  /** Use the ordinary URL parser; only Blob registration access crosses the channel. */
  parseURL(input: string, base: URLRecord | null = null, encoding = 'UTF-8'): URLRecord | null {
    return parseURL(input, base, encoding, this).url;
  }

  /** Finish the owner's same-partition revocation before returning to worker code. */
  revokeObjectURL(url: string): void {
    this.#request({ type: 'revoke', url });
  }

  /** Select a retained registration for creator-side Fetch without resolving a revoked URL again. */
  getBlobEntryId(entry: URLBlobURLEntry | null): number | null {
    return entry === null ? null : this.#entryIds.get(entry) ?? null;
  }

  /** Wait for browser Fetch without entering this isolate's event loop, then deliver consumed bytes. */
  fetchImportedScript(request: FetchRequest, onResponse: ScriptSourceCallback, env: BrowletEnvironment): void {
    const url = copyURL(request.url);
    const blobEntryId = this.getBlobEntryId(url.blobURLEntry);
    url.blobURLEntry = null;
    const apiBaseURL = copyURL(env.apiBaseURL);
    apiBaseURL.blobURLEntry = null;
    const result = this.#request({
      type: 'fetch-imported-script',
      request: {
        url,
        blobEntryId,
        client: {
          apiBaseURL,
          policyContainer: env.policyContainer.toSnapshot(),
          hasCrossSiteAncestor: env.hasCrossSiteAncestor,
          crossOriginIsolatedCapability: env.crossOriginIsolatedCapability,
          upgradeInsecureRequests: env.insecureRequestsPolicy.upgrade,
        },
      },
    });
    if (result.type !== 'script') throw new InternalError('Unexpected worker script reply');
    for (const policy of result.violations) {
      ContentSecurityPolicy.fromSnapshot(policy).createViolationForRequest(request, env).report();
    }
    onResponse(restoreScriptResponse(result.snapshot), result.snapshot.bodyBytes);
  }

  /** Release this connection and all registrations retained on its behalf. */
  close(): void {
    this.broadcastChannels.disconnect();
    Atomics.store(this.#state, 0, closed);
    Atomics.notify(this.#state, 0);
    this.#port.close();
  }

  /** Perform one non-reentrant host call without pumping author callbacks or Promise reactions. */
  #request(request: WorkerUserAgentRequest, transferList: JSTransferable[] = []): WorkerUserAgentResult {
    if (Atomics.compareExchange(this.#state, 0, idle, pending) !== idle) {
      throw new InternalError('Worker UserAgent connection is closed or already in use');
    }
    try {
      try { this.#port.send(request, transferList); }
      catch (error) {
        // Native serialization can reject an unsupported backing before posting.
        // No reply will arrive; leave the connection usable for the next call.
        Atomics.compareExchange(this.#state, 0, pending, idle);
        throw error;
      }
      while (Atomics.load(this.#state, 0) === pending) Atomics.wait(this.#state, 0, pending);
      const response = this.#port.receive()?.message;
      if (response?.type !== 'response') throw new InternalError('Worker UserAgent connection closed before replying');
      if (response.error !== null) throw new InternalError(response.error);
      return response.result;
    } finally {
      // Never overwrite a concurrent close with a reusable state.
      Atomics.compareExchange(this.#state, 0, replied, idle);
    }
  }

  /** Register portable File API backing synchronously with this worker's browser-side owner. */
  #registerBlob(object: BlobImpl): string {
    const state = object.getSerializationState();
    const response = this.#request({
      type: 'register-blob',
      data: state.data.serialize(),
      contentType: state.type,
      snapshotState: state.snapshotState,
    });
    if (response.type !== 'url') throw new InternalError('Unexpected Blob registration reply');
    return response.url;
  }

  /** Each capture is independently collectible, even when lookups share one owner-side handle. */
  #resolve(url: URLRecord): Public<BlobURLEntry> | null {
    const response = this.#request({ type: 'resolve', url: serializeURL(url) });
    if (response.type !== 'entry') throw new InternalError('Unexpected Blob lookup reply');
    if (response.entry === null) return null;
    // Reconstruct the public service locally; functions cannot cross the port.
    // Only the creator's origin is transported. Its environment and Blob backing
    // remain with the owner, so unsupported access must not fabricate either.
    const entry: Public<BlobURLEntry> = {
      env: {
        origin: response.entry.env.origin,
        /** The creator's browser services have not been connected through this entry. */
        get userAgent(): never { return unconnected('Blob creator UserAgent'); },
        /** The creator's creation URL is not included in registration metadata. */
        get creationURL(): never { return unconnected('Blob creator URL'); },
        /** Creator policy inheritance must be requested from the browser owner. */
        get policyContainer(): never { return unconnected('Blob creator policy'); },
      },
      /** The actual Blob and its access checks remain in the owning isolate. */
      obtainObject: (): never => unconnected('Blob backing'),
      /** Partition checks require the supplied caller's identity at the owner. */
      isSamePartition: (): never => unconnected('Blob partition access'),
    };
    this.#entryIds.set(entry, response.entry.id);
    this.#captures.register(entry, response.entry.id);
    return entry;
  }

  /** Scalar preferences are small live replies; shared stores are never serialized as settings. */
  #settings(): WorkerBrowserSettings {
    const response = this.#request({ type: 'settings' });
    if (response.type !== 'settings') throw new InternalError('Unexpected browser settings reply');
    return response.settings;
  }
}

/** Browser-side ownership of one worker's private shared-service connection. */
export class WorkerUserAgentConnection {
  /** Transfer port in the thread's transfer list; the shared state is cloned, not transferred. */
  init: WorkerUserAgentInit;
  /** Remote channel registrations are owned and released with this worker's service connection. */
  #broadcastChannels: WorkerBroadcastChannelConnection;
  /** The real browser owner; its stores are never copied into the worker. */
  #userAgent: UserAgent;
  /** Actual worker identity, origin and response policies retained by the browser. */
  #env: WorkerEnvironmentBase;
  /** Imported requests and any background revalidations share this worker's connection lifetime. */
  #scriptFetchGroup = new FetchGroup();
  /** Browser endpoint, serviced independently of HTML task and microtask queues. */
  #port: JSMessagePort<WorkerUserAgentMessage>;
  /** Untransferred endpoints also need cleanup if thread creation fails. */
  #workerPort: JSMessagePort<WorkerUserAgentMessage>;
  /** Captured registrations survive revocation while their worker-side URL records or fetches remain live. */
  #entries = new Map<number, { entry: Public<BlobURLEntry>; captures: number; }>();
  /** Repeated resolutions identify the same retained registration. */
  #entryIds = new WeakMap<Public<BlobURLEntry>, number>();
  /** Connection-local registration handles are never used as global identities. */
  #nextEntryId = 0;
  /** Detach native listeners during explicit close or peer shutdown. */
  #stop: () => void;

  /** Bind a fresh endpoint to the browser and the caller's already-established environment. */
  constructor(userAgent: UserAgent, isEligibleForMessaging: (() => boolean) | undefined, env: WorkerEnvironmentBase) {
    this.#userAgent = userAgent;
    this.#env = env;
    this.#broadcastChannels = new WorkerBroadcastChannelConnection(userAgent, isEligibleForMessaging, env);
    const channel = new JSMessageChannel<WorkerUserAgentMessage>();
    this.#port = channel.port1;
    this.#workerPort = channel.port2;
    this.init = {
      port: channel.port2.handle, state: new Int32Array(new SharedArrayBuffer(4)),
      scriptingPolicy: userAgent.scriptingPolicy.sharedState,
    };
    this.#stop = this.#port.listen({
      onMessage: (message) => this.#respond(message),
      onMessageError: () => this.close(),
      onClose: () => this.close(),
    });
  }

  /** Resolve a previously captured handle in its owning isolate, even after URL revocation. */
  getBlobEntry(id: number): Public<BlobURLEntry> | null {
    return this.#entries.get(id)?.entry ?? null;
  }

  /** Wake an outstanding call and drop this worker's retained entries and native endpoints. */
  close(): void {
    Atomics.store(this.init.state, 0, closed);
    Atomics.notify(this.init.state, 0);
    this.#stop();
    this.#port.close();
    this.#workerPort.close();
    this.#entries.clear();
    this.#broadcastChannels.close();
    // SPEC_GAP(file-worker-blob-url-lifetime): File API names Document unloading.
    // Chromium, Firefox and WebKit also remove worker registrations when their
    // execution context is destroyed, for both
    // close() and terminate(); this native-exit path covers both.
    // https://w3c.github.io/FileAPI/#lifeTime
    this.#userAgent.blobURLStore.removeForEnvironment(this.#env);
    this.#scriptFetchGroup.terminate();
  }

  /** Consume the complete script on the browser's host queue while the requesting isolate is blocked. */
  #fetchImportedScript(input: WorkerImportedScriptFetch): void {
    const client = new WorkerScriptFetchEnvironment(input.client, this.#scriptFetchGroup, this.#env);
    const url = copyURL(input.url);
    if (url.scheme === 'blob') url.blobURLEntry = input.blobEntryId === null ? null : this.getBlobEntry(input.blobEntryId);
    const owner = this.#userAgent.sandbox;
    const request = new FetchRequest(url, owner);
    request.client = client;
    request.destination = 'script';
    request.initiatorType = 'other';
    request.parserInserted = false;
    request.useURLCredentials = true;
    fetch(request, {
      useParallelQueue: true,
      processResponseConsumeBody: (response, bodyBytes) => {
        this.#reply({ type: 'script', snapshot: captureScriptResponse(response, bodyBytes), violations: client.violations });
      },
    }, owner);
  }

  /** Handle only explicit operations; arbitrary property reads and function calls are not forwarded. */
  #respond(message: WorkerUserAgentMessage): void {
    if (Atomics.load(this.init.state, 0) === closed) return;
    if (message.type === 'broadcast-release') {
      this.#broadcastChannels.handle({ type: 'broadcast-close', id: message.id });
      return;
    }
    if (message.type === 'release') {
      const retained = this.#entries.get(message.id);
      if (retained !== undefined && --retained.captures === 0) this.#entries.delete(message.id);
      return;
    }
    let result: WorkerUserAgentResult = { type: 'void' };
    let error: string | null = null;
    try {
      switch (message.type) {
        case 'fetch-imported-script':
          this.#fetchImportedScript(message.request);
          return;
        case 'register-blob': {
          // The browser sandbox owns retained byte reads, independently of either
          // page activity or worker shutdown. The registration keeps the worker
          // environment separately for origin, policy inheritance and cleanup.
          const object = BlobImpl.create(BlobData.deserialize(message.data), message.contentType,
            message.snapshotState, this.#userAgent.sandbox);
          result = { type: 'url', url: this.#userAgent.blobURLStore.add(object, this.#env) };
          break;
        }
        case 'broadcast-register':
        case 'broadcast-send':
        case 'broadcast-close':
          this.#broadcastChannels.handle(message);
          break;
        case 'resolve': {
          const url = parseURL(message.url).url;
          if (url?.scheme !== 'blob') throw new InternalError('Blob lookup requires a Blob URL');
          const registration = this.#userAgent.blobURLStore.resolve(url);
          if (registration !== null) {
            let id = this.#entryIds.get(registration);
            if (id === undefined) {
              id = this.#nextEntryId++;
              this.#entryIds.set(registration, id);
            }
            const retained = this.#entries.get(id) ?? { entry: registration, captures: 0 };
            retained.captures++;
            this.#entries.set(id, retained);
            result = { type: 'entry', entry: { id, env: { origin: copyOrigin(registration.env.origin) } } };
          } else {
            result = { type: 'entry', entry: null };
          }
          break;
        }
        case 'revoke':
          this.#userAgent.blobURLStore.revoke(message.url, this.#env);
          break;
        case 'trust-origin':
          result = { type: 'boolean', value: this.#userAgent.isOriginPotentiallyTrustworthy(message.origin) };
          break;
        case 'trust-url':
          result = { type: 'boolean', value: this.#userAgent.isURLPotentiallyTrustworthy(message.url) };
          break;
        case 'settings': {
          const owner = this.#userAgent;
          result = {
            type: 'settings', settings: {
              defaultUserAgentValue: owner.defaultUserAgentValue,
              navigatorPlatform: owner.navigatorPlatform,
              preferredLanguages: [...owner.preferredLanguages],
              defaultAcceptLanguage: owner.defaultAcceptLanguage,
              assumeNoInternetConnectivity: owner.assumeNoInternetConnectivity,
              cookiesEnabled: owner.cookiesEnabled,
              reportDeliveryEnabled: owner.reportDeliveryEnabled,
              storageEnabled: owner.storageEnabled,
              storageQuotaBytes: owner.storageQuotaBytes,
              maxReportAge: owner.maxReportAge,
              maxReportingEndpointFailures: owner.maxReportingEndpointFailures,
              betweenLoadsSharedWorkerTimeout: owner.betweenLoadsSharedWorkerTimeout,
              extendedLifetimeSharedWorkerTimeout: owner.extendedLifetimeSharedWorkerTimeout,
              hasLoadingNavigable: owner.hasLoadingNavigable(),
            },
          };
          break;
        }
        case 'response':
          throw new InternalError('Unexpected reply to the browser UserAgent');
        default:
          assertNever(message);
      }
    } catch (cause) {
      error = hasErrorData(cause) ? cause.message : 'Worker UserAgent operation failed';
    }
    this.#reply(result, error);
  }

  /** Publish the full reply before waking the waiter, ignoring late completion after shutdown. */
  #reply(result: WorkerUserAgentResult, error: string | null = null): void {
    if (Atomics.load(this.init.state, 0) === closed) return;
    try {
      this.#port.send({ type: 'response', result, error });
      // Queue the complete response before waking the synchronous receiver.
      Atomics.compareExchange(this.init.state, 0, pending, replied);
      Atomics.notify(this.init.state, 0);
    } catch {
      this.close();
    }
  }
}

/** Portable connection inputs; possession of the private port selects the original browser owner. */
export interface WorkerUserAgentInit {
  /** Native endpoint transferred exactly once into the worker. */
  port: JSMessagePortHandle;
  /** Wake-up and close state shared only with this connection's browser endpoint. */
  state: Int32Array<SharedArrayBuffer>;
  /** Live scripting preference can be read without synchronously contacting the browser. */
  scriptingPolicy: Int32Array<SharedArrayBuffer>;
}

/** URL-facing metadata and a connection-local handle to the retained File API registration. */
export interface WorkerBlobURLEntry {
  /** Resolve through the same browser connection; the handle is not portable between connections. */
  id: number;
  /** URL origin calculation needs the creator's original origin, including opaque identity. */
  env: { origin: Origin; };
}

/** Explicit browser-service operations, without transported functions or environments. */
type WorkerUserAgentRequest = WorkerBroadcastRequest |
  { type: 'fetch-imported-script'; request: WorkerImportedScriptFetch; } |
  { type: 'register-blob'; data: SerializedBlobData; contentType: string; snapshotState: BlobSnapshotState; } |
  { type: 'resolve'; url: string; } |
  { type: 'revoke'; url: string; } |
  { type: 'settings'; } |
  { type: 'trust-origin'; origin: Origin; } |
  { type: 'trust-url'; url: URLRecord; };

/** Scalar values retain their browser owner; each request observes its current configuration. */
interface WorkerBrowserSettings extends Pick<UserAgent,
  'defaultUserAgentValue' | 'navigatorPlatform' | 'preferredLanguages' | 'defaultAcceptLanguage' | 'assumeNoInternetConnectivity' |
  'cookiesEnabled' | 'reportDeliveryEnabled' | 'storageEnabled' | 'storageQuotaBytes' |
  'maxReportAge' | 'maxReportingEndpointFailures' | 'betweenLoadsSharedWorkerTimeout' |
  'extendedLifetimeSharedWorkerTimeout'
> {
  /** Live navigable activity observed by the original browser owner. */
  hasLoadingNavigable: boolean;
}

/** Explicit result kinds prevent treating a settings reply as a Blob capture. */
type WorkerUserAgentResult =
  { type: 'script'; snapshot: ScriptResponseSnapshot; violations: ContentSecurityPolicySnapshot[]; } |
  { type: 'url'; url: string; } |
  { type: 'entry'; entry: WorkerBlobURLEntry | null; } |
  { type: 'boolean'; value: boolean; } |
  { type: 'settings'; settings: WorkerBrowserSettings; } |
  { type: 'void'; };

/** Shared private host protocol for both endpoint directions. */
type WorkerUserAgentMessage = WorkerUserAgentRequest |
  { type: 'release'; id: number; } |
  { type: 'broadcast-release'; id: number; } | {
    type: 'response';
    result: WorkerUserAgentResult;
    error: string | null;
  };

/** Keep unavailable shared owners visible rather than silently creating worker-local substitutes. */
function unconnected(service: string): never {
  throw new InternalError(`Worker UserAgent ${service} transport is not connected`);
}

const idle = 0;
const pending = 1;
const replied = 2;
const closed = 3;
