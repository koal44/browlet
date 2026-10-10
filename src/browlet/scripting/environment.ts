import { InternalError } from '../../infra/internal-error';
import { randomUUID } from '../../js-engine/index';
import { obtainSite, obtainURLOrigin, type Origin, type URLRecord } from '../../url/index';
import type { FetchEnvironmentRecord, NetworkPartitionKey } from '../../fetch/index';

import type { BrowsingContext } from '../browsing/navigation/index';
import type { UserAgent } from '../user-agent';

import type { Realm } from './realm';

/** Browser state shared by reserved records and full environments. */
// https://html.spec.whatwg.org/multipage/webappapis.html#environment
export class EnvironmentRecord implements FetchEnvironmentRecord {
  /** Identity transferred to the full environment when a reservation is consumed. */
  id: string;
  /** Top-level creation URL, or null when the environment has none. */
  topLevelCreationURL: URLRecord | null;
  /** Top-level origin, or null until it can be determined. */
  topLevelOrigin: Origin | null;
  /** Navigation's target browsing context, when present. */
  targetBrowsingContext: BrowsingContext | null;
  /** Service worker controlling this environment, when present. */
  activeServiceWorker: object | null;
  /** Browser owner; null only for an internal sandbox constructed without one. */
  #userAgent: UserAgent | null;
  /** Creation URL; null only for internal sandboxes. */
  #creationURL: URLRecord | null;
  #isSecureContext: boolean;
  #executionReady = false;

  /** Null leaves browser-specific state unavailable for an internal sandbox. */
  constructor(initialization: EnvironmentInit | null) {
    this.id = initialization?.id ?? randomUUID();
    this.#userAgent = initialization?.userAgent ?? null;
    this.#creationURL = initialization?.creationURL ?? null;
    this.topLevelCreationURL = initialization?.topLevelCreationURL ?? null;
    this.topLevelOrigin = initialization?.topLevelOrigin ?? null;
    this.targetBrowsingContext = initialization?.targetBrowsingContext ?? null;
    this.activeServiceWorker = initialization?.activeServiceWorker ?? null;
    this.#isSecureContext = initialization?.isSecureContext ?? false;
  }

  /** Browser owner; unavailable in standalone sandboxes without a supplied owner. */
  get userAgent(): UserAgent {
    if (this.#userAgent === null) throw new InternalError('Environment has no UserAgent');
    return this.#userAgent;
  }

  set userAgent(value: UserAgent) {
    this.#userAgent = value;
  }

  /** Creation URL; internal sandboxes have none. */
  get creationURL(): URLRecord {
    if (this.#creationURL === null) throw new InternalError('Environment has no creation URL');
    return this.#creationURL;
  }

  set creationURL(value: URLRecord) {
    this.#creationURL = value;
  }

  /** Security classification fixed when the environment was created. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#secure-context
  get isSecureContext(): boolean {
    return this.#isSecureContext;
  }

  /** Whether HTML has completed setup for script execution. */
  get executionReady(): boolean {
    return this.#executionReady;
  }

  /** Mark HTML setup complete. */
  markExecutionReady(): void {
    this.#executionReady = true;
  }

  /** Determine this environment's partition before or after a realm exists. */
  // https://fetch.spec.whatwg.org/#determine-the-network-partition-key
  determineNetworkPartitionKey(): NetworkPartitionKey {
    let topLevelOrigin = this.topLevelOrigin;
    if (topLevelOrigin === null) {
      if (this.topLevelCreationURL === null) throw new InternalError('Fetch environment has no top-level origin or creation URL');
      topLevelOrigin = obtainURLOrigin(this.topLevelCreationURL);
    }
    return [obtainSite(topLevelOrigin), null];
  }
}

/** State supplied when reserving an environment or transferring it into full settings. */
export interface EnvironmentInit {
  /** Omitted for a fresh reservation; retained when constructing full settings. */
  id?: string;
  userAgent: UserAgent;
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker?: object | null;
  isSecureContext: boolean;
}

/** Environment view for algorithms requiring an HTML realm. */
export interface ScriptingEnvironment {
  realm: Realm;
}
