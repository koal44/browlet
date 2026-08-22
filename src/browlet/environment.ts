import type { BrowsingContext } from './browsing-context';
import type { EventLoop } from './event-loop';
import type { Realm } from './realm';
import type { Origin } from '../url/origin';
import type { URLRecord } from '../url/url';

/*
 * An environment carries navigation/client state before a realm, global
 * object, or environment settings object necessarily exists.
 */
export class Environment {
  readonly id = crypto.randomUUID();
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker: object | null;
  #executionReady = false;

  constructor(initialization: EnvironmentInitialization) {
    this.creationURL = initialization.creationURL;
    this.topLevelCreationURL = initialization.topLevelCreationURL;
    this.topLevelOrigin = initialization.topLevelOrigin;
    this.targetBrowsingContext = initialization.targetBrowsingContext;
    this.activeServiceWorker = initialization.activeServiceWorker ?? null;
  }

  get executionReady(): boolean {
    return this.#executionReady;
  }

  markExecutionReady(): void {
    this.#executionReady = true;
  }
}

export abstract class EnvironmentSettingsObject extends Environment {
  readonly realmExecutionContext: Realm;
  readonly moduleMap = new Map<string, unknown>();

  constructor(initialization: EnvironmentSettingsInitialization) {
    super(initialization);
    this.realmExecutionContext = initialization.realmExecutionContext;
  }

  abstract get apiBaseURL(): URLRecord;
  abstract get origin(): Origin;
  abstract get hasCrossSiteAncestor(): boolean;
  abstract get policyContainer(): object | null;
  abstract get crossOriginIsolatedCapability(): boolean;
  abstract get timeOrigin(): DOMHighResTimeStamp;

  get responsibleEventLoop(): EventLoop {
    return this.realmExecutionContext.agent.eventLoop;
  }
}

export type EnvironmentInitialization = {
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker?: object | null;
};

export type EnvironmentSettingsInitialization = EnvironmentInitialization & {
  realmExecutionContext: Realm;
};
