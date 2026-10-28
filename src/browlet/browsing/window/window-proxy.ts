import { InternalError } from '../../../infra/index';
import type { GlobalProxy } from '../../../js-engine/index';
import {
  defineProxyObject, getImplementationObject, type StampedImplInstance, type StampedPlatformObject,
} from '../../../web-idl/index';

import type { Window, WindowProxy } from '../../platform';

import type { WindowImpl } from './window';

/** Retains a WindowProxy's platform identity and current Window association. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-windowproxy-exotic-object
// The handle is internal; the exposed identity is the engine proxy or the
// plain-Node forwarding proxy, neither of which inherits from this class.
// Prototype and property traps still use provisional forwarding; extensibility
// follows HTML §§7.2.3.3–4. See ROADMAP.md for the remaining exotic methods.
// TODO: cross-origin property access must call BrowsingContext.checkAccessShouldBeReported().
// TODO(HTML 7.2.3): Select the accessing realm and compose CrossOriginObjectBinding into the exotic traps.
// TODO(HTML 7.2.3): Index Document.getDocumentTreeChildNavigables() by container insertion order,
// with the specified descriptors, property keys, and cross-origin out-of-range behavior.
export class WindowProxyHandle implements ProxyHandler<object> {
  /** Handles keyed by the stable author-facing proxy identity. */
  // V8 global proxies lose private-field stamps when reused for another realm.
  static #handles = new WeakMap<WindowProxy, WindowProxyHandle>();

  /** Stable global-this identity retained when navigation replaces the Window. */
  readonly platform: WindowProxy;
  /** Current Window platform object, installed during realm composition and replaced on navigation. */
  #associatedWindow: StampedPlatformObject<Window> | undefined;

  /** Creates a handle for an engine proxy, or a new forwarding proxy when omitted. */
  constructor(globalProxy?: GlobalProxy) {
    this.platform = (globalProxy ?? new Proxy({}, this)) as WindowProxy;
    WindowProxyHandle.#handles.set(this.platform, this);
  }

  /** Retrieves a registered WindowProxy's handle at the binding boundary. */
  static getHandle(this: void, value: unknown): WindowProxyHandle | undefined {
    return WindowProxyHandle.#handles.get(value as WindowProxy);
  }

  /** Retrieves a handle's stable WindowProxy exposed to author code. */
  static getProxy(this: void, value: unknown): WindowProxy | undefined {
    return value instanceof WindowProxyHandle ? value.platform : undefined;
  }

  /** Retrieves the handle's currently associated Window platform object. */
  static getWindow(this: void, handle: WindowProxyHandle): StampedPlatformObject<Window> | undefined {
    return handle.#associatedWindow;
  }

  /** Current Window platform object; throws before construction has connected it. */
  get associatedWindow(): StampedPlatformObject<Window> {
    if (!this.#associatedWindow) {
      throw new InternalError('WindowProxy has no associated Window');
    }
    return this.#associatedWindow;
  }

  /** Implementation paired with the current Window; the association already carries its binding. */
  get windowImplementation(): WindowImpl {
    return getImplementationObject(this.associatedWindow) as StampedImplInstance<WindowImpl>;
  }

  /** Replaces the associated Window while preserving this proxy's identity. */
  setAssociatedWindow(window: StampedPlatformObject<Window>): void {
    this.#associatedWindow = window;
  }

  defineProperty(
    _target: object,
    property: string | symbol,
    attributes: PropertyDescriptor,
  ): boolean {
    return Reflect.defineProperty(
      this.associatedWindow,
      property,
      attributes,
    );
  }

  deleteProperty(_target: object, property: string | symbol): boolean {
    return Reflect.deleteProperty(
      this.associatedWindow,
      property,
    );
  }

  get(_target: object, property: string | symbol): unknown {
    const window = this.associatedWindow;
    const value: unknown = Reflect.get(window, property, window);
    return value;
  }

  getOwnPropertyDescriptor(
    _target: object,
    property: string | symbol,
  ): PropertyDescriptor | undefined {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      this.associatedWindow,
      property,
    );
    if (descriptor) descriptor.configurable = true;
    return descriptor;
  }

  getPrototypeOf(_target: object): object | null {
    // TODO(HTML 7.2.3.1): Select the caller's binding and return null across origins.
    return Reflect.getPrototypeOf(this.associatedWindow);
  }

  has(_target: object, property: string | symbol): boolean {
    return Reflect.has(this.associatedWindow, property);
  }

  /** A WindowProxy remains extensible across navigation. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-isextensible
  isExtensible(): boolean {
    return true;
  }

  ownKeys(_target: object): (string | symbol)[] {
    return Reflect.ownKeys(this.associatedWindow);
  }

  /** Reject attempts to make this WindowProxy non-extensible. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-preventextensions
  preventExtensions(): boolean {
    return false;
  }

  set(_target: object, property: string | symbol, value: unknown): boolean {
    const window = this.associatedWindow;
    return Reflect.set(window, property, value, window);
  }

  setPrototypeOf(_target: object, prototype: object | null): boolean {
    // TODO(HTML 7.2.3.2): SetImmutablePrototype must compare with this proxy's caller-sensitive prototype.
    return Reflect.setPrototypeOf(
      this.associatedWindow,
      prototype,
    );
  }
}

/** Preserve the WindowProxy identity and resolve Window member calls through its handle. */
export const windowProxyDefinition = defineProxyObject({
  name: 'WindowProxy',
  getHandle: WindowProxyHandle.getHandle,
  getProxy: WindowProxyHandle.getProxy,
  resolveReceiver: WindowProxyHandle.getWindow,
});
