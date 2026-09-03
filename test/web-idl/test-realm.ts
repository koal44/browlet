import { NodeRealm, nodeRuntime } from '../../src/javascript/index';
import type {
  SecurityCheckType, WebIDLRealmHost,
} from '../../src/web-idl/javascript-realm';

/*
 * Web IDL's unit tests need a JavaScript realm, not Browlet's HTML callback
 * lifecycle. Keep the boundary honest with the smallest host that satisfies
 * Web IDL while NodeRealm supplies realm identity and JavaScript execution.
 */
export class TestRealm extends NodeRealm implements WebIDLRealmHost {
  readonly callbacks: WebIDLRealmHost['callbacks'];
  readonly crossOriginIsolated: boolean;
  readonly globalNames: ReadonlySet<string>;
  readonly isGlobalPrototypeChainMutable: boolean;
  readonly secureContext: boolean;

  constructor(options: TestRealmOptions = {}) {
    super();
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
        const realm = nodeRuntime.getAssociatedRealm(value);
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
    nodeRuntime.enqueueMicrotask(steps);
  }
}

type TestRealmOptions = {
  crossOriginIsolated?: boolean;
  globalNames?: readonly string[];
  isGlobalPrototypeChainMutable?: boolean;
  secureContext?: boolean;
};
