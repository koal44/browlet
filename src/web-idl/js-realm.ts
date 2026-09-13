import type { JSRealm } from '../js-engine/index';

// Project host contract: realm facilities and callback lifecycle supplied to Web IDL.
export type WebIDLRealmHost = JSRealm & {
  callbacks: {
    captureContext(): object;
    cleanUpAfterRunningCallback(context: object): void;
    cleanUpAfterRunningScript(): void;
    getAssociatedRealm(value: object): WebIDLRealmHost;
    prepareToRunCallback(context: object): void;
    prepareToRunScript(): void;
    reportException(exception: unknown): void;
  };
  readonly crossOriginIsolated: boolean;
  readonly globalNames: ReadonlySet<string>;
  readonly isGlobalPrototypeChainMutable: boolean;
  readonly secureContext: boolean;
  // Web IDL §3.5 Security — perform a security check.
  performSecurityCheck(
    platformObject: object,
    identifier: string,
    type: SecurityCheckType,
  ): void;
  queueMicrotask(steps: () => void): void;
};

export type SecurityCheckType = 'getter' | 'method' | 'setter';
