import { InternalError } from '../../infra/index';
import { monotonicClock, UnsafeMoment, type Moment } from '../../timing/index';
import type { Origin, URLRecord } from '../../url/index';
import { fetch, FetchResponse, isFilteredResponse, type RequestCredentials } from '../../fetch/index';

import type { EventTargetImpl } from '../dom/events/index';
import {
  SharedWorkerAgent, type BrowletRealm, type DedicatedWorkerAgent, type ModuleMap,
  type ClassicScript, type ModuleScript, type PerformScriptFetch,
} from '../scripting/index';
import { EmbedderPolicy, type PolicyContainer } from '../browsing/policy/index';
import { MessageEventImpl, type MessagePortImpl } from '../communication/index';
import type { WorkerGlobalImpl, WorkerType } from '../workers/index';

import { BrowletEnvironment, type BrowletEnvironmentBase, type BrowletEnvironmentInit } from './environment';
import { WindowOrWorkerGlobalScopeMixin } from './global-scope';

/** Settings for a dedicated/shared worker; the global supplies its changing URL and policy state. */
// https://html.spec.whatwg.org/multipage/workers.html#set-up-a-worker-environment-settings-object
export class WorkerEnvironment extends BrowletEnvironment {
  /** Initial settings captured from the creator before it can navigate or disappear. */
  #settings: WorkerSettings;
  /** Global attached during realm composition, before any author code can run. */
  #global: WorkerGlobalImpl | null = null;
  /** Resources owned by this environment/global pair, independent of its creator's resources. */
  #globalScopeMixin: WindowOrWorkerGlobalScopeMixin;

  constructor(
    realm: BrowletRealm, baseEnv: BrowletEnvironmentBase, initialization: BrowletEnvironmentInit,
    settings: WorkerSettings,
  ) {
    super(realm, baseEnv, initialization);
    this.#settings = settings;
    this.#globalScopeMixin = new WindowOrWorkerGlobalScopeMixin(this);
  }

