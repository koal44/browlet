import { InternalError } from '../../infra/index';
import { monotonicClock, UnsafeMoment, type Moment } from '../../timing/index';
import type { Origin, URLRecord } from '../../url/index';
import type { RequestCredentials } from '../../fetch/index';

import type { BrowletRealm, DedicatedWorkerAgent, SharedWorkerAgent, ModuleMap } from '../scripting/index';
import type { PolicyContainer } from '../browsing/policy/index';
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
