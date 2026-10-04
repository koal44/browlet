import type { JSRealm } from '../js-engine/index';

/** Environment supplying the realm used by its Web IDL bindings. */
export interface WebIDLEnvironment {
  realm: WebIDLRealm;
}

/** Realm facilities and callback lifecycle supplied to Web IDL. */
export interface WebIDLRealm extends JSRealm {
  callbacks: CallbackHooks;
  /** Whether the realm has cross-origin-isolated capability. */
  crossOriginIsolated: boolean;
  /** Every global name supplied by the realm, such as Worker and DedicatedWorker. */
  globalNames: ReadonlySet<string>;
  isGlobalPrototypeChainMutable: boolean;
  /** Whether the realm is a secure context. */
  readonly secureContext: boolean;
  // Web IDL §3.5 Security — perform a security check.
  performSecurityCheck(
    platformObject: object,
    identifier: string,
    type: SecurityCheckType,
  ): void;
  queueMicrotask(steps: () => void): void;
  reportException(exception: unknown): void;
}

/** Host lifecycle and realm association for Web IDL callbacks. */
export interface CallbackHooks {
  captureContext(): object;
  cleanUpAfterRunningCallback(context: object): void;
  cleanUpAfterRunningScript(): void;
  getAssociatedRealm(value: object): WebIDLRealm;
  prepareToRunCallback(context: object): void;
  prepareToRunScript(): void;
}

export type SecurityCheckType = 'getter' | 'method' | 'setter';
