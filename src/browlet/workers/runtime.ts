import { assertNever, InternalError } from '../../infra/index';
import { JSMessagePort, JSThread, JSThreadEndpoint } from '../../js-engine/index';
import { unsafeSharedCurrentTime } from '../../timing/index';
import { copyURL, type BlobURLEntry, type URLRecord } from '../../url/index';
import { FetchResponse, type Destination } from '../../fetch/index';

import type { ErrorInformation } from '../dom/events/index';
import {
  AgentCluster, DedicatedWorkerAgent, SharedWorkerAgent, EventLoop, createTaskSource, networkingTaskSource,
  createClassicWorkerScriptFromResponse, type Script, type ScriptFetchOptions,
  type ScriptEnvironment, type ScriptSourceCallback, type PerformScriptFetch,
} from '../scripting/index';
import { PolicyContainer } from '../browsing/policy/index';
import { MessagePortImpl, type MessagePortTransportMessage } from '../communication/index';
import { queueNodeTask } from '../integration/host/index';

import type { WorkerEnvironment, WorkerScriptResponse, WorkerEnvironmentSnapshotInit, CreatorEnvironmentSnapshot } from './environment';
import { RemoteWorkerOwner } from './remote-owner';
import type { WorkerThreadProtocol, WorkerScriptStartup, WorkerModuleScriptRequest, ScriptResponseSnapshot } from './protocol';
import { WorkerUserAgent } from './user-agent';

/** Inside-thread agent, environment, and private host channel; browser services retain their outside owner. */
// Its ScriptEnvironment view fetches for the retained creator. The inside
// WorkerEnvironment remains the module-map owner and the client for later imports.
export class WorkerThreadRuntime implements ScriptEnvironment {
  /** Actual execution agent and local cluster membership owned by this isolate. */
  agent: DedicatedWorkerAgent | SharedWorkerAgent;
  /** Copied creator values, not the new worker's own environment or a remote Environment. */
  creatorEnvSnapshot: CreatorEnvironmentSnapshot;
  /** Creator policies reconstructed locally; response processing still selects the worker's own policies. */
  creatorPolicyContainer: PolicyContainer;
  /** Initial script inputs and reserved identity; no live Fetch client crosses isolates. */
  script: WorkerScriptStartup;
  /** Real inside environment, composed before the runtime accepts any input. */
  environment: WorkerEnvironment;
  /** Cloneable inputs selected by the startup caller. */
  data: unknown;
  /** Private channel to the creator's host execution owner. */
  #endpoint: JSThreadEndpoint<WorkerThreadProtocol>;
  /** Host setup must finish before input can become tasks. */
  #started = false;
  /** Response processing supplied by inside startup, before it requests the root script. */
  #onScriptResponse: ((result: WorkerScriptResponse) => void) | undefined;
  /** Initial-script continuation held until the outside lifetime monitor is connected. */
  #onLifetimeReady: (() => void) | null = null;
  /** Each execution owner fetches its initial script only once. */
  #scriptRequested = false;
  /** Root already fetched by the creator; consumed when the module loader requests its source. */
  #moduleRootResponse: WorkerScriptResponse | null = null;
  /** Request identities only correlate private replies; module caching stays with the inside module map. */
  #nextModuleFetchId = 0;
  /** Local response consumers, never cloned into the creator isolate. */
  #moduleResponses = new Map<number, ModuleScriptResponseConsumer>();
  /** Received native endpoint retained until the dedicated global takes ownership. */
  #messagePort: JSMessagePort<MessagePortTransportMessage> | null = null;
  /** The initiating shared connection receives its connect event only after the initial script returns. */
  #initialSharedPort: MessagePortImpl | null = null;
  /** Private access to the browser owner; close it before disconnecting the control endpoint. */
  #userAgent: WorkerUserAgent;

