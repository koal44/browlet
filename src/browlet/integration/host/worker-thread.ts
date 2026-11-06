import { assertNever, InternalError, internalType, type InternalPromise } from '../../../infra/index';
import {
  JSMessageChannel, JSMessagePort, JSThread, JSThreadEndpoint, NodePromise,
  type JSMessagePortHandle, type JSThreadExit, type JSThreadProtocol,
} from '../../../js-engine/index';
import { copyOrigin, copyURL, type Origin, type URLRecord } from '../../../url/index';
import type { HTTPStatus } from '../../../http/index';
import { fetch, FetchResponse, isFilteredResponse, type FetchController, type FetchRequest, type ResponseType } from '../../../fetch/index';

import type { ErrorInformation } from '../../dom/events/index';
import {
  AgentCluster, DedicatedWorkerAgent, SharedWorkerAgent, EventLoop, createTaskSource, networkingTaskSource,
  type CrossOriginIsolationMode,
} from '../../scripting/index';
import { PolicyContainer, type PolicyContainerSnapshot } from '../../browsing/policy/index';
import type { MessagePortTransportMessage } from '../../communication/index';
import type { BrowletEnvironment } from '../../environment/index';
import { WorkerGlobalImpl, type WorkerImpl, type WorkerOwner } from '../../workers/index';

import { queueNodeTask } from './node';

/** Host execution owner for a worker isolate; entry is trusted host code, not a fetched worker script. */
// HTML §10.2.4 requires execution independently of the creating agent.
// https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
// The engine transport clones internal messages, including HTML serialization
// records. Author messaging uses its separate MessagePort channel; UserAgent
// service transport remains pending. Do not expose this control endpoint to author code.
export class WorkerThread {
  /** Live creator environment, retained locally for later service/report delivery. */
  creatorEnv: BrowletEnvironment | null;
  /** Original Document or worker global, even if the creating Window navigates. */
  owner: WorkerOwner | null;
  /** Value snapshot sent to the isolate; no live owners or service stores. */
  creatorEnvSnapshot: CreatorEnvironmentSnapshot | null;
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
  /** Dedicated outside object and its hidden port, retained locally until native exit. */
  #worker: WorkerImpl | null;