  get globalImplementation(): WorkerGlobalImpl {
    if (this.#global === null) throw new InternalError('Worker global is not initialized');
    return this.#global;
  }

  /** Attach the global once, after its constructor has received this environment. */
  set globalImplementation(global: WorkerGlobalImpl) {
    if (this.#global !== null) throw new InternalError('Worker global is already initialized');
    this.#global = global;
  }

  get apiBaseURL(): URLRecord {
    const url = this.globalImplementation.url;
    if (url === null) throw new InternalError('Worker global has no script URL');
    return url;
  }

  get moduleMap(): ModuleMap { return this.globalImplementation.moduleMap; }
  get origin(): Origin { return this.#settings.origin; }
  get hasCrossSiteAncestor(): boolean { return this.#settings.hasCrossSiteAncestor; }
  get policyContainer(): PolicyContainer { return this.globalImplementation.policyContainer; }
  get crossOriginIsolatedCapability(): boolean { return this.globalImplementation.crossOriginIsolatedCapability; }

  /** Coarsen the original creation reading using the worker's current isolation capability. */
  get timeOrigin(): Moment {
    return new UnsafeMoment(monotonicClock, this.#settings.unsafeWorkerCreationTime)
      .coarsen(this.crossOriginIsolatedCapability);
  }

  getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    return this.#globalScopeMixin;
  }

  getReportingSource(): URLRecord { return this.apiBaseURL; }

  /** Fetch the initial script and apply its response policies before parsing or loading descendants. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  // This is the script-fetch portion only; completeScriptFetch supplies the
  // completion steps. Separate-isolate use still needs creator environment
  // state and UserAgent services connected across the host transport.
  fetchScript(
    outsideEnv: BrowletEnvironment, credentials: RequestCredentials,
    onComplete: (script: ClassicScript | ModuleScript | null) => void,
  ): void {
    const global = this.globalImplementation;
    const shared = this.realm.agent instanceof SharedWorkerAgent;
    const destination = shared ? 'sharedworker' : 'worker';
    const performFetch: PerformScriptFetch = (request, isTopLevel, processResponse) => {
      if (!isTopLevel) {
        fetch(request, { processResponseConsumeBody: processResponse }, outsideEnv);
        return;
      }
      request.reservedClient = this;
      fetch(request, {
        processResponseConsumeBody: (response, bytes) => {
          // Script fetching consumes the internal response, including policies
          // which a filtered response need not expose.
          if (isFilteredResponse(response)) response = response.internalResponse;
          processResponse(this.#initializeScriptResponse(response, outsideEnv), bytes);
        },
      }, outsideEnv);
    };
    if (global.type === 'classic') {
      this.fetchClassicWorkerScript(this.apiBaseURL, outsideEnv, destination, onComplete, performFetch);
    } else {
      this.fetchModuleWorkerScriptGraph(this.apiBaseURL, outsideEnv, destination,
        credentials, onComplete, performFetch);
    }
  }

  /** Finish an initial fetch on the worker's completion task, delivering failure to the supplied outside target. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  // The outside Worker/SharedWorker is accepted through its EventTarget base;
  // its original outside port retains the environment that owns error delivery.
  // TODO(HTML §10.2.6): Concrete outside worker objects must supply this target
  // and retain their association with the global after successful loading.
  completeScriptFetch(
    script: ClassicScript | ModuleScript | null, worker: EventTargetImpl, outsidePort: MessagePortImpl,
  ): void {
    if (script === null || script.errorToRethrow !== null) {
      outsidePort.env.queueTask('dom-manipulation', () => { worker.fireEvent('error'); });
      this.discard();
      return;
    }

    const global = this.globalImplementation;
    const insidePort = global.connectPort(outsidePort);
    // WorkerLocation already reads this global's final response URL. Owner
    // monitoring and the outside object association remain caller dependencies.
    this.runScript(script, outsidePort, insidePort);
  }

  /** Run a successfully loaded initial script from its completion task, then activate its entangled startup ports. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  // Extracted onComplete steps 9–14. completeScriptFetch first rejects failed
  // scripts and entangles the ports; outside Worker association remains with
  // the startup caller.
  // TODO(HTML §10.2.4): The startup caller must also connect owner-derived closing
  // and suspension monitoring before entering this phase.
  runScript(script: ClassicScript | ModuleScript, outsidePort: MessagePortImpl, insidePort: MessagePortImpl): void {
    this.markExecutionReady();
    // ModuleScript.run() owns rejection reporting. HTML does not wait for its
    // evaluation Promise (including top-level await) before enabling the ports.
    void script.run();
    outsidePort.start();
    if (!(this.realm.agent instanceof SharedWorkerAgent)) {
      insidePort.start();
    } else {
      const global = this.globalImplementation;
      this.queueTask('dom-manipulation', () => {
        global.fireEvent('connect', MessageEventImpl, (event) => {
          event.data = '';
          event.ports = [insidePort];
          event.source = insidePort;
        });
      });
    }
    // TODO(Service Workers): Enable this client's ServiceWorkerContainer message
    // queue. No container/client-message-queue implementation exists yet.
  }

  /** Install the root response's settings; rejected responses remain script-fetch failures. */
  #initializeScriptResponse(response: FetchResponse, outsideEnv: BrowletEnvironment): FetchResponse {
    // Network errors have no URL or policies to install.
    if (response.type === 'error') return response;
    const url = response.url;
    if (url === null) throw new InternalError('Worker script response requires a URL');
    const global = this.globalImplementation;
    global.url = url;
    this.creationURL = url;
    global.initializePolicyContainer(response, this);
    global.embedderPolicy = global.policyContainer.embedderPolicy;
    let blocked = global.policyContainer.cspList?.initializeWorker(global) ?? false;
    const agent = this.realm.agent;
    const cluster = agent.agentCluster;
    if (cluster === null) throw new InternalError('Worker response initialization requires its agent cluster');
    if (agent instanceof SharedWorkerAgent && EmbedderPolicy.isCompatibleWithCrossOriginIsolation(global.embedderPolicy.value)) {
      // Use the same logical-isolation policy as Window startup. Physical
      // isolation and shared-memory exposure still require their own integration.
      cluster.crossOriginIsolationMode = 'logical';
    }
    // SPEC_CLASH(worker-rejected-response-url): HTML replaces response with a
    // network error, then still uses its URL for reports and the data: check.
    // Retain the original response for those steps; return the rejection below.
    if (!global.checkEmbedderPolicy(outsideEnv, response)) blocked = true;
    global.crossOriginIsolatedCapability = cluster.crossOriginIsolationMode === 'concrete';
    if (!(agent instanceof SharedWorkerAgent) && (!outsideEnv.crossOriginIsolatedCapability || url.scheme === 'data')) {
      global.crossOriginIsolatedCapability = false;
    }
    return blocked ? FetchResponse.networkError() : response;
  }
}

/** Creator-derived values that remain fixed when the script response updates the worker's URL. */
export interface WorkerSettings {
  origin: Origin;
  hasCrossSiteAncestor: boolean;
  unsafeWorkerCreationTime: number;
}

/** Inputs supplied to realm composition after the worker agent has been selected. */
export interface WorkerEnvironmentInit {
  agent: DedicatedWorkerAgent | SharedWorkerAgent;
  outsideEnv: BrowletEnvironment;
  url: URLRecord;
  unsafeWorkerCreationTime: number;
  type: WorkerType;
  name: string;
  credentials: RequestCredentials;
  extendedLifetime: boolean;
}