  /** Read the host startup envelope and allocate this isolate's agent, loop, and cluster membership. */
  constructor(createEnvironment: (init: WorkerEnvironmentSnapshotInit) => WorkerEnvironment) {
    const unsafeWorkerCreationTime = unsafeSharedCurrentTime().milliseconds;
    this.#endpoint = new JSThreadEndpoint<WorkerThreadProtocol>();
    const init = this.#endpoint.data;
    const loop = new EventLoop({ requestTurn: queueNodeTask, onWorkerFinish: () => this.disconnect() });
    this.agent = init.kind === 'shared' ? new SharedWorkerAgent(loop) : new DedicatedWorkerAgent(loop);
    this.creatorEnvSnapshot = init.creatorEnvSnapshot;
    this.script = init.script;
    this.creatorPolicyContainer = PolicyContainer.fromSnapshot(this.creatorEnvSnapshot.policyContainer);
    const creator = this.creatorEnvSnapshot;
    const shared = this.agent instanceof SharedWorkerAgent;
    const cluster = shared ? new AgentCluster() : new AgentCluster(creator.crossOriginIsolationMode, creator.agentClusterId);
    cluster.isOriginKeyed = shared || creator.isOriginKeyed;
    cluster.add(this.agent);
    this.data = init.data;
    this.#userAgent = new WorkerUserAgent(init.userAgent);
    this.environment = createEnvironment({
      ...this.script, agent: this.agent, creatorEnvSnapshot: this.creatorEnvSnapshot, unsafeWorkerCreationTime,
      userAgent: this.#userAgent,
    });
    this.environment.importedScriptFetch = (request, _isTopLevel, onResponse) => {
      this.#userAgent.fetchImportedScript(request, onResponse, this.environment);
    };
    this.environment.getWindowOrWorkerGlobalScopeMixin().timers.setWorkerClock(() => this.#endpoint.elapsedTime);
    const global = this.environment.globalImplementation;
    global.remoteOwner = init.ownerState === null ? null : new RemoteWorkerOwner(init.ownerState);
    global.onClosing = () => {
      if (init.sharedClosing !== null) Atomics.store(init.sharedClosing, 0, 1);
      this.#userAgent.broadcastChannels.beginClosing();
      this.#endpoint.preventSuspension();
    };
    if (this.agent instanceof DedicatedWorkerAgent) {
      this.agent.globalScope!.reportErrorToOwner = (errorInfo) => this.reportError(errorInfo);
    }
  }

  /** Rebuild the script consumer's response view; no native body stream crosses isolates. */
  static #restoreScriptResponse(snapshot: ScriptResponseSnapshot): FetchResponse {
    const response = new FetchResponse();
    response.type = snapshot.type;
    response.aborted = snapshot.aborted;
    response.urlList = snapshot.urlList;
    response.status = snapshot.status;
    response.statusMessage = snapshot.statusMessage;
    response.headerList.list = snapshot.headers;
    return response;
  }

