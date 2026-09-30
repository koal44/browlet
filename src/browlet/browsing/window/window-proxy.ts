import { WindowImpl } from './window';
import { InternalError } from '../../../infra/internal-error';

/** Retains a WindowProxy's current Window implementation and platform object. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-windowproxy-exotic-object
// The handler is internal; the exposed identity is the engine proxy or the
// plain-Node forwarding proxy, neither of which inherits from this class.
// PROVISIONAL: the traps implement fallback forwarding, not HTML's complete
// exotic internal methods or cross-origin access checks; see ROADMAP.md.
export class WindowProxyHandler implements ProxyHandler<object> {
  static #handlers = new WeakMap<object, WindowProxyHandler>();

  /** Creates a forwarding WindowProxy for the plain-Node fallback. */
  static create(): WindowProxy {
    return new WindowProxyHandler().windowProxy;
  }

  /** Registers an existing global-this object as a WindowProxy and returns it unchanged. */
  static register(windowProxy: object): WindowProxy {
    if (WindowProxyHandler.is(windowProxy)) return windowProxy;
    return new WindowProxyHandler(windowProxy).windowProxy;
  }

  static is(this: void, value: unknown): value is WindowProxy {
    return WindowProxyHandler.#handlers.has(value as object);
  }

  /** Current Window implementation, or null before the initial association. */
  static getWindow(windowProxy: WindowProxy): WindowImpl | null {
    return WindowProxyHandler.#requireHandler(windowProxy).#associatedWindow?.implementation ?? null;
  }

  /** Resolves the proxy to the current Window platform object for Web IDL receiver checks. */
  static resolveReceiver(this: void, windowProxy: WindowProxy): Window | undefined {
    return WindowProxyHandler.#requireHandler(windowProxy).#associatedWindow?.platform;
  }

  /** Replaces the Window association while preserving the proxy's identity. */
  static setWindow(
    windowProxy: WindowProxy,
    implementation: WindowImpl,
    platform: Window,
  ): void {
    const handler = WindowProxyHandler.#requireHandler(windowProxy);
    if (!WindowImpl.is(implementation)) {
      throw new InternalError('WindowProxy target is not a Window implementation');
    }
    handler.#associatedWindow = { implementation, platform };
  }

  static #requireHandler(windowProxy: WindowProxy): WindowProxyHandler {
    const handler = WindowProxyHandler.#handlers.get(windowProxy);
    if (!handler) throw new InternalError('Object is not a WindowProxy');
    return handler;
  }

  // -----------------------------------------------------------------------

  /** Stable global-this identity retained when navigation replaces the Window. */
  windowProxy: WindowProxy;
  #associatedWindow: WindowAssociation | null = null;

  private constructor(windowProxy?: object) {
    this.windowProxy = (windowProxy ?? new Proxy({}, this)) as WindowProxy;
    WindowProxyHandler.#handlers.set(this.windowProxy, this);
  }

  /** Current Window association; throws before construction has connected it. */
  get associatedWindow(): WindowAssociation {
    if (!this.#associatedWindow) {
      throw new InternalError('WindowProxy has no associated Window');
    }
    return this.#associatedWindow;
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
    ) return this.windowProxy;

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
export type WindowProxy = Window & {
  frames: WindowProxy;
  parent: WindowProxy;
  self: WindowProxy;
  readonly top: WindowProxy;
  readonly window: WindowProxy;
};

type WindowAssociation = {
  /** HTML state and algorithms of the currently associated Window. */
  implementation: WindowImpl;
  /** Bound Window used for property forwarding and receiver resolution. */
  platform: Window;
};

const windowProxyReferences = new Set<PropertyKey>([
  'frames', 'parent', 'self', 'top', 'window',
]);