  /** Reload this Browlet bundle in a new isolate; the caller supplies no executable entry. */
  constructor(initialization: WorkerThreadInit, onMessage: (message: unknown) => void) {
    this.#worker = initialization.worker ?? null;
    this.creatorEnv = this.#worker?.env ?? initialization.creatorEnv ?? null;
    this.owner = this.creatorEnv === null ? null : WorkerGlobalImpl.getRelevantOwner(this.creatorEnv);
    this.creatorEnvSnapshot = this.creatorEnv === null ? null : WorkerThread.captureCreatorEnvironment(this.creatorEnv);
    // The caller can terminate during startup and inspect closed without awaiting
    // ready. Retain ready's rejection without producing an unhandled host Promise.
    this.#ready.promise.observe(() => {}, () => {});
    const startup: WorkerThreadStartup = {
      kind: initialization.kind, data: initialization.data, creatorEnvSnapshot: this.creatorEnvSnapshot,
    };
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
        default:
          assertNever(message, 'Unknown worker thread output message kind');
      }
    });
    // Chaining retains the engine's host queue and propagates cleanup failures.
    this.#closed = this.#thread.closed.then((exit) => {
      if (this.#state === 'starting') {
        this.#ready.reject(exit.error ?? new InternalError('Worker thread exited before completing startup'));
      }
      this.#state = 'closed';
      const scriptFetch = this.#scriptFetch;
      this.#scriptFetch = null;
      try {
        scriptFetch?.terminate();
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
  // client and reserved inside client. This is only the performFetch transport:
  // it neither creates settings nor initializes policies, parses, or executes code.
  // TODO(HTML §10.2.4): Connect the startup caller and reserved client identity;
  // module descendants and nested-worker service forwarding need their own routing.
  fetchScript(request: FetchRequest): void {
    if (this.#state !== 'running') throw new InternalError('Worker thread is not running');
    if (this.#scriptFetch !== null) throw new InternalError('Worker initial script fetch is already pending');
    const env = this.creatorEnv;
    if (env === null) throw new InternalError('Worker script fetching requires a creator environment');
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
        // Resolve Blob policy inheritance while the captured registration is still
        // local. Transport only policy values, never the entry or its live owner.
        const blobPolicyContainer = response.type !== 'error' && response.url?.scheme === 'blob'
          ? env.userAgent.createPolicyContainerFromResponse(response, null).toSnapshot() : null;
        const snapshot: WorkerScriptResponseSnapshot = {
          type: response.type, aborted: response.aborted,
          urlList: response.urlList.map(WorkerThread.#copySnapshotURL),
          status: response.status, statusMessage: response.statusMessage,
          headers: response.headerList.list, bodyBytes, blobPolicyContainer,
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
}

/** Inside-thread agent, task loop, and private host channel; no worker environment or global is fabricated. */
export class WorkerThreadRuntime {
  /** Actual execution agent and local cluster membership owned by this isolate. */
  agent: DedicatedWorkerAgent | SharedWorkerAgent;
  /** Copied creator values, not the new worker's own environment or a remote Environment. */
  creatorEnvSnapshot: CreatorEnvironmentSnapshot | null;
  /** Creator policies reconstructed locally; response processing still selects the worker's own policies. */
  creatorPolicyContainer: PolicyContainer | null;
  /** Cloneable inputs selected by the startup caller. */
  data: unknown;
  /** Private channel to the creator's host execution owner. */
  #endpoint: JSThreadEndpoint<WorkerThreadProtocol>;
  /** Host setup must finish before input can become tasks. */
  #started = false;
  /** Native messages can wait here before startup has composed the inside global. */
  #messagePort: JSMessagePort<MessagePortTransportMessage> | null = null;

  /** Read the host startup envelope and allocate this isolate's agent, loop, and cluster membership. */
  constructor() {
    this.#endpoint = new JSThreadEndpoint<WorkerThreadProtocol>();
    const initialization = this.#endpoint.data;
    const loop = new EventLoop({ requestTurn: queueNodeTask });
    this.agent = initialization.kind === 'shared' ? new SharedWorkerAgent(loop) : new DedicatedWorkerAgent(loop);
    this.creatorEnvSnapshot = initialization.creatorEnvSnapshot;
    this.creatorPolicyContainer = this.creatorEnvSnapshot === null
      ? null : PolicyContainer.fromSnapshot(this.creatorEnvSnapshot.policyContainer);
    if (this.creatorEnvSnapshot !== null) {
      const creator = this.creatorEnvSnapshot;
      const shared = this.agent instanceof SharedWorkerAgent;
      const cluster = shared ? new AgentCluster() : new AgentCluster(creator.crossOriginIsolationMode, creator.agentClusterId);
      cluster.isOriginKeyed = shared || creator.isOriginKeyed;
      cluster.add(this.agent);
    }
    this.data = initialization.data;
  }

  /** Admit internal commands through this agent's task loop, then acknowledge completed host setup. */
  start(onMessage: (message: unknown) => void, onScriptResponse?: (result: WorkerScriptResponse) => void): void {
    if (this.#started) throw new InternalError('Worker thread runtime is already started');
    this.#started = true;
    this.#endpoint.listen((message) => {
      switch (message.type) {
        case 'connect-port':
          this.agent.eventLoop.queueTask(workerHostTaskSource, null, () => {
            this.#messagePort?.close();
            this.#messagePort = new JSMessagePort(message.handle);
            this.connectMessagePort();
          });
          break;
        case 'message':
          this.agent.eventLoop.queueTask(workerHostTaskSource, null, () => { onMessage(message.data); });
          break;
        case 'script-response':
          this.agent.eventLoop.queueTask(networkingTaskSource, null, () => {
            if (onScriptResponse === undefined) throw new InternalError('Worker script response consumer is not connected');
            const snapshot = message.snapshot;
            const response = new FetchResponse();
            response.type = snapshot.type;
            response.aborted = snapshot.aborted;
            response.urlList = snapshot.urlList;
            response.status = snapshot.status;
            response.statusMessage = snapshot.statusMessage;
            response.headerList.list = snapshot.headers;
            onScriptResponse({
              response, bodyBytes: snapshot.bodyBytes,
              blobPolicyContainer: snapshot.blobPolicyContainer === null
                ? null : PolicyContainer.fromSnapshot(snapshot.blobPolicyContainer),
            });
          });
          break;
        default:
          assertNever(message, 'Unknown worker thread input message kind');
      }
    });
    this.#endpoint.send({ type: 'ready' });
  }

  /** Attach the waiting native endpoint once startup has supplied the dedicated global. */
  // Call after environment composition; the endpoint may arrive before or after it.
  // Neither attachment nor host reception enables the inside HTML message queue.
  connectMessagePort(): void {
    const global = this.agent instanceof DedicatedWorkerAgent ? this.agent.globalScope : undefined;
    if (this.#messagePort === null || global === undefined) return;
    global.insidePort.entangleRemote(this.#messagePort);
    this.#messagePort = null;
  }

  /** Return internal data; the receiver must enter its own HTML task when delivering author-visible results. */
  send(data: unknown): void {
    this.#endpoint.send({ type: 'message', data });
  }

  /** Forward only diagnostics; the thrown value remains in the worker's realm. */
  reportError(errorInfo: ErrorInformation): void {
    const { message, filename, lineno, colno } = errorInfo;
    this.#endpoint.send({ type: 'error', errorInfo: { message, filename, lineno, colno, error: null } });
  }

  /** Release the native control channel; remaining tasks/resources determine natural thread exit. */
  disconnect(): void {
    this.#messagePort?.close();
    this.#messagePort = null;
    this.#endpoint.disconnect();
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
}

/** Creator values captured before startup; neither an Environment nor a Fetch client. */
// Existing Origin and URL records are cloneable. Copy their mutable data while
// preserving opaque identity; omit cached Blob entries and their live environments.
// TODO(HTML §10.2.4): Supply reporting and UserAgent service connections
// before these values can initialize a WorkerEnvironment. In particular, a data:
// worker needs its own new opaque origin, not its creator's copied origin.
export interface CreatorEnvironmentSnapshot {
  /** Existing HTML environment ID, distinct from a Document's lifetime. */
  environmentId: string;
  /** Dedicated workers inherit this cluster; shared workers get a new one. */
  agentClusterId: string;
  /** Cluster-wide isolation mode, separate from the creator environment's effective capability. */
  crossOriginIsolationMode: CrossOriginIsolationMode;
  /** Whether the inherited cluster is keyed by origin rather than site. */
  isOriginKeyed: boolean;
  /** Creator's original creation URL, not the new worker's script URL. */
  creationURL: URLRecord;
  /** Creator's current base URL for resolving API inputs. */
  apiBaseURL: URLRecord;
  /** Retained top-level creation URL, or null when the creator has no such association. */
  topLevelCreationURL: URLRecord | null;
  /** Creator origin, including the portable identity of an opaque origin. */
  origin: Origin;
  /** Top-level origin used for inherited ancestry and policy decisions; may be absent. */
  topLevelOrigin: Origin | null;
  /** Creator's secure-context result at capture time. */
  isSecureContext: boolean;
  /** Whether the creator's ancestry contains a cross-site boundary. */
  hasCrossSiteAncestor: boolean;
  /** Creator's effective capability, which may be narrower than its cluster's isolation mode. */
  crossOriginIsolatedCapability: boolean;
  /** Policy values only; no live owner, report queue, or Blob registration. */
  policyContainer: PolicyContainerSnapshot;
}

/** Data cloned into the new isolate before any Browlet realm or global exists. */
interface WorkerThreadStartup {
  /** Agent kind selected by the outside startup owner. */
  kind: 'dedicated' | 'shared';
  /** Internal startup payload copied from WorkerThreadInit. */
  data: unknown;
  /** Portable creator values; null only for agent-only startup without an HTML environment. */
  creatorEnvSnapshot: CreatorEnvironmentSnapshot | null;
}

/** Both endpoints share this trusted host protocol; receivers exhaustively handle its message kinds. */
interface WorkerThreadProtocol extends JSThreadProtocol {
  startup: WorkerThreadStartup;
  toThread: WorkerThreadInput;
  fromThread: WorkerThreadMessage;
}

/** Private acknowledgement and outbound data; never HTML MessageEvents. */
type WorkerThreadMessage = { type: 'ready'; } | { type: 'message'; data: unknown; } |
  { type: 'error'; errorInfo: ErrorInformation; };

/** Consumed initial-script data for response initialization, not a clone of a streaming Fetch response. */
export interface WorkerScriptResponse {
  /** Unfiltered metadata needed for URL, MIME, status and response-policy checks; body stays separate. */
  response: FetchResponse;
  /** Consumed bytes, null for an absent body, or failure when body consumption failed. */
  bodyBytes: Uint8Array | null | 'failure';
  /** Blob creator policies captured before removing the live registration from the URL. */
  blobPolicyContainer: PolicyContainer | null;
}

/** Cloneable subset consumed by worker script processing; timing and network resources stay with Fetch. */
interface WorkerScriptResponseSnapshot {
  type: ResponseType;
  aborted: boolean;
  urlList: URLRecord[];
  status: HTTPStatus;
  statusMessage: string;
  headers: [string, string][];
  /** Preserve the distinction between an absent body and a failed body read across transport. */
  bodyBytes: Uint8Array | null | 'failure';
  /** Blob creator policy values copied while its registration was still available locally. */
  blobPolicyContainer: PolicyContainerSnapshot | null;
}

/** Private creator-to-worker messages, distinguished before choosing the receiving task source. */
type WorkerThreadInput = { type: 'message'; data: unknown; } |
  { type: 'connect-port'; handle: JSMessagePortHandle; } |
  { type: 'script-response'; snapshot: WorkerScriptResponseSnapshot; };

/** Internal startup/control tasks, separate from author-message delivery on the port's task source. */
const workerHostTaskSource = createTaskSource('worker host control');

// Name Browlet's entry once. JS Engine owns its native path, private startup
// marker, and scheduling after module evaluation. Ordinary imports do not run
// these steps or construct another Browlet, Window, or UserAgent.
JSThread.initialize(import.meta.url, () => {
  const runtime = new WorkerThreadRuntime();
  runtime.start(() => {
    // TODO(HTML §10.2.4): Connect the creator environment snapshot, restored policies,
    // and identities to reporting/UserAgent services before createWorkerEnvironment().
    // Then fetch/evaluate the script and connect HTML ports and lifecycle tasks.
    // Host readiness acknowledges the agent/loop/channel, not execution-ready
    // worker settings. Reject startup commands until their receiver exists.
    throw new InternalError('Worker settings and shared-service transport are not implemented');
  });
});