  /** Start production setup and request the configured root after host readiness. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  run(): void {
    this.start(() => {
      throw new InternalError('Production worker does not accept private commands');
    }, (result) => this.loadScript(result, (script) => {
      if (script === null || script.errorToRethrow !== null) {
        this.environment.discard();
        this.#endpoint.send({ type: 'script-fetch-failed' });
        return;
      }
      const agent = this.agent;
      const insidePort = agent instanceof DedicatedWorkerAgent ? agent.globalScope!.insidePort : this.#initialSharedPort;
      if (insidePort === null) throw new InternalError('Shared worker execution requires its initial connection');
      this.monitorLifetime(() => {
        this.environment.globalImplementation.runScript(script, insidePort, () => {
          this.#endpoint.send({ type: 'script-started' });
        });
      });
    }));
    this.fetchScript();
  }

  /** Admit internal commands through this agent's task loop, then acknowledge completed host setup. */
  start(onMessage: (message: unknown) => void, onScriptResponse?: (result: WorkerScriptResponse) => void): void {
    if (this.#started) throw new InternalError('Worker thread runtime is already started');
    this.#started = true;
    this.#onScriptResponse = onScriptResponse;
    this.#endpoint.listen((message) => {
      switch (message.type) {
        case 'lifetime-ready': {
          const continuation = this.#onLifetimeReady;
          this.#onLifetimeReady = null;
          if (continuation === null) throw new InternalError('Worker lifetime monitoring was not requested');
          this.agent.eventLoop.queueTask(workerHostTaskSource, null, continuation);
          break;
        }
        case 'owner-removed':
          // Orphan closing sets the flag without discarding already queued work.
          // The existing loop tail performs cleanup after its final checkpoint.
          this.environment.globalImplementation.closing = true;
          this.agent.eventLoop.notifyTaskRunnabilityChanged();
          break;
        case 'connect-port':
          this.agent.eventLoop.queueTask(workerHostTaskSource, null, () => {
            this.#messagePort?.close();
            this.#messagePort = new JSMessagePort(message.handle);
            this.connectMessagePort();
          });
          break;
        case 'connect-shared-port': {
          const channel = new JSMessagePort<MessagePortTransportMessage>(message.handle);
          const global = this.agent instanceof SharedWorkerAgent ? this.agent.globalScope : undefined;
          if (global === undefined) {
            channel.close();
            throw new InternalError('Shared connection requires a shared worker global');
          }
          const insidePort = new MessagePortImpl(this.environment);
          try {
            insidePort.entangleRemote(channel);
            if (message.initial) this.#initialSharedPort = insidePort;
            else global.queueConnectEvent(insidePort);
          } catch (error) {
            insidePort.close();
            channel.close();
            throw error;
          }
          break;
        }
        case 'message':
          this.agent.eventLoop.queueTask(workerHostTaskSource, null, () => { onMessage(message.data); });
          break;
        case 'script-response':
          this.agent.eventLoop.queueTask(networkingTaskSource, null, () => {
            const onResponse = this.#onScriptResponse;
            if (onResponse === undefined) throw new InternalError('Worker script response consumer is not connected');
            const snapshot = message.snapshot;
            onResponse({
              response: WorkerThreadRuntime.#restoreScriptResponse(snapshot), bodyBytes: snapshot.bodyBytes,
              policyContainer: snapshot.policyContainer === null ? null : PolicyContainer.fromSnapshot(snapshot.policyContainer),
              embedderPolicyAllowed: snapshot.embedderPolicyAllowed,
              outsideCrossOriginIsolatedCapability: snapshot.outsideCrossOriginIsolatedCapability,
            });
          });
          break;
        case 'module-response':
          this.agent.eventLoop.queueTask(networkingTaskSource, null, () => {
            const onResponse = this.#moduleResponses.get(message.id);
            // Disconnect may have discarded a consumer after this reply was queued.
            if (onResponse === undefined) return;
            this.#moduleResponses.delete(message.id);
            onResponse.callback(WorkerThreadRuntime.#restoreScriptResponse(message.snapshot), message.snapshot.bodyBytes);
          });
          break;
        default:
          assertNever(message, 'Unknown worker thread input message kind');
      }
    });
    this.#endpoint.send({ type: 'ready' });
  }

