import type { WindowImpl } from './window';
import { defineProxyObject, type StampedPlatformObject } from '../../../web-idl/index';
import { InternalError } from '../../../infra/internal-error';

/** Retains a WindowProxy's platform identity and current Window association. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-windowproxy-exotic-object
// The handle is internal; the exposed identity is the engine proxy or the
// plain-Node forwarding proxy, neither of which inherits from this class.
// PROVISIONAL: the traps implement fallback forwarding, not HTML's complete
// exotic internal methods or cross-origin access checks; see ROADMAP.md.
export class WindowProxyHandle implements ProxyHandler<object> {
  static #handles = new WeakMap<object, WindowProxyHandle>();

  /** Retrieves the supplied platform's handle, creating a fallback proxy when omitted. */
  static getOrCreate(platform?: object): WindowProxyHandle {
    const handle = platform === undefined ? undefined : WindowProxyHandle.#handles.get(platform);
    return handle ?? new WindowProxyHandle(platform);
  }

  /** Recognizes a registered WindowProxy platform object at the binding boundary. */
  static is(this: void, value: unknown): value is WindowProxy {
    return WindowProxyHandle.#handles.has(value as object);
  }

  /** Resolves the proxy to the current Window platform object for Web IDL receiver checks. */
  static resolveReceiver(this: void, windowProxy: WindowProxy): Window | undefined {
    const handle = WindowProxyHandle.#handles.get(windowProxy);
    return handle ? handle.#associatedWindow?.platform : undefined;
  }

  // -----------------------------------------------------------------------

  /** Stable global-this identity retained when navigation replaces the Window. */
  platform: WindowProxy;
  #associatedWindow: WindowAssociation | null = null;

  private constructor(platform?: object) {
    this.platform = (platform ?? new Proxy({}, this)) as WindowProxy;
    WindowProxyHandle.#handles.set(this.platform, this);
  }

  /** Current Window association; throws before construction has connected it. */
  get associatedWindow(): WindowAssociation {
    if (!this.#associatedWindow) {
      throw new InternalError('WindowProxy has no associated Window');
    }
    return this.#associatedWindow;
  }

  /** Replaces the paired Window identities while preserving this proxy's identity. */
  setAssociatedWindow(window: WindowAssociation): void {
    this.#associatedWindow = window;
  }

  defineProperty(
    _target: object,
    property: string | symbol,
    attributes: PropertyDescriptor,
  ): boolean {
    return Reflect.defineProperty(
      this.associatedWindow.platform,
      property,
      attributes,
    );
  }

  deleteProperty(_target: object, property: string | symbol): boolean {
    return Reflect.deleteProperty(
      this.associatedWindow.platform,
      property,
    );
  }

  get(_target: object, property: string | symbol): unknown {
    const window = this.associatedWindow.platform;
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
      this.associatedWindow.platform,
      property,
    );
    return descriptor && { ...descriptor, configurable: true };
  }

  getPrototypeOf(_target: object): object | null {
    return Reflect.getPrototypeOf(this.associatedWindow.platform);
  }

  has(_target: object, property: string | symbol): boolean {
    return windowProxyReferences.has(property) ||
      Reflect.has(this.associatedWindow.platform, property);
  }

  ownKeys(_target: object): (string | symbol)[] {
    return Reflect.ownKeys(this.associatedWindow.platform);
  }

  set(_target: object, property: string | symbol, value: unknown): boolean {
    const window = this.associatedWindow.platform;
    return Reflect.set(window, property, value, window);
  }

  setPrototypeOf(_target: object, prototype: object | null): boolean {
    return Reflect.setPrototypeOf(
      this.associatedWindow.platform,
      prototype,
    );
  }
}

/** Author-visible Window surface forwarded through a stable exotic identity. */
// PROVISIONAL: this lib.dom surface is asserted at composition, not derived
// from the implemented Window declarations; see ROADMAP.md.
export type WindowProxy = Window & {
  frames: WindowProxy;
  parent: WindowProxy;
  self: WindowProxy;
  readonly top: WindowProxy;
  readonly window: WindowProxy;
};

/** Paired implementation and platform identities of one projected Window. */
export type WindowAssociation = {
  /** HTML state and algorithms of the currently associated Window. */
  implementation: WindowImpl;
  /** Bound Window used for property forwarding and receiver resolution. */
  platform: StampedPlatformObject<Window>;
};

/** Preserve the WindowProxy identity and resolve Window member calls through its handle. */
export const windowProxyDefinition = defineProxyObject({
  name: 'WindowProxy',
  is: WindowProxyHandle.is,
  resolveReceiver: WindowProxyHandle.resolveReceiver,
});

const windowProxyReferences = new Set<PropertyKey>([
  'frames', 'parent', 'self', 'top', 'window',
]);
