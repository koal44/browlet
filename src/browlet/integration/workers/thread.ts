import { assertNever, InternalError, internalType, type InternalPromise } from '../../../infra/index';
import { JSMessageChannel, JSThread, NodePromise, type JSThreadExit } from '../../../js-engine/index';
import { copyOrigin, copyURL, createOpaqueOrigin, type URLRecord } from '../../../url/index';
import { fetch, isFilteredResponse, isLocalURL, type FetchController, type FetchRequest, type FetchResponse } from '../../../fetch/index';

import { createWorkerScriptRequest, createModuleScriptRequest, ScriptFetchOptions } from '../../scripting/index';
import type { PolicyContainer } from '../../browsing/policy/index';
import type { MessagePortTransportMessage } from '../../communication/index';
import { WorkerEnvironmentBase, type BrowletEnvironment, type CreatorEnvironmentSnapshot } from '../../environment/index';
import { WorkerGlobalImpl, type WorkerImpl, type WorkerOwner } from '../../workers/index';

import type {
  WorkerThreadProtocol, WorkerThreadStartup, WorkerScriptInit, WorkerScriptStartup,
  WorkerModuleScriptFetch, ScriptResponseSnapshot, WorkerScriptResponseSnapshot,
} from './protocol';
import { WorkerUserAgent, WorkerUserAgentConnection } from './user-agent';

/** Host execution owner for a worker isolate; entry is trusted host code, not a fetched worker script. */
// HTML §10.2.4 requires execution independently of the creating agent.
// https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
// The engine transport clones internal messages, including HTML serialization
// records. Author messaging and UserAgent services use their own MessagePorts.
// Do not expose the control or service endpoints to author code.
export class WorkerThread {
  /** Live creator environment, retained locally for later service/report delivery. */
  creatorEnv: BrowletEnvironment | null;
  /** Original Document or worker global, even if the creating Window navigates. */
  owner: WorkerOwner | null;
  /** Value snapshot sent to the isolate; no live owners or service stores. */
  creatorEnvSnapshot: CreatorEnvironmentSnapshot | null;
  /** Creator-side Fetch client reservation; the inside environment must retain this ID. */
  reservedEnv: WorkerEnvironmentBase | null = null;
  /** Browser-side endpoint released on native exit, including startup failure. */
  #userAgentConnection: WorkerUserAgentConnection | null = null;
  /** Engine-owned execution and native transport. */
  #thread: JSThread<WorkerThreadProtocol>;
  /** Host startup acknowledgement, distinct from Node's earlier 'online' event. */
  #ready = NodePromise.withResolvers(internalType<void>());
  /** Host-owned completion after native exit and local cleanup, independent of page/worker queues. */
  #closed: InternalPromise<JSThreadExit>;
  /** Admission state for host messages; a stopped isolate cannot receive more work. */
  #state: 'starting' | 'running' | 'stopping' | 'closed' = 'starting';
  /** Initial script fetch owned by the creator's UserAgent; canceled when this execution owner closes. */
  #scriptFetch: FetchController | null = null;
  /** Concurrent initial-graph descendant fetches, canceled together when the isolate exits. */
  #moduleFetches = new Set<FetchController>();
  /** Prepared root request, retaining any captured Blob registration in its owning isolate. */
  #initialScriptRequest: FetchRequest | null = null;
  /** Dedicated outside object and its hidden port, retained locally until native exit. */
  #worker: WorkerImpl | null;

