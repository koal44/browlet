import { InternalError } from '../../../infra/index';
import type { GlobalProxy } from '../../../js-engine/index';
import {
  defineProxyObject, getImplementationObject, isArrayIndex, type StampedImplInstance, type StampedPlatformObject,
} from '../../../web-idl/index';

import type { Window, WindowProxy } from '../../platform';

import type { WindowImpl } from './window';

/** Retains a WindowProxy's platform identity and current Window association. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-windowproxy-exotic-object
// The handle is internal; the exposed identity is the engine proxy or the
// plain-Node forwarding proxy, neither of which inherits from this class.
// Native caller selection is composed in integration/web-idl/window-proxy.ts.
// These stock-Node traps retain provisional forwarding; see ROADMAP.md.
// TODO(stock Node): Select the accessing realm and compose CrossOriginObjectBinding into these traps.
export class WindowProxyHandle implements ProxyHandler<object> {
  /** Handles keyed by the stable author-facing proxy identity. */
  // V8 global proxies lose private-field stamps when reused for another realm.
  static #handles = new WeakMap<WindowProxy, WindowProxyHandle>();

  /** Stable global-this identity retained when navigation replaces the Window. */
  readonly platform: WindowProxy;
  /** Current Window platform object, installed during realm composition and replaced on navigation. */
  #associatedWindow: StampedPlatformObject<Window> | undefined;
  /** VM globals forwarding to this proxy, including retained globals after navigation. */
  #vmGlobalReceivers = new WeakSet<object>();

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

  /** Describe a live child index for the selected Window, including a retained original Window. */
  static getIndexedOwnProperty(window: WindowImpl, index: number): PropertyDescriptor | undefined {
    const child = window.getIndexedWindow(index)?.platform;
    return child === undefined ? undefined : { value: child, writable: false, enumerable: true, configurable: true };
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
    this.#vmGlobalReceivers.add(this.windowImplementation.env.realm.globalProxy);
  }

  defineProperty(
    _target: object,
    property: string | symbol,
    attributes: PropertyDescriptor,
  ): boolean {
    // TODO(HTML 7.2.3.6): Select the caller binding and use defineWindowProxyOwnProperty().
    if (typeof property === 'string' && isArrayIndex(property)) return false;
    return Reflect.defineProperty(
      this.associatedWindow,
      property,
      attributes,
    );
  }

  deleteProperty(_target: object, property: string | symbol): boolean {
    // TODO(HTML 7.2.3.9): Select the caller binding and use deleteWindowProxyProperty().
    if (typeof property === 'string' && isArrayIndex(property)) {
      return this.windowImplementation.getIndexedWindow(Number(property)) === undefined;
    }
    return Reflect.deleteProperty(
      this.associatedWindow,
      property,
    );
  }

  get(_target: object, property: string | symbol, receiver: unknown): unknown {
    // TODO(HTML 7.2.3.7): Select the caller binding and call getWindowProxy() with the resolved receiver.
    const child = this.#getIndexedWindow(property);
    if (child !== undefined) return child;
    const window = this.associatedWindow;
    const value: unknown = Reflect.get(window, property, this.#resolveReceiver(receiver));
    return value;
  }

  getOwnPropertyDescriptor(
    _target: object,
    property: string | symbol,
  ): PropertyDescriptor | undefined {
    if (typeof property === 'string' && isArrayIndex(property)) {
      const descriptor = WindowProxyHandle.getIndexedOwnProperty(this.windowImplementation, Number(property));
      if (descriptor !== undefined) return descriptor;
    }
    // TODO(HTML 7.2.3.5): Select the caller binding and use getWindowProxyOwnProperty().
    // Retain the configurable-descriptor accommodation at this JavaScript Proxy boundary.
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
    if (this.#getIndexedWindow(property) !== undefined) return true;
    return Reflect.has(this.associatedWindow, property);
  }

  /** A WindowProxy remains extensible across navigation. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-isextensible
  isExtensible(): boolean {
    return true;
  }

  /** Enumerate the live child-index prefix, followed by provisional ordinary Window keys. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-ownpropertykeys
  ownKeys(_target: object): (string | symbol)[] {
    // TODO(HTML 7.2.3.10): Select the caller binding and use getWindowProxyOwnPropertyKeys(), retaining deduplication here.
    // ACCOMMODATION(node-vm-global-proxy): Direct stock-VM access can still leave
    // indices on Window; a Proxy must not return duplicate keys.
    const keys = new Set<string | symbol>(Array.from({ length: this.windowImplementation.length }, (_, index) => String(index)));
    for (const key of Reflect.ownKeys(this.associatedWindow)) keys.add(key);
    return [...keys];
  }

  /** Reject attempts to make this WindowProxy non-extensible. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-preventextensions
  preventExtensions(): boolean {
    return false;
  }

  set(_target: object, property: string | symbol, value: unknown, receiver: unknown): boolean {
    // TODO(HTML 7.2.3.8): Select the caller binding and call setWindowProxy() with the resolved receiver.
    if (typeof property === 'string' && isArrayIndex(property)) return false;
    const window = this.associatedWindow;
    return Reflect.set(window, property, value, this.#resolveReceiver(receiver));
  }

  setPrototypeOf(_target: object, prototype: object | null): boolean {
    // TODO(HTML 7.2.3.2): SetImmutablePrototype must compare with this proxy's caller-sensitive prototype.
    return Reflect.setPrototypeOf(
      this.associatedWindow,
      prototype,
    );
  }

  /** Map an associated VM global to the public proxy; preserve every other receiver. */
  #resolveReceiver(receiver: unknown): unknown {
    // ACCOMMODATION(node-vm-global-proxy): Stock Node inherits from the modeled
    // proxy instead of using it as its actual global-this. Recognize only retained identities.
    return this.#vmGlobalReceivers.has(receiver as object) ? this.platform : receiver;
  }

  /** A valid indexed child is visible regardless of the accessing realm's origin. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-getownproperty
  #getIndexedWindow(property: string | symbol): WindowProxy | undefined {
    if (typeof property !== 'string' || !isArrayIndex(property)) return undefined;
    return this.windowImplementation.getIndexedWindow(Number(property))?.platform;
  }
}

/** Preserve the WindowProxy identity and resolve Window member calls through its handle. */
export const windowProxyDefinition = defineProxyObject({
  name: 'WindowProxy',
  getHandle: WindowProxyHandle.getHandle,
  getProxy: WindowProxyHandle.getProxy,
  resolveReceiver: WindowProxyHandle.getWindow,
});
