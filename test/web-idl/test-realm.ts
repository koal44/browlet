import {
  type JSMicrotaskQueue, JSRealm, jsRuntime,
} from '../../src/js-engine/index';
import type {
  SecurityCheckType, WebIDLRealmHost,
} from '../../src/web-idl/js-realm';

/*
 * Web IDL's unit tests need a JavaScript realm, not Browlet's HTML callback
 * lifecycle. Keep the boundary honest with the smallest host that satisfies
 * Web IDL while JSRealm supplies realm identity and JavaScript execution.
 */
export class TestRealm extends JSRealm implements WebIDLRealmHost {
  readonly callbacks: WebIDLRealmHost['callbacks'];
  readonly crossOriginIsolated: boolean;
  readonly globalNames: ReadonlySet<string>;
  readonly isGlobalPrototypeChainMutable: boolean;
  readonly secureContext: boolean;

  constructor(options: TestRealmOptions = {}) {
    /* Vitest owns this unit harness's asynchronous lifecycle. */
    super(testMicrotaskQueue);
    this.crossOriginIsolated = options.crossOriginIsolated ?? false;
    this.globalNames = new Set(options.globalNames ?? ['Window']);
    this.isGlobalPrototypeChainMutable =
      options.isGlobalPrototypeChainMutable ?? false;
    this.secureContext = options.secureContext ?? false;
    this.callbacks = {
      captureContext: () => this,
      cleanUpAfterRunningCallback: () => {},
      cleanUpAfterRunningScript: () => {},
      getAssociatedRealm: (value) => {
        const realm = jsRuntime.getAssociatedRealm(value);
        return realm instanceof TestRealm ? realm : this;
      },
      prepareToRunCallback: () => {},
      prepareToRunScript: () => {},
      reportException: () => {},
    };
  }

  performSecurityCheck(
    _platformObject: object,
    _identifier: string,
    _type: SecurityCheckType,
  ): void {}

  queueMicrotask(steps: () => void): void {
    this.enqueueMicrotask(steps);
  }
}

type TestRealmOptions = {
  crossOriginIsolated?: boolean;
  globalNames?: readonly string[];
  isGlobalPrototypeChainMutable?: boolean;
  secureContext?: boolean;
};

const testMicrotaskQueue: JSMicrotaskQueue = {
  kind: 'ambient',
  enqueueMicrotask: (steps) => { globalThis.queueMicrotask(steps); },
  performMicrotaskCheckpoint: () => {
    throw new Error('The Web IDL test Realm does not own host checkpoints');
  },
};