  /** Reload this Browlet bundle in a new isolate; the caller supplies no executable entry. */
  constructor(initialization: WorkerThreadInit, onMessage: (message: unknown) => void) {
    this.#worker = initialization.worker ?? null;
    this.creatorEnv = this.#worker?.env ?? initialization.creatorEnv ?? null;
    this.owner = this.creatorEnv === null ? null : WorkerGlobalImpl.getRelevantOwner(this.creatorEnv);
    this.creatorEnvSnapshot = this.creatorEnv === null ? null : WorkerThread.captureCreatorEnvironment(this.creatorEnv);
    let script: WorkerScriptStartup | null = null;
    if (initialization.script !== undefined) {
      const env = this.creatorEnv;
      if (env === null) throw new InternalError('Worker script startup requires a creator environment');
      const input = initialization.script;
      // Reserve only the Fetch-facing environment here. Its UserAgent stays in
      // this isolate; the full inside environment is still composed separately.
      this.reservedEnv = new WorkerEnvironmentBase({
        userAgent: env.userAgent, creationURL: copyURL(input.url), topLevelCreationURL: null,
        topLevelOrigin: env.topLevelOrigin, targetBrowsingContext: null, isSecureContext: env.isSecureContext,
      }, input.url.scheme === 'data' ? createOpaqueOrigin() : copyOrigin(env.origin));
      if (env.userAgent instanceof WorkerUserAgent) {
        throw new InternalError('Nested worker startup requires a direct connection to the browser owner');
      }
      this.#initialScriptRequest = createWorkerScriptRequest(
        copyURL(input.url), env, initialization.kind === 'shared' ? 'sharedworker' : 'worker', input.type, input.credentials,
      );
      this.#initialScriptRequest.reservedClient = this.reservedEnv;
      script = {
        ...input, url: WorkerThread.#copySnapshotURL(input.url), environmentId: this.reservedEnv.id,
        origin: this.reservedEnv.origin,
        extendedLifetime: initialization.kind === 'shared' && (input.extendedLifetime ?? false),
      };
      this.#userAgentConnection = new WorkerUserAgentConnection(env.userAgent, this.reservedEnv);
    }
    // The caller can terminate during startup and inspect closed without awaiting
    // ready. Retain ready's rejection without producing an unhandled host Promise.
    this.#ready.promise.observe(() => {}, () => {});
    const startup: WorkerThreadStartup = {
      kind: initialization.kind, data: initialization.data, creatorEnvSnapshot: this.creatorEnvSnapshot, script,
      userAgent: this.#userAgentConnection?.init ?? null,
    };
    try {
      this.#thread = new JSThread<WorkerThreadProtocol>(startup, (message) => {
        if (this.#state === 'stopping' || this.#state === 'closed') return;
        switch (message.type) {
          case 'ready':
            this.#state = 'running';
            this.#ready.resolve(undefined);
            break;
          case 'message':
            onMessage(message.data);
            break;
          case 'error':
            if (this.#worker === null) throw new InternalError('Worker error requires its outside Worker');
            this.#worker.reportError(message.errorInfo);
            break;
          case 'script-fetch-failed': {
          // Fetch failure fires an ordinary Event, not a runtime ErrorEvent or
          // an uncanceled exception report. Keep delivery on the outside loop.
            const worker = this.#worker;
            if (worker !== null) worker.env.queueTask('dom-manipulation', () => { worker.fireEvent('error'); });
            // The inside settings have been discarded. Release their execution
            // owner and native endpoints even when no author script ever ran.
            void this.terminate();
            break;
          }
          case 'fetch-script': {
            const request = this.#initialScriptRequest;
            if (request === null) throw new InternalError('Worker initial script request is unavailable');
            this.#initialScriptRequest = null;
            this.fetchScript(request);
            break;
          }
          case 'fetch-module':
            this.#fetchModuleScript(message.id, message.request);
            break;
          default:
            assertNever(message, 'Unknown worker thread output message kind');
        }
      }, startup.userAgent === null ? [] : [startup.userAgent.port]);
    } catch (error) {
      this.#userAgentConnection?.close();
      this.reservedEnv?.discard();
      throw error;
    }
    // Chaining retains the engine's host queue and propagates cleanup failures.
    this.#closed = this.#thread.closed.then((exit) => {
      if (this.#state === 'starting') {
        this.#ready.reject(exit.error ?? new InternalError('Worker thread exited before completing startup'));
      }
      this.#state = 'closed';
      this.#userAgentConnection?.close();
      this.#initialScriptRequest = null;
      if (this.reservedEnv !== null && !this.reservedEnv.executionReady) this.reservedEnv.discard();
      try {
        this.#terminateScriptFetches();
      } finally {
        // Native exit destroys the inside agent, its queues, and its heap. The
        // surviving outside object must be released here, even if Fetch cleanup fails.
        const worker = this.#worker;
        this.#worker = null;
        if (worker !== null) {
          worker.thread = null;
          worker.outsidePort.disentangle();
        }
      }
      return exit;
    });
    // Publish the association only after native creation succeeds. It is available
    // immediately, before readiness, and neither the Worker nor its port is cloned.
    if (this.#worker !== null) this.#worker.thread = this;
  }

  /** Copy the creator's environment data before startup, preserving origin and cluster identities. */
  static captureCreatorEnvironment(env: BrowletEnvironment): CreatorEnvironmentSnapshot {
    const cluster = env.realm.agent.agentCluster;
    if (cluster === null) throw new InternalError('Worker creation requires a creator agent cluster');
    return {
      environmentId: env.id,
      agentClusterId: cluster.id,
      crossOriginIsolationMode: cluster.crossOriginIsolationMode,
      isOriginKeyed: cluster.isOriginKeyed,
      creationURL: WorkerThread.#copySnapshotURL(env.creationURL),
      apiBaseURL: WorkerThread.#copySnapshotURL(env.apiBaseURL),
      topLevelCreationURL: env.topLevelCreationURL === null ? null : WorkerThread.#copySnapshotURL(env.topLevelCreationURL),
      origin: copyOrigin(env.origin),
      topLevelOrigin: env.topLevelOrigin === null ? null : copyOrigin(env.topLevelOrigin),
      isSecureContext: env.isSecureContext,
      hasCrossSiteAncestor: env.hasCrossSiteAncestor,
      crossOriginIsolatedCapability: env.crossOriginIsolatedCapability,
      policyContainer: env.policyContainer.toSnapshot(),
    };
  }

  /** Copy URL data without its cached Blob registration, which belongs to the live UserAgent. */
  static #copySnapshotURL(this: void, url: URLRecord): URLRecord {
    const snapshot = copyURL(url);
    snapshot.blobURLEntry = null;
    return snapshot;
  }

  /** Capture only consumed response values; streams, Blob registrations, and timing stay with Fetch. */
  static #captureScriptResponse(response: FetchResponse, bodyBytes: Uint8Array | null | 'failure'): ScriptResponseSnapshot {
    return {
      type: response.type,
      aborted: response.aborted,
      urlList: response.urlList.map(WorkerThread.#copySnapshotURL),
      status: response.status,
      statusMessage: response.statusMessage,
      headers: response.headerList.list,
      bodyBytes,
    };
  }

  /** Resolves only after the inside runtime explicitly completes host setup. */
  get ready(): InternalPromise<void> { return this.#ready.promise; }

  /** Host completion after native exit and local cleanup; uncaught thread failures remain in the result. */
  get closed(): InternalPromise<JSThreadExit> { return this.#closed; }

  /** Send internal cloneable data after startup; this is not Worker.postMessage(). */
  send(message: unknown): void {
    if (this.#state !== 'running') throw new InternalError('Worker thread is not running');
    this.#thread.send({ type: 'message', data: message });
  }

  /** Establish the dedicated worker's implicit channel, including before inside startup finishes. */
  // HTML §10.2.4 entangles before running the initial script. Queue enablement
  // remains with that algorithm; neither the control acknowledgement nor this
  // connection permits author message callbacks to run early.
  connectMessagePort(): void {
    if (this.#state === 'stopping' || this.#state === 'closed') throw new InternalError('Worker thread is not running');
    if (this.#worker === null) throw new InternalError('Message channel requires its outside Worker');
    const channel = new JSMessageChannel<MessagePortTransportMessage>();
    try {
      this.#thread.send({ type: 'connect-port', handle: channel.port2.handle }, [channel.port2.handle]);
      this.#worker.outsidePort.entangleRemote(channel.port1);
    } catch (error) {
      channel.port1.close();
      channel.port2.close();
      throw error;
    }
  }

  /** Fetch a prepared initial-script request beside its creator, then deliver the consumed response to the isolate. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  // Request setup remains with HTML's script-fetch algorithm, including its outside
  // client and reserved inside client. Resolve policy inheritance and creator-side
  // COEP here; the receiving environment owns CSP initialization, parsing, and execution.
  // Inside startup can request its prepared root through fetch-script. Module
  // descendants and nested-worker service forwarding need their own routing.
  fetchScript(request: FetchRequest): void {
    if (this.#state !== 'running') throw new InternalError('Worker thread is not running');
    if (this.#scriptFetch !== null) throw new InternalError('Worker initial script fetch is already pending');
    const env = this.creatorEnv;
    const owner = this.owner;
    if (env === null || owner === null) throw new InternalError('Worker script fetching requires a creator environment');
    // Body streams need a host execution owner too: changing only callback
    // delivery would leave their Promise jobs on the inactive creator's loop.
    // The request's client still supplies origin, credentials, CSP and partition.
    this.#scriptFetch = fetch(request, {
      // The creator Document can become inactive while the worker is loading.
      // Fetch's host queue must still progress; delivery enters the worker loop below.
      useParallelQueue: true,
      processResponseConsumeBody: (response, bodyBytes) => {
        this.#scriptFetch = null;
        if (this.#state !== 'running') return;
        if (isFilteredResponse(response)) response = response.internalResponse;
        if (request.reservedClient === this.reservedEnv && this.reservedEnv !== null && response.url !== null) {
          this.reservedEnv.creationURL = response.url;
        }
        // HTML initializes local non-Blob workers from their retained owner;
        // Blob workers instead inherit the registration's creator. Resolve both
        // here, while the live owners and cached Blob entry are still available.
        // https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container
        let policyContainer: PolicyContainer | null = null;
        let embedderPolicyAllowed = true;
        if (response.type !== 'error') {
          const url = response.url;
          if (url === null) throw new InternalError('Worker script response requires a URL');
          policyContainer = isLocalURL(url) && url.scheme !== 'blob'
            ? owner.policyContainer.clone()
            : env.userAgent.createPolicyContainerFromResponse(response, this.reservedEnv ?? env);
          if (request.destination === 'worker') {
            embedderPolicyAllowed = policyContainer.embedderPolicy.checkWorkerInheritance(response, env);
          }
        }
        const snapshot: WorkerScriptResponseSnapshot = {
          ...WorkerThread.#captureScriptResponse(response, bodyBytes),
          policyContainer: policyContainer?.toSnapshot() ?? null, embedderPolicyAllowed,
          outsideCrossOriginIsolatedCapability: env.crossOriginIsolatedCapability,
        };
        this.#thread.send({ type: 'script-response', snapshot });
      },
    }, env.userAgent.sandbox);
  }

  /** Abort independent worker execution, discard pending outside deliveries, and await host cleanup. */
  // https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker
  terminate(): InternalPromise<JSThreadExit> {
    if (this.#state !== 'closed' && this.#state !== 'stopping') {
      this.#state = 'stopping';
      this.#ready.reject(new InternalError('Worker thread was terminated during startup'));
      // The stop travels directly to the native execution owner, not through
      // the blocked agent's task queue. Aborting the isolate discards its inside
      // tasks and microtasks without author catch/finally or script cleanup.
      // Host Fetch cleanup runs after exit so it cannot prevent this request.
      void this.#thread.terminate();
      // Stop host delivery too: records still in the native pipe must not refill
      // the outside HTML queue after its termination cleanup.
      this.#worker?.outsidePort.disentangle();
      this.#worker?.outsidePort.clearMessageQueue();
    }
    return this.closed;
  }

  /** Fetch an initial module-graph dependency using the live creator client, without replacing root policies. */
  // HTML's initial worker graph retains fetchClient for every descendant.
  // https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-worklet/module-worker-script-graph
  #fetchModuleScript(id: number, input: WorkerModuleScriptFetch): void {
    const env = this.creatorEnv;
    if (env === null) throw new InternalError('Worker module fetching requires its creator environment');
    const url = copyURL(input.url);
    // Preserve the inside parser's captured registration, including a failed lookup.
    // The original entry can remain valid after the public URL has been revoked.
    if (url.scheme === 'blob') {
      url.blobURLEntry = input.blobEntryId === null
        ? null : this.#userAgentConnection?.getBlobEntry(input.blobEntryId) ?? null;
    }
    const options = new ScriptFetchOptions();
    options.credentialsMode = input.credentials;
    options.referrerPolicy = input.referrerPolicy;
    options.integrityMetadata = input.integrityMetadata;
    const request = createModuleScriptRequest(url, input.destination, options, input.referrer, false, env);
    const controller = fetch(request, {
      useParallelQueue: true,
      processResponseConsumeBody: (response, bodyBytes) => {
        this.#moduleFetches.delete(controller);
        if (this.#state !== 'running') return;
        this.#thread.send({ type: 'module-response', id, snapshot: WorkerThread.#captureScriptResponse(response, bodyBytes) });
      },
    }, env.userAgent.sandbox);
    this.#moduleFetches.add(controller);
  }

  /** Cancel every outstanding script request, preserving cleanup failures after all cancellations were attempted. */
  #terminateScriptFetches(): void {
    const controllers = [...this.#moduleFetches];
    if (this.#scriptFetch !== null) controllers.unshift(this.#scriptFetch);
    this.#scriptFetch = null;
    this.#moduleFetches.clear();
    const errors: unknown[] = [];
    for (const controller of controllers) {
      try { controller.terminate(); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new InternalError('Worker script fetch cleanup failed', { cause: errors });
  }
}

/** Parent-side inputs; the live creator environment stays in its own isolate. */
export interface WorkerThreadInit {
  /** Selects a dedicated agent in the creator's cluster or a shared agent in a new cluster. */
  kind: 'dedicated' | 'shared';
  /** Caller-owned startup data; native transport clones it without author-facing HTML conversion. */
  data: unknown;
  /** Creator for shared or agent-only startup; a dedicated outside Worker supplies its own environment. */
  creatorEnv?: BrowletEnvironment;
  /** Dedicated outside object, retained only in the creating isolate; omitted for shared or agent-only startup. */
  worker?: WorkerImpl;
  /** Parsed initial URL and converted options; omitted for agent-only startup. */
  script?: WorkerScriptInit;
}