  /** Connect browser-owned Document closing and suspension before admitting the initial script. */
  // HTML §10.2.4 installs these monitors after loading and before execution
  // readiness. The continuation waits for the outside monitor, including an
  // initially inactive owner; suspension must not prevent initial Fetch itself.
  monitorLifetime(onReady: () => void): void {
    if (!JSThread.supportsSuspension) throw new InternalError('Worker script suspension requires the Node compatibility addon');
    if (this.environment.globalImplementation.remoteOwner === null) {
      throw new InternalError('Worker lifetime monitoring requires browser-owned Documents');
    }
    if (this.#onLifetimeReady !== null) throw new InternalError('Worker lifetime monitoring is already pending');
    this.#onLifetimeReady = onReady;
    this.#endpoint.send({ type: 'monitor-lifetime' });
  }

  /** Request the root through the creator's UserAgent, delivering its response on this worker's networking queue. */
  // The request already retains the parsed URL/Blob entry and the reserved client.
  // run() installs the production response consumer; explicit consumers remain
  // useful for testing the transport independently of startup progression.
  // The response consumer owns module loading after the root arrives.
  fetchScript(): void {
    if (!this.#started || this.#onScriptResponse === undefined) {
      throw new InternalError('Worker script response consumer is not connected');
    }
    if (this.#scriptRequested) throw new InternalError('Worker initial script was already requested');
    this.#scriptRequested = true;
    this.#endpoint.send({ type: 'fetch-script' });
  }

  /** Initialize root policies and prepare a classic script or a complete linked module graph, without executing it. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  loadScript(result: WorkerScriptResponse, onComplete: (script: Script | null) => void): void {
    const env = this.environment;
    const startup = this.script;
    const response = env.globalImplementation.initializeScriptResponse(result);
    if (response.type === 'error') { onComplete(null); return; }
    if (startup.type === 'classic') {
      onComplete(createClassicWorkerScriptFromResponse(response, result.bodyBytes, env));
      return;
    }

    this.#moduleRootResponse = { ...result, response };
    const destination = this.agent instanceof SharedWorkerAgent ? 'sharedworker' : 'worker';
    env.fetchModuleWorkerScriptGraph(startup.url, this, destination, startup.credentials, onComplete);
  }

  /** Fetch the initial graph's source through its creator connection; never substitute the inside Fetch client. */
  fetchModuleSource(
    url: URLRecord, destination: Destination, options: ScriptFetchOptions,
    referrer: URLRecord | 'client' | 'no-referrer', isTopLevel: boolean,
    processResponse: ScriptSourceCallback, performFetch?: PerformScriptFetch,
  ): void {
    if (performFetch !== undefined) throw new InternalError('Worker source fetching owns its creator-side fetch hook');
    if (isTopLevel) {
      const result = this.#moduleRootResponse;
      if (result === null) throw new InternalError('Worker module root response is unavailable');
      this.#moduleRootResponse = null;
      processResponse(result.response, result.bodyBytes);
      return;
    }
    this.fetchModuleScript({
      url,
      destination,
      referrer,
      credentials: options.credentialsMode,
      referrerPolicy: options.referrerPolicy,
      integrityMetadata: options.integrityMetadata,
    }, processResponse);
  }

  /** Request an initial-graph descendant; its creator performs Fetch and this loop delivers the result. */
  // Later dynamic imports use the worker's own Fetch client and need separate service routing.
  fetchModuleScript(request: WorkerModuleScriptRequest, onResponse: ScriptSourceCallback): void {
    if (!this.#started) throw new InternalError('Worker thread runtime is not started');
    const id = this.#nextModuleFetchId++;
    const entry = request.url.blobURLEntry;
    this.#moduleResponses.set(id, { callback: onResponse, entry });
    const url = copyURL(request.url);
    url.blobURLEntry = null;
    const blobEntryId = this.#userAgent.getBlobEntryId(entry);
    try { this.#endpoint.send({ type: 'fetch-module', id, request: { ...request, url, blobEntryId } }); }
    catch (error) {
      this.#moduleResponses.delete(id);
      throw error;
    }
  }

  /** Attach the received native endpoint to the composed dedicated global. */
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
    this.#onLifetimeReady = null;
    this.#userAgent.close();
    this.#moduleRootResponse = null;
    this.#moduleResponses.clear();
    this.#messagePort?.close();
    this.#messagePort = null;
    this.#initialSharedPort = null;
    this.#endpoint.disconnect();
  }
}

/** Retain captures until Fetch has replied; service and control ports can otherwise race GC release. */
interface ModuleScriptResponseConsumer {
  callback: ScriptSourceCallback;
  entry: BlobURLEntry | null;
}

/** Internal startup/control tasks, separate from author-message delivery on the port's task source. */
const workerHostTaskSource = createTaskSource('worker host control');
