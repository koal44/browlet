import { InternalError } from '../../../infra/internal-error';
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
// PROVISIONAL: the traps implement fallback forwarding, not HTML's complete
// exotic internal methods or cross-origin access checks; see ROADMAP.md.
export class WindowProxyHandle implements ProxyHandler<object> {
  // V8 global proxies lose private-field stamps when reused for another realm.
  static #handles = new WeakMap<WindowProxy, WindowProxyHandle>();

  /** Stable global-this identity retained when navigation replaces the Window. */
  readonly platform: WindowProxy;
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
    if (
      windowProxyReferences.has(property) &&
      !Reflect.has(window, property)
    ) return this.platform;

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
    return Reflect.getPrototypeOf(this.associatedWindow);
  }

  has(_target: object, property: string | symbol): boolean {
    return windowProxyReferences.has(property) ||
      Reflect.has(this.associatedWindow, property);
  }

  ownKeys(_target: object): (string | symbol)[] {
    return Reflect.ownKeys(this.associatedWindow);
  }

  set(_target: object, property: string | symbol, value: unknown): boolean {
    const window = this.associatedWindow;
    return Reflect.set(window, property, value, window);
  }

  setPrototypeOf(_target: object, prototype: object | null): boolean {
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

const windowProxyReferences = new Set<PropertyKey>([
  'frames', 'parent', 'self', 'top', 'window',
]);
